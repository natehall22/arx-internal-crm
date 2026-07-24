import { resolveCanReassignAppointment } from '@/lib/permissions'
import { formatDateTimeInTimezone } from '@/lib/timezone'
import { getCrmEmailFrom, getMailTransport } from '@/lib/setter-email'
import { isUserActiveForTransactionalEmail } from '@/lib/user-email-eligibility'
import { updateCalendarEvent, createCalendarEvent } from '@/lib/google-calendar'
import { syncCloserAttributionDownstream } from '@/lib/payroll-attribution-sync'
import { computeInspectionFeedbackPromptAt } from '@/lib/scheduling-prompt'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveApiRequestAuthUser } from '@/lib/supabase-api-request-auth'
import { deleteGoogleEventWithFallback, getValidAccessToken } from '@/lib/appointment-calendar-sync'
import { syncOrgEnrollments } from '@/lib/sync-444-core'

export const dynamic = 'force-dynamic'

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function homeownerFromAppointment(appointment: { leads?: unknown }): string {
  const raw = appointment.leads as { homeowner_name?: string } | { homeowner_name?: string }[] | null | undefined
  if (Array.isArray(raw)) return raw[0]?.homeowner_name || 'Customer'
  return raw?.homeowner_name || 'Customer'
}

/** Map Postgres / trigger errors from scheduled_appointments updates to API responses (see migration 077). */
function mapScheduledAppointmentUpdateError(err: {
  message?: string
  code?: string
  details?: string
}): { message: string; status: number } {
  const raw = [err.message, err.details].filter(Boolean).join(' ')
  if (
    err.code === '23P01' ||
    raw.includes('Scheduling conflict') ||
    raw.includes('overlapping appointment')
  ) {
    return {
      message:
        'This rep already has another appointment that overlaps this time. Reschedule one of the appointments, change duration if appropriate, or pick a different rep.',
      status: 409,
    }
  }
  if (err.code === '23505' || raw.includes('Rapid duplicate')) {
    return {
      message: 'A matching appointment was just created. Refresh the page and try again.',
      status: 409,
    }
  }
  if (err.code === '23505' && raw.toLowerCase().includes('lead_id')) {
    return {
      message: 'Another active appointment already exists for this lead at this time.',
      status: 409,
    }
  }
  return { message: 'Failed to update appointment', status: 500 }
}

function leadContactFromAppointment(appointment: { leads?: unknown }): {
  homeowner_name: string
  phone: string
} {
  const raw = appointment.leads as
    | { homeowner_name?: string | null; phone?: string | null }
    | { homeowner_name?: string | null; phone?: string | null }[]
    | null
    | undefined
  const row = Array.isArray(raw) ? raw[0] : raw
  return {
    homeowner_name: row?.homeowner_name?.trim() || 'Unknown',
    phone: row?.phone?.trim() || 'N/A',
  }
}

// GET - Fetch single appointment
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await resolveApiRequestAuthUser(request)
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { user, accessToken } = authResult

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
    const authResult = await resolveApiRequestAuthUser(request)
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { user, accessToken } = authResult

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
      .select('*, leads(homeowner_name, phone, email)')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (fetchError || !appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    const isAssignedCloser = appointment.closer_user_id === user.id
    const canEditSchedule = canReassign || isAssignedCloser

    // Cancel = remove the appointment entirely (calendar, CRM, 444 counts). Managers only.
    if (status === 'cancelled') {
      if (!canReassign) {
        return NextResponse.json({ error: 'Only managers can cancel appointments' }, { status: 403 })
      }
      if (appointment.status === 'completed') {
        return NextResponse.json(
          { error: 'Cannot cancel a completed inspection' },
          { status: 400 }
        )
      }

      const calendarSync: { warnings: string[] } = { warnings: [] }
      const existingEventId = appointment.google_event_id as string | null
      if (existingEventId) {
        const del = await deleteGoogleEventWithFallback(adminClient, existingEventId, [
          appointment.closer_user_id,
          appointment.canvasser_user_id,
        ])
        if (!del.ok) {
          calendarSync.warnings.push(
            'Google Calendar: could not remove cancelled event (no OAuth token or delete failed). It may still appear on a calendar.'
          )
        }
      }

      await adminClient
        .from('pending_status_prompts')
        .update({ dismissed: true, completed: true })
        .eq('appointment_id', params.id)

      await adminClient
        .from('close_appointments')
        .delete()
        .eq('scheduled_appointment_id', params.id)
      await adminClient
        .from('close_appointments')
        .delete()
        .eq('source_inspection_appointment_id', params.id)

      const { error: deleteError } = await adminClient
        .from('scheduled_appointments')
        .delete()
        .eq('id', params.id)
        .eq('org_id', profile.org_id)

      if (deleteError) {
        console.error('Appointment cancel delete error:', deleteError)
        const { message, status: httpStatus } = mapScheduledAppointmentUpdateError(deleteError)
        return NextResponse.json({ error: message }, { status: httpStatus })
      }

      const canvasserId = appointment.canvasser_user_id as string | null
      if (canvasserId) {
        try {
          await syncOrgEnrollments(adminClient, profile.org_id, user.id, { userId: canvasserId })
        } catch (syncErr) {
          console.error('Appointment cancel: 444 sync failed:', syncErr)
        }
      }

      return NextResponse.json({
        success: true,
        cancelled: true,
        appointment_id: params.id,
        ...(calendarSync.warnings.length > 0 ? { calendarSync } : {}),
      })
    }

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
          recipient_user_id: appointment.closer_user_id,
          actor_user_id: user.id,
          type: 'appointment_reassigned',
          title: 'Appointment Reassigned',
          body: `Your appointment with ${homeownerLabel} has been reassigned to ${newCloser.full_name}`,
          data: { appointment_id: params.id },
        })
      }

      // Notify new closer
      await adminClient.from('notifications').insert({
        org_id: profile.org_id,
        recipient_user_id: new_closer_id,
        actor_user_id: user.id,
        type: 'new_appointment',
        title: 'New Appointment Assigned',
        body: `You have been assigned an appointment with ${homeownerLabel} on ${formatDateTimeInTimezone(appointment.scheduled_for)} ET`,
        data: { appointment_id: params.id },
      })
      // Best-effort APNs — never blocks reassignment.
      const { sendPushToUserBackground } = await import('@/lib/push-apns')
      sendPushToUserBackground(
        new_closer_id,
        'New Appointment Assigned',
        `You have been assigned an appointment with ${homeownerLabel} on ${formatDateTimeInTimezone(appointment.scheduled_for)} ET`,
        { type: 'appointment', appointment_id: params.id }
      )

      // Setter / canvasser (when not old or new assignee — those get their own notifications above)
      if (
        appointment.canvasser_user_id &&
        appointment.canvasser_user_id !== new_closer_id &&
        appointment.canvasser_user_id !== appointment.closer_user_id
      ) {
        await adminClient.from('notifications').insert({
          org_id: profile.org_id,
          recipient_user_id: appointment.canvasser_user_id,
          actor_user_id: user.id,
          type: 'appointment_reassigned',
          title: 'Appointment reassigned',
          body: `${appointment.appointment_type === 'close' ? 'Close' : 'Inspection'} for ${homeownerLabel} was reassigned to ${newCloser.full_name} by ${profile.full_name}.`,
          data: { appointment_id: params.id },
        })
      }

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
        const leadContact = leadContactFromAppointment(appointment)
        let previousCloserName = 'the previous assignee'
        if (appointment.closer_user_id) {
          const { data: oc } = await adminClient
            .from('users')
            .select('full_name')
            .eq('id', appointment.closer_user_id)
            .maybeSingle()
          if (oc?.full_name?.trim()) previousCloserName = oc.full_name.trim()
        }

        if (
          newCloser.email?.includes('@') &&
          (await isUserActiveForTransactionalEmail(adminClient, new_closer_id))
        ) {
          // Match canvass "You were assigned an inspection" for non-close; close keeps explicit Close copy
          const isClose = appointment.appointment_type === 'close'
          const subject = isClose
            ? `${typeLabel} reassigned to you — ${homeownerLabel}`
            : 'You were assigned an inspection'
          const textBody = isClose
            ? `Hi ${newCloser.full_name},\n\nYou were assigned this ${typeLabel.toLowerCase()} appointment (reassigned by ${profile.full_name}).\n\nCustomer: ${homeownerLabel}\nWhen: ${scheduledTime} ET\nAddress: ${appointment.address_text || 'TBD'}\n\nOpen: ${recordUrl}`
            : `Hi ${newCloser.full_name},\n\nYou were just assigned an inspection (reassigned by ${profile.full_name}).\n\nLead Name: ${leadContact.homeowner_name}\nAddress: ${appointment.address_text || 'TBD'}\nPhone: ${leadContact.phone}\nScheduled: ${scheduledTime} ET\n\nOpen in CRM: ${recordUrl}`
          const htmlBody = isClose
            ? `<div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #111827;">${typeLabel} reassigned to you</h2>
                <p style="color: #374151;">Hi ${newCloser.full_name},</p>
                <p style="color: #374151;">You were assigned this appointment (reassigned by <strong>${profile.full_name}</strong>).</p>
                <table style="width: 100%; border-collapse: collapse; margin: 12px 0;">
                  <tr><td style="padding: 6px 0; color: #6B7280; width: 120px;">Customer</td><td style="padding: 6px 0; color: #111827;">${homeownerLabel}</td></tr>
                  <tr><td style="padding: 6px 0; color: #6B7280;">When</td><td style="padding: 6px 0; color: #111827;">${scheduledTime} ET</td></tr>
                  <tr><td style="padding: 6px 0; color: #6B7280;">Address</td><td style="padding: 6px 0; color: #111827;">${appointment.address_text || 'TBD'}</td></tr>
                </table>
                <p style="margin: 16px 0 0;"><a href="${recordUrl}" style="color: #4f46e5;">Open in ARX CRM</a></p>
              </div>`
            : `<div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
                <h2 style="margin: 0 0 12px; color: #111827;">You were assigned an inspection</h2>
                <p style="color: #374151;">Hi ${newCloser.full_name},</p>
                <p style="color: #374151;">You were just assigned an inspection (reassigned by <strong>${profile.full_name}</strong>).</p>
                <table style="width: 100%; border-collapse: collapse; margin: 12px 0;">
                  <tr><td style="padding: 6px 0; color: #6B7280; width: 120px;">Lead Name:</td><td style="padding: 6px 0; color: #111827;">${leadContact.homeowner_name}</td></tr>
                  <tr><td style="padding: 6px 0; color: #6B7280;">Address:</td><td style="padding: 6px 0; color: #111827;">${appointment.address_text || 'TBD'}</td></tr>
                  <tr><td style="padding: 6px 0; color: #6B7280;">Phone:</td><td style="padding: 6px 0; color: #111827;">${leadContact.phone}</td></tr>
                  <tr><td style="padding: 6px 0; color: #6B7280;">Scheduled:</td><td style="padding: 6px 0; color: #111827;">${scheduledTime} ET</td></tr>
                </table>
                <p><a href="${recordUrl}" style="color: #4f46e5; text-decoration: none;">Open in CRM</a></p>
              </div>`

          await transporter.sendMail({
            from: getCrmEmailFrom(),
            to: newCloser.email,
            subject,
            text: textBody,
            html: htmlBody,
          })
        }

        if (appointment.closer_user_id) {
          const { data: prevUser } = await adminClient
            .from('users')
            .select('email, full_name')
            .eq('id', appointment.closer_user_id)
            .maybeSingle()

          if (
            prevUser?.email?.includes('@') &&
            appointment.closer_user_id &&
            (await isUserActiveForTransactionalEmail(adminClient, appointment.closer_user_id))
          ) {
            await transporter.sendMail({
              from: getCrmEmailFrom(),
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

        // Setter / canvasser: keep them in the loop when they are not the old or new assignee (those already got mail above)
        const setterId = appointment.canvasser_user_id as string | null | undefined
        if (
          setterId &&
          setterId !== appointment.closer_user_id &&
          setterId !== new_closer_id
        ) {
          const { data: setterUser } = await adminClient
            .from('users')
            .select('email, full_name')
            .eq('id', setterId)
            .maybeSingle()

          if (
            setterUser?.email?.includes('@') &&
            (await isUserActiveForTransactionalEmail(adminClient, setterId))
          ) {
            await transporter.sendMail({
              from: getCrmEmailFrom(),
              to: setterUser.email,
              subject: `${typeLabel} reassigned — ${homeownerLabel}`,
              text: `Hi ${setterUser.full_name || 'there'},\n\nThe ${typeLabel.toLowerCase()} with ${homeownerLabel} (${scheduledTime} ET) was reassigned from ${previousCloserName} to ${newCloser.full_name} by ${profile.full_name}.\n\nYou are included as a Google Calendar attendee on the new assignee's event (same as when this was first scheduled).\n\n${recordUrl}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
                  <h2 style="color: #111827;">Appointment reassigned</h2>
                  <p style="color: #374151;">Hi ${setterUser.full_name || 'there'},</p>
                  <p style="color: #374151;">The <strong>${typeLabel}</strong> for <strong>${homeownerLabel}</strong> (${scheduledTime} ET) was reassigned from <strong>${previousCloserName}</strong> to <strong>${newCloser.full_name}</strong> by ${profile.full_name}. You are added as a calendar attendee on the new assignee’s Google event (matching the original scheduling flow).</p>
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
      const { message, status } = mapScheduledAppointmentUpdateError(updateError)
      return NextResponse.json({ error: message }, { status })
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

      if (appointment.appointment_type === 'inspection') {
        const { data: redirectedPrompts, error: promptRedirectError } = await adminClient
          .from('pending_status_prompts')
          .update({ closer_user_id: new_closer_id, dismissed: false, snooze_count: 0 })
          .eq('appointment_id', params.id)
          .eq('org_id', profile.org_id)
          .eq('completed', false)
          .select('id')
        if (promptRedirectError) {
          console.error('pending_status_prompts redirect on reassignment:', promptRedirectError)
        } else if (!redirectedPrompts || redirectedPrompts.length === 0) {
          const { data: orgRow } = await adminClient
            .from('orgs')
            .select('inspection_feedback_buffer_minutes')
            .eq('id', profile.org_id)
            .maybeSingle()

          const promptAt = computeInspectionFeedbackPromptAt(
            String(updated.scheduled_for || appointment.scheduled_for || new Date().toISOString()),
            Number(updated.duration_minutes || appointment.duration_minutes || 60),
            Number(updated.buffer_after_minutes || appointment.buffer_after_minutes || 0),
            orgRow?.inspection_feedback_buffer_minutes ?? 0
          )

          const { error: promptBackfillError } = await adminClient
            .from('pending_status_prompts')
            .upsert(
              {
                org_id: profile.org_id,
                appointment_id: params.id,
                closer_user_id: new_closer_id,
                prompt_at: promptAt,
                completed: false,
                dismissed: false,
                snooze_count: 0,
              },
              { onConflict: 'appointment_id' }
            )

          if (promptBackfillError) {
            console.error('pending_status_prompts backfill on reassignment:', promptBackfillError)
          }
        }
      }

      await syncCloserAttributionDownstream(adminClient, {
        orgId: profile.org_id,
        closerUserId: new_closer_id,
        opportunityId: (appointment.opportunity_id as string | null) ?? null,
        leadId: (appointment.lead_id as string | null) ?? null,
      })
    }

    // Best-effort Google Calendar sync — non-fatal, DB update already committed
    const calendarSync: { warnings: string[] } = { warnings: [] }
    try {
      const existingEventId = appointment.google_event_id as string | null
      const homeownerName = homeownerFromAppointment(appointment)

      if (status === 'cancelled' && existingEventId) {
        // Cancellation: remove from whoever's calendar created the event (assignee + setter fallback)
        const del = await deleteGoogleEventWithFallback(adminClient, existingEventId, [
          appointment.closer_user_id,
          appointment.canvasser_user_id,
        ])
        if (!del.ok) {
          calendarSync.warnings.push(
            'Google Calendar: could not remove cancelled event (no OAuth token or delete failed). It may still appear on a calendar.'
          )
        } else {
          try {
            await adminClient
              .from('scheduled_appointments')
              .update({ google_event_id: null })
              .eq('id', params.id)
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e)
            console.error('Appointment cancel: clearing google_event_id failed:', msg)
          }
        }

      } else if (new_closer_id && new_closer_id !== appointment.closer_user_id) {
        // Reassignment: delete from old calendar (assignee + setter fallback), create on new closer's calendar

        if (existingEventId) {
          const del = await deleteGoogleEventWithFallback(adminClient, existingEventId, [
            appointment.closer_user_id,
            appointment.canvasser_user_id,
          ])
          if (!del.ok) {
            calendarSync.warnings.push(
              'Google Calendar: could not remove event from previous assignee (or setter); old calendar copy may still exist.'
            )
          }
        }

        const newToken = await getValidAccessToken(adminClient, new_closer_id)
        const startIso = updated.scheduled_for as string
        const endIso = new Date(
          new Date(startIso).getTime() + (updated.duration_minutes || 60) * 60 * 1000
        ).toISOString()
        const typeLabel = appointment.appointment_type === 'close' ? 'Close' : 'Inspection'
        const eventNotes = notes !== undefined ? notes : appointment.notes

        let setterInviteEmail: string | null = null
        if (appointment.canvasser_user_id) {
          const { data: setterRow } = await adminClient
            .from('users')
            .select('email')
            .eq('id', appointment.canvasser_user_id)
            .maybeSingle()
          if (setterRow?.email?.includes('@')) {
            setterInviteEmail = setterRow.email.trim()
          }
        }
        const newCloserRow = await adminClient
          .from('users')
          .select('email')
          .eq('id', new_closer_id)
          .maybeSingle()
        const newCloserEmailLower = newCloserRow.data?.email?.trim().toLowerCase() ?? ''
        const attendees =
          setterInviteEmail &&
          setterInviteEmail.toLowerCase() !== newCloserEmailLower
            ? [{ email: setterInviteEmail }]
            : undefined

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
                ...(attendees ? { attendees } : {}),
              },
              'primary',
              attendees ? 'all' : 'none'
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
