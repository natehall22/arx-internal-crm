import { resolveCanReassignAppointment } from '@/lib/permissions'
import { formatDateTimeInTimezone } from '@/lib/timezone'
import { getMailTransport } from '@/lib/setter-email'
import { updateCalendarEvent, deleteCalendarEvent, createCalendarEvent, refreshAccessToken } from '@/lib/google-calendar'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAccessTokenFromApiRequest } from '@/lib/supabase-api-request-auth'

export const dynamic = 'force-dynamic'

function getAuthClient(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const accessToken = getAccessTokenFromApiRequest(req)

  return {
    client: createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: accessToken
        ? { headers: { Authorization: `Bearer ${accessToken}` } }
        : undefined,
    }),
    accessToken,
  }
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function getValidAccessToken(
  adminClient: ReturnType<typeof getAdminClient>,
  userId: string
): Promise<string | null> {
  const { data: tokenRow } = await adminClient
    .from('user_google_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (!tokenRow) return null

  const expiresAt = new Date(tokenRow.expires_at)
  if (expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    try {
      const refreshed = await refreshAccessToken(tokenRow.refresh_token)
      await adminClient
        .from('user_google_tokens')
        .update({ access_token: refreshed.access_token, expires_at: refreshed.expires_at })
        .eq('user_id', userId)
      return refreshed.access_token
    } catch {
      return tokenRow.access_token // fall back to stale token
    }
  }

  return tokenRow.access_token
}

function homeownerFromAppointment(appointment: { leads?: unknown }): string {
  const raw = appointment.leads as { homeowner_name?: string } | { homeowner_name?: string }[] | null | undefined
  if (Array.isArray(raw)) return raw[0]?.homeowner_name || 'Customer'
  return raw?.homeowner_name || 'Customer'
}

// GET - Fetch single appointment
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = getAdminClient()

    let { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .maybeSingle()

    // Self-heal: auth user without public.users row — derive org from this appointment (same as inspections/status).
    if (!profile?.org_id) {
      const { data: apptOrg } = await adminClient
        .from('scheduled_appointments')
        .select('org_id')
        .eq('id', params.id)
        .maybeSingle()
      const derivedOrgId = apptOrg?.org_id ?? null
      if (!derivedOrgId) {
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
      }
      const fallbackName =
        (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()) ||
        user.email ||
        'User'
      const { data: recovered } = await adminClient
        .from('users')
        .upsert(
          {
            id: user.id,
            org_id: derivedOrgId,
            role: 'rep',
            full_name: fallbackName,
            email: user.email || null,
            active: true,
          },
          { onConflict: 'id' }
        )
        .select('org_id, role')
        .maybeSingle()
      profile = recovered || { org_id: derivedOrgId, role: 'rep' as const }
    }

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Fetch appointment with related data
    const { data: appointment, error } = await adminClient
      .from('scheduled_appointments')
      .select(`
        *,
        leads(homeowner_name, phone, email, address_text),
        opportunities(id, status)
      `)
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (error || !appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    // Get setter info if exists
    let setter = null
    if (appointment.canvasser_user_id) {
      const { data: setterData } = await adminClient
        .from('users')
        .select('id, full_name, email, team_id')
        .eq('id', appointment.canvasser_user_id)
        .single()
      setter = setterData
    }

    // Get closer info
    let closer = null
    if (appointment.closer_user_id) {
      const { data: closerData } = await adminClient
        .from('users')
        .select('id, full_name, email, team_id')
        .eq('id', appointment.closer_user_id)
        .single()
      closer = closerData
    }

    return NextResponse.json({
      appointment: {
        ...appointment,
        setter,
        closer,
      }
    })
  } catch (error) {
    console.error('Appointment fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch appointment' }, { status: 500 })
  }
}

// PATCH - Update appointment (reassign, update status, etc.)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = getAdminClient()

    // Get user profile
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role, full_name, custom_role_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const canReassign = await resolveCanReassignAppointment(adminClient, profile)

    const body = await request.json()
    const { new_closer_id, status, notes, scheduled_for, duration_minutes } = body

    // Get current appointment
    const { data: appointment, error: fetchError } = await adminClient
      .from('scheduled_appointments')
      .select('*, leads(homeowner_name)')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (fetchError || !appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    const isAssignedCloser = appointment.closer_user_id === user.id
    const canEditSchedule = canReassign || isAssignedCloser

    const updateData: Record<string, any> = {}

    // Handle reassignment (managers only)
    if (new_closer_id && new_closer_id !== appointment.closer_user_id) {
      if (!canReassign) {
        return NextResponse.json({ error: 'Only managers can reassign appointments' }, { status: 403 })
      }

      // Verify new closer exists in same org
      const { data: newCloser } = await adminClient
        .from('users')
        .select('id, full_name, org_id, email')
        .eq('id', new_closer_id)
        .eq('org_id', profile.org_id)
        .single()

      if (!newCloser) {
        return NextResponse.json({ error: 'New closer not found' }, { status: 404 })
      }

      updateData.closer_user_id = new_closer_id

      const homeownerLabel = homeownerFromAppointment(appointment)

      // Create activity for reassignment
      await adminClient.from('activities').insert({
        org_id: profile.org_id,
        lead_id: appointment.lead_id,
        opportunity_id: appointment.opportunity_id,
        user_id: user.id,
        type: 'status_change',
        body: `Appointment reassigned to ${newCloser.full_name} by ${profile.full_name}`,
      })

      // Notify old closer
      if (appointment.closer_user_id) {
        await adminClient.from('notifications').insert({
          org_id: profile.org_id,
          user_id: appointment.closer_user_id,
          type: 'appointment_reassigned',
          title: 'Appointment Reassigned',
          body: `Your appointment with ${homeownerLabel} has been reassigned to ${newCloser.full_name}`,
          data: { appointment_id: params.id },
        })
      }

      // Notify new closer
      await adminClient.from('notifications').insert({
        org_id: profile.org_id,
        user_id: new_closer_id,
        type: 'new_appointment',
        title: 'New Appointment Assigned',
        body: `You have been assigned an appointment with ${homeownerLabel} on ${formatDateTimeInTimezone(appointment.scheduled_for)} ET`,
        data: { appointment_id: params.id },
      })

      // Email both assignees when SMTP is configured (in-app notifications alone are not email).
      try {
        if (process.env.SMTP_HOST) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://arx-internal-crm.vercel.app'
        const recordUrl = appointment.opportunity_id
          ? `${appUrl}/opportunities/${appointment.opportunity_id}`
          : `${appUrl}/leads/${appointment.lead_id}`
        const scheduledTime = formatDateTimeInTimezone(appointment.scheduled_for)
        const typeLabel = appointment.appointment_type === 'close' ? 'Close' : 'Inspection'
        const transporter = getMailTransport()

        if (newCloser.email?.includes('@')) {
          await transporter.sendMail({
            from: 'info@arxroofing.com',
            to: newCloser.email,
            subject: `${typeLabel} reassigned to you — ${homeownerLabel}`,
            text: `Hi ${newCloser.full_name},\n\nYou were assigned this ${typeLabel.toLowerCase()} appointment (reassigned by ${profile.full_name}).\n\nCustomer: ${homeownerLabel}\nWhen: ${scheduledTime} ET\nAddress: ${appointment.address_text || 'TBD'}\n\nOpen: ${recordUrl}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #111827;">${typeLabel} reassigned to you</h2>
                <p style="color: #374151;">Hi ${newCloser.full_name},</p>
                <p style="color: #374151;">You were assigned this appointment (reassigned by <strong>${profile.full_name}</strong>).</p>
                <table style="width: 100%; border-collapse: collapse; margin: 12px 0;">
                  <tr><td style="padding: 6px 0; color: #6B7280; width: 120px;">Customer</td><td style="padding: 6px 0; color: #111827;">${homeownerLabel}</td></tr>
                  <tr><td style="padding: 6px 0; color: #6B7280;">When</td><td style="padding: 6px 0; color: #111827;">${scheduledTime} ET</td></tr>
                  <tr><td style="padding: 6px 0; color: #6B7280;">Address</td><td style="padding: 6px 0; color: #111827;">${appointment.address_text || 'TBD'}</td></tr>
                </table>
                <p style="margin: 16px 0 0;"><a href="${recordUrl}" style="color: #4f46e5;">Open in ARX CRM</a></p>
              </div>`,
          })
        }

        if (appointment.closer_user_id) {
          const { data: prevUser } = await adminClient
            .from('users')
            .select('email, full_name')
            .eq('id', appointment.closer_user_id)
            .maybeSingle()

          if (prevUser?.email?.includes('@')) {
            await transporter.sendMail({
              from: 'info@arxroofing.com',
              to: prevUser.email,
              subject: `${typeLabel} reassigned — ${homeownerLabel}`,
              text: `Hi ${prevUser.full_name || 'there'},\n\nThe ${typeLabel.toLowerCase()} with ${homeownerLabel} on ${scheduledTime} ET was reassigned to ${newCloser.full_name} by ${profile.full_name}.\n\nYou no longer need this on your calendar.\n\n${recordUrl}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
                  <h2 style="color: #111827;">Appointment reassigned</h2>
                  <p style="color: #374151;">Hi ${prevUser.full_name || 'there'},</p>
                  <p style="color: #374151;">The <strong>${typeLabel}</strong> with <strong>${homeownerLabel}</strong> (${scheduledTime} ET) was reassigned to <strong>${newCloser.full_name}</strong> by ${profile.full_name}. You can remove it from your calendar if it is still there.</p>
                  <p style="margin: 16px 0 0;"><a href="${recordUrl}" style="color: #4f46e5;">Open in ARX CRM</a></p>
                </div>`,
            })
          }
        }
        }
      } catch (emailErr) {
        console.error('Appointment reassignment email failed:', emailErr)
      }
    }

    if (status) {
      updateData.status = status
    }

    if (notes !== undefined) {
      updateData.notes = notes
    }

    if (scheduled_for !== undefined) {
      if (!canEditSchedule) {
        return NextResponse.json({ error: 'Only managers or the assigned closer can reschedule' }, { status: 403 })
      }
      const parsed = new Date(scheduled_for)
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: 'Invalid scheduled_for' }, { status: 400 })
      }
      updateData.scheduled_for = parsed.toISOString()
    }

    if (duration_minutes !== undefined) {
      if (!canEditSchedule) {
        return NextResponse.json(
          { error: 'Only managers or the assigned closer can change duration' },
          { status: 403 }
        )
      }
      const dm = Number(duration_minutes)
      if (!Number.isFinite(dm) || dm < 5 || dm > 24 * 60) {
        return NextResponse.json({ error: 'Invalid duration_minutes' }, { status: 400 })
      }
      updateData.duration_minutes = Math.round(dm)
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
    }

    // Update appointment
    const { data: updated, error: updateError } = await adminClient
      .from('scheduled_appointments')
      .update(updateData)
      .eq('id', params.id)
      .select()
      .single()

    if (updateError) {
      console.error('Update error:', updateError)
      return NextResponse.json({ error: 'Failed to update appointment' }, { status: 500 })
    }

    // Reassignment: sync lead + opportunity rep fields with calendar assignee (same as canvass scheduling:
    // lead.closer_user_id + opportunities.owner_user_id track the rep; lead.owner_user_id stays the setter).
    // Also point pending feedback prompts at the new closer (DB trigger also updates pending prompts).
    if (new_closer_id && new_closer_id !== appointment.closer_user_id) {
      if (appointment.lead_id) {
        const { error: leadSyncErr } = await adminClient
          .from('leads')
          .update({ closer_user_id: new_closer_id })
          .eq('id', appointment.lead_id)
          .eq('org_id', profile.org_id)
        if (leadSyncErr) {
          console.error('Appointment reassignment: failed to sync lead closer_user_id:', leadSyncErr)
        }
      }
      const oppId = appointment.opportunity_id as string | null
      if (oppId) {
        const { error: oppSyncErr } = await adminClient
          .from('opportunities')
          .update({ owner_user_id: new_closer_id })
          .eq('id', oppId)
          .eq('org_id', profile.org_id)
        if (oppSyncErr) {
          console.error('Appointment reassignment: failed to sync opportunity owner_user_id:', oppSyncErr)
        }
      } else if (appointment.lead_id) {
        const { error: oppSyncErr } = await adminClient
          .from('opportunities')
          .update({ owner_user_id: new_closer_id })
          .eq('lead_id', appointment.lead_id)
          .eq('org_id', profile.org_id)
        if (oppSyncErr) {
          console.error('Appointment reassignment: failed to sync opportunity owner_user_id:', oppSyncErr)
        }
      }

      const { error: promptRedirectError } = await adminClient
        .from('pending_status_prompts')
        .update({ closer_user_id: new_closer_id, dismissed: false })
        .eq('appointment_id', params.id)
        .eq('completed', false)
      if (promptRedirectError) {
        console.error('pending_status_prompts redirect on reassignment:', promptRedirectError)
      }
    }

    // Best-effort Google Calendar sync — non-fatal, DB update already committed
    const calendarSync: { warnings: string[] } = { warnings: [] }
    try {
      const existingEventId = appointment.google_event_id as string | null
      const homeownerName = homeownerFromAppointment(appointment)

      if (status === 'cancelled' && existingEventId && appointment.closer_user_id) {
        // Cancellation: delete the event from the current closer's calendar
        const token = await getValidAccessToken(adminClient, appointment.closer_user_id)
        if (!token) {
          calendarSync.warnings.push('Google Calendar: no valid token for assignee; event not removed from calendar.')
        } else {
          try {
            await deleteCalendarEvent(token, existingEventId)
            await adminClient
              .from('scheduled_appointments')
              .update({ google_event_id: null })
              .eq('id', params.id)
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e)
            console.error('Appointment cancel: Google delete failed:', msg)
            calendarSync.warnings.push(`Google Calendar: could not delete event (${msg})`)
          }
        }

      } else if (new_closer_id && new_closer_id !== appointment.closer_user_id) {
        // Reassignment: delete from old closer's calendar, create on new closer's calendar

        if (existingEventId && appointment.closer_user_id) {
          const oldToken = await getValidAccessToken(adminClient, appointment.closer_user_id)
          if (!oldToken) {
            calendarSync.warnings.push(
              'Google Calendar: no valid token for previous assignee; old calendar event may still exist.'
            )
          } else {
            try {
              await deleteCalendarEvent(oldToken, existingEventId)
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : String(e)
              console.error('Appointment reassignment: Google delete failed:', msg)
              calendarSync.warnings.push(`Google Calendar: could not remove from previous assignee (${msg})`)
            }
          }
        }

        const newToken = await getValidAccessToken(adminClient, new_closer_id)
        const startIso = updated.scheduled_for as string
        const endIso = new Date(
          new Date(startIso).getTime() + (updated.duration_minutes || 60) * 60 * 1000
        ).toISOString()
        const typeLabel = appointment.appointment_type === 'close' ? 'Close' : 'Inspection'
        const eventNotes = notes !== undefined ? notes : appointment.notes

        let newEventId: string | null = null
        if (!newToken) {
          calendarSync.warnings.push(
            'Google Calendar: no valid token for new assignee; event not added to their calendar.'
          )
        } else {
          try {
            const created = await createCalendarEvent(
              newToken,
              {
                summary: `${typeLabel}: ${homeownerName}`,
                ...(eventNotes && { description: String(eventNotes) }),
                ...(appointment.address_text && { location: appointment.address_text }),
                start: { dateTime: startIso },
                end: { dateTime: endIso },
              },
              'primary',
              'none'
            )
            newEventId = created?.id ?? null
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e)
            console.error('Appointment reassignment: Google create failed:', msg)
            calendarSync.warnings.push(`Google Calendar: could not create event for new assignee (${msg})`)
          }
        }

        // Always update google_event_id — either new ID or null (old ID is now invalid)
        await adminClient
          .from('scheduled_appointments')
          .update({ google_event_id: newEventId })
          .eq('id', params.id)

      } else if (existingEventId && updated.closer_user_id) {
        // In-place update: time, notes, location, title (same calendar / closer)
        const token = await getValidAccessToken(adminClient, updated.closer_user_id)
        if (!token) {
          calendarSync.warnings.push('Google Calendar: no valid token for assignee; calendar not updated.')
        } else {
          try {
            const startIso = updated.scheduled_for as string
            const dur = updated.duration_minutes || 60
            const endIso = new Date(new Date(startIso).getTime() + dur * 60 * 1000).toISOString()
            const typeLabel = updated.appointment_type === 'close' ? 'Close' : 'Inspection'
            await updateCalendarEvent(token, existingEventId, {
              summary: `${typeLabel}: ${homeownerName}`,
              start: { dateTime: startIso },
              end: { dateTime: endIso },
              ...(updated.address_text ? { location: updated.address_text } : {}),
              ...(updated.notes != null && String(updated.notes).length > 0
                ? { description: String(updated.notes) }
                : {}),
            })
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e)
            console.error('Appointment update: Google update failed:', msg)
            calendarSync.warnings.push(`Google Calendar: could not update event (${msg})`)
          }
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('Appointment update: Google Calendar sync error:', msg)
      calendarSync.warnings.push(`Google Calendar: ${msg}`)
    }

    return NextResponse.json({
      success: true,
      appointment: updated,
      ...(calendarSync.warnings.length > 0 ? { calendarSync } : {}),
    })
  } catch (error) {
    console.error('Appointment update error:', error)
    return NextResponse.json({ error: 'Failed to update appointment' }, { status: 500 })
  }
}
