import { updateCalendarEvent, deleteCalendarEvent, createCalendarEvent, refreshAccessToken } from '@/lib/google-calendar'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getSessionFromRequest(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
  const cookieName = `sb-${projectRef}-auth-token`
  
  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      const decoded = decodeURIComponent(singleCookie.value)
      return JSON.parse(decoded)
    } catch {
      return null
    }
  }
  
  const chunks: string[] = []
  let i = 0
  while (true) {
    const chunk = req.cookies.get(`${cookieName}.${i}`)
    if (!chunk?.value) break
    chunks.push(chunk.value)
    i++
  }
  
  if (chunks.length > 0) {
    try {
      const decoded = decodeURIComponent(chunks.join(''))
      return JSON.parse(decoded)
    } catch {
      return null
    }
  }
  
  return null
}

function getAuthClient(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const sessionData = getSessionFromRequest(req)
  
  return {
    client: createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: sessionData?.access_token
        ? { headers: { Authorization: `Bearer ${sessionData.access_token}` } }
        : undefined,
    }),
    accessToken: sessionData?.access_token,
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
      .select('org_id, role, full_name')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Check if user is manager or above for reassignment
    const isManager = ['admin', 'regional_manager', 'sales_manager'].includes(profile.role)

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
    const canEditSchedule = isManager || isAssignedCloser

    const updateData: Record<string, any> = {}

    // Handle reassignment (managers only)
    if (new_closer_id && new_closer_id !== appointment.closer_user_id) {
      if (!isManager) {
        return NextResponse.json({ error: 'Only managers can reassign appointments' }, { status: 403 })
      }

      // Verify new closer exists in same org
      const { data: newCloser } = await adminClient
        .from('users')
        .select('id, full_name, org_id')
        .eq('id', new_closer_id)
        .eq('org_id', profile.org_id)
        .single()

      if (!newCloser) {
        return NextResponse.json({ error: 'New closer not found' }, { status: 404 })
      }

      updateData.closer_user_id = new_closer_id

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
          body: `Your appointment with ${appointment.leads?.homeowner_name || 'customer'} has been reassigned to ${newCloser.full_name}`,
          data: { appointment_id: params.id },
        })
      }

      // Notify new closer
      await adminClient.from('notifications').insert({
        org_id: profile.org_id,
        user_id: new_closer_id,
        type: 'new_appointment',
        title: 'New Appointment Assigned',
        body: `You have been assigned an appointment with ${appointment.leads?.homeowner_name || 'customer'} on ${new Date(appointment.scheduled_for).toLocaleDateString()}`,
        data: { appointment_id: params.id },
      })
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

    // Best-effort Google Calendar sync — non-fatal, DB update already committed
    try {
      const existingEventId = appointment.google_event_id as string | null

      if (status === 'cancelled' && existingEventId && appointment.closer_user_id) {
        // Cancellation: delete the event from the current closer's calendar
        const token = await getValidAccessToken(adminClient, appointment.closer_user_id)
        if (token) {
          await deleteCalendarEvent(token, existingEventId).catch(() => {})
          await adminClient
            .from('scheduled_appointments')
            .update({ google_event_id: null })
            .eq('id', params.id)
        }

      } else if (new_closer_id && new_closer_id !== appointment.closer_user_id) {
        // Reassignment: delete from old closer's calendar, create on new closer's calendar

        if (existingEventId && appointment.closer_user_id) {
          const oldToken = await getValidAccessToken(adminClient, appointment.closer_user_id)
          if (oldToken) {
            await deleteCalendarEvent(oldToken, existingEventId).catch(() => {})
          }
        }

        const newToken = await getValidAccessToken(adminClient, new_closer_id)
        const startIso = updated.scheduled_for as string
        const endIso = new Date(
          new Date(startIso).getTime() + (updated.duration_minutes || 60) * 60 * 1000
        ).toISOString()
        const typeLabel = appointment.appointment_type === 'close' ? 'Close' : 'Inspection'
        const homeownerName = (appointment.leads as any)?.homeowner_name || 'Customer'
        const eventNotes = notes !== undefined ? notes : appointment.notes

        let newEventId: string | null = null
        if (newToken) {
          const created = await createCalendarEvent(newToken, {
            summary: `${typeLabel}: ${homeownerName}`,
            ...(eventNotes && { description: eventNotes }),
            ...(appointment.address_text && { location: appointment.address_text }),
            start: { dateTime: startIso },
            end: { dateTime: endIso },
          }, 'primary', 'none').catch(() => null)
          newEventId = created?.id ?? null
        }

        // Always update google_event_id — either new ID or null (old ID is now invalid)
        await adminClient
          .from('scheduled_appointments')
          .update({ google_event_id: newEventId })
          .eq('id', params.id)

      } else if (existingEventId && updated.closer_user_id) {
        // In-place update: time, notes, location, title (same calendar / closer)
        const token = await getValidAccessToken(adminClient, updated.closer_user_id)
        if (token) {
          const startIso = updated.scheduled_for as string
          const dur = updated.duration_minutes || 60
          const endIso = new Date(new Date(startIso).getTime() + dur * 60 * 1000).toISOString()
          const typeLabel = updated.appointment_type === 'close' ? 'Close' : 'Inspection'
          const homeownerName = (appointment.leads as any)?.homeowner_name || 'Customer'
          await updateCalendarEvent(token, existingEventId, {
            summary: `${typeLabel}: ${homeownerName}`,
            start: { dateTime: startIso },
            end: { dateTime: endIso },
            ...(updated.address_text ? { location: updated.address_text } : {}),
            ...(updated.notes != null && String(updated.notes).length > 0
              ? { description: String(updated.notes) }
              : {}),
          }).catch(() => {})
        }
      }
    } catch {
      // Calendar sync failure is non-fatal
    }

    return NextResponse.json({ success: true, appointment: updated })
  } catch (error) {
    console.error('Appointment update error:', error)
    return NextResponse.json({ error: 'Failed to update appointment' }, { status: 500 })
  }
}
