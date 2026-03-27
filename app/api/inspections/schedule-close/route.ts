import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createCalendarEvent, refreshAccessToken, type CalendarEvent } from '@/lib/google-calendar'
import { sendSetterEmail } from '@/lib/setter-email'
import { assignNextAvailableCloser, getDefaultTeam } from '@/lib/round-robin'
import {
  fetchOrgAppointmentTypesFromTable,
  getCloseSlotBufferAfterFromTable,
  getCloseSlotDurationFromTable,
} from '@/lib/org-appointment-types'

/** Setter = canvasser on the inspection appt, else lead owner. Inspector = inspection closer (prior visit). */
async function resolveSetterAndInspectorDisplayNames(
  admin: ReturnType<typeof createServiceClient>,
  originalAppointment: {
    canvasser_user_id: string | null
    closer_user_id: string | null
    leads?: { owner_user_id?: string | null } | null
  }
): Promise<{ setterName: string | null; inspectorName: string | null }> {
  const lead = originalAppointment.leads
  const setterId =
    originalAppointment.canvasser_user_id || lead?.owner_user_id || null
  const inspectorId = originalAppointment.closer_user_id || null

  const rawIds = [setterId, inspectorId].filter((id): id is string => Boolean(id))
  const ids = rawIds.filter((id, i) => rawIds.indexOf(id) === i)
  if (ids.length === 0) return { setterName: null, inspectorName: null }

  const { data: rows } = await admin.from('users').select('id, full_name').in('id', ids)
  const map = new Map((rows || []).map((u) => [u.id, u.full_name as string | null]))

  return {
    setterName: setterId ? map.get(setterId) ?? null : null,
    inspectorName: inspectorId ? map.get(inspectorId) ?? null : null,
  }
}

function buildCloseCalendarDescription(params: {
  customerName: string
  address: string
  notes?: string | null
  setterName: string | null
  inspectorName: string | null
}): string {
  const lines = [
    `Customer: ${params.customerName}`,
    params.address ? `Address: ${params.address}` : '',
    params.setterName ? `Setter: ${params.setterName}` : '',
    params.inspectorName ? `Inspector: ${params.inspectorName}` : '',
    params.notes ? `Notes: ${params.notes}` : '',
  ].filter(Boolean)
  return lines.join('\n')
}

async function getValidAccessTokenForUser(admin: ReturnType<typeof createServiceClient>, userId: string): Promise<string | null> {
  const { data: tokenData } = await admin
    .from('user_google_tokens')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (!tokenData) return null

  const expiresAt = new Date(tokenData.expires_at)
  const now = new Date()

  if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
    try {
      const refreshed = await refreshAccessToken(tokenData.refresh_token)
      await admin
        .from('user_google_tokens')
        .update({
          access_token: refreshed.access_token,
          expires_at: refreshed.expires_at.toISOString(),
        })
        .eq('user_id', userId)
      return refreshed.access_token
    } catch {
      return null
    }
  }

  return tokenData.access_token
}

async function getTimezoneForCloser(admin: ReturnType<typeof createServiceClient>, userId: string): Promise<string> {
  try {
    const { data: userProfile } = await admin.from('users').select('team_id').eq('id', userId).single()
    if (userProfile?.team_id) {
      const { data: team } = await admin.from('teams').select('timezone').eq('id', userProfile.team_id).single()
      if (team?.timezone) return team.timezone
    }
  } catch {
    /* default */
  }
  return 'America/New_York'
}

/** Event on closer's primary calendar; setter gets a Google invite when email differs from closer. */
async function upsertCloseEventOnCloserCalendar(
  admin: ReturnType<typeof createServiceClient>,
  supabase: SupabaseClient,
  params: {
    closerUserId: string
    localDateTimeStr: string
    closeDurationMinutes: number
    summary: string
    description: string
    location: string
    setterUserId: string | null
    scheduledAppointmentId: string
  }
): Promise<string | null> {
  const accessToken = await getValidAccessTokenForUser(admin, params.closerUserId)
  if (!accessToken) {
    console.error(
      'upsertCloseEventOnCloserCalendar: no Google token for closer — calendar will not sync',
      params.closerUserId
    )
    return null
  }
  const timezone = await getTimezoneForCloser(admin, params.closerUserId)

  const [datePart, timePart] = params.localDateTimeStr.split('T')
  const timeOnly = timePart?.split(':') || ['00', '00']
  let endHour = parseInt(timeOnly[0], 10)
  let endMin = parseInt(timeOnly[1], 10) + params.closeDurationMinutes
  while (endMin >= 60) {
    endMin -= 60
    endHour += 1
  }
  const startDateTime = `${params.localDateTimeStr}:00`
  const endDateTime = `${datePart}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00`

  let setterEmail: string | null = null
  if (params.setterUserId && params.setterUserId !== params.closerUserId) {
    const { data: setterRow } = await admin.from('users').select('email').eq('id', params.setterUserId).maybeSingle()
    if (setterRow?.email && String(setterRow.email).includes('@')) {
      setterEmail = setterRow.email
    }
  }

  const event: CalendarEvent = {
    summary: params.summary,
    description: params.description,
    location: params.location || undefined,
    start: { dateTime: startDateTime, timeZone: timezone },
    end: { dateTime: endDateTime, timeZone: timezone },
    attendees: setterEmail ? [{ email: setterEmail }] : undefined,
  }

  try {
    const createdEv = await createCalendarEvent(
      accessToken,
      event,
      'primary',
      setterEmail ? 'all' : 'none'
    )
    if (createdEv?.id) {
      await supabase
        .from('scheduled_appointments')
        .update({ google_event_id: createdEv.id })
        .eq('id', params.scheduledAppointmentId)
      return createdEv.id
    }
  } catch (e) {
    console.error('upsertCloseEventOnCloserCalendar failed:', e)
  }
  return null
}

export async function POST(request: NextRequest) {
  try {
    const authClient = createServerClient()
    const admin = createServiceClient()

    const {
      data: { user },
    } = await authClient.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      original_appointment_id,
      scheduled_for,
      notes,
      use_round_robin,
      team_id: teamIdOverride,
      closer_user_id: closerUserIdBody,
    } = body as {
      original_appointment_id: string
      scheduled_for: string
      notes?: string
      /** Use team round-robin (same as canvass / scheduling) to assign the closer — recommended from inspection feedback "Moving to Close". */
      use_round_robin?: boolean
      team_id?: string
      /** When not using round-robin: assign this org closer (same as canvass individual). Omit to use the current user as closer. */
      closer_user_id?: string
    }

    if (!original_appointment_id || !scheduled_for) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Service role: same as /api/inspections/status — RLS + missing public.users rows caused "Profile not found".
    let { data: profile } = await admin
      .from('users')
      .select('org_id, full_name, google_calendar_id, google_refresh_token')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile?.org_id) {
      const { data: apptOrg } = await admin
        .from('scheduled_appointments')
        .select('org_id')
        .eq('id', original_appointment_id)
        .maybeSingle()
      const derivedOrgId = apptOrg?.org_id ?? null
      if (!derivedOrgId) {
        return NextResponse.json({ error: 'Profile not found' }, { status: 400 })
      }

      const fallbackName =
        (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()) ||
        user.email ||
        'User'

      const { data: recoveredProfile } = await admin
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
        .select('org_id, full_name, google_calendar_id, google_refresh_token')
        .maybeSingle()

      profile =
        recoveredProfile ||
        ({
          org_id: derivedOrgId,
          full_name: fallbackName,
          google_calendar_id: null,
          google_refresh_token: null,
        } as {
          org_id: string
          full_name: string | null
          google_calendar_id: string | null
          google_refresh_token: string | null
        })
    }

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 400 })
    }

    // Get original appointment details (admin avoids RLS gaps vs anon client)
    const { data: originalAppointment, error: appointmentError } = await admin
      .from('scheduled_appointments')
      .select('*, leads(*)')
      .eq('id', original_appointment_id)
      .single()

    if (appointmentError || !originalAppointment) {
      return NextResponse.json({ error: 'Original appointment not found' }, { status: 404 })
    }

    const supabase = authClient
    const { data: orgRow } = await admin
      .from('orgs')
      .select('inspection_feedback_buffer_minutes, default_scheduling_gap_minutes')
      .eq('id', profile.org_id)
      .single()

    const defaultGap = orgRow?.default_scheduling_gap_minutes ?? 15
    const tableTypes = await fetchOrgAppointmentTypesFromTable(admin, profile.org_id)
    const bufferAfter = getCloseSlotBufferAfterFromTable(tableTypes, 'close', defaultGap)
    const closeDurationMinutes = getCloseSlotDurationFromTable(
      tableTypes,
      'close',
      originalAppointment.duration_minutes ?? 60
    )

    const { setterName: setterDisplayName, inspectorName: inspectorDisplayName } =
      await resolveSetterAndInspectorDisplayNames(admin, originalAppointment)

    // Parse the scheduled_for - it's a local time string like "YYYY-MM-DDTHH:MM"
    let scheduledForISO: string
    let localDateTimeStr: string
    
    if (scheduled_for.includes('Z') || scheduled_for.includes('+')) {
      scheduledForISO = scheduled_for
      localDateTimeStr = scheduled_for.slice(0, 16)
    } else {
      localDateTimeStr = scheduled_for.length === 16 ? scheduled_for : scheduled_for.slice(0, 16)
      const [datePart, timePart] = localDateTimeStr.split('T')
      const [year, month, day] = datePart.split('-').map(Number)
      const [hour, minute] = timePart.split(':').map(Number)
      const localDate = new Date(year, month - 1, day, hour, minute)
      scheduledForISO = localDate.toISOString()
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    let closeAppointment: any = null

    if (use_round_robin) {
      if (!serviceKey) {
        return NextResponse.json({ error: 'Round-robin scheduling is not configured' }, { status: 500 })
      }

      const { data: inspectionCloser } = await admin
        .from('users')
        .select('team_id')
        .eq('id', originalAppointment.closer_user_id)
        .maybeSingle()

      const { data: inspectorProfile } = await admin
        .from('users')
        .select('team_id')
        .eq('id', user.id)
        .maybeSingle()

      const teamId =
        teamIdOverride ||
        inspectionCloser?.team_id ||
        inspectorProfile?.team_id ||
        (await getDefaultTeam(admin, profile.org_id))

      if (!teamId) {
        return NextResponse.json(
          {
            error:
              'No team found for round-robin. Assign the inspection closer to a team, or pass team_id.',
          },
          { status: 400 }
        )
      }

      const scheduledForDate = new Date(scheduledForISO)
      const assignment = await assignNextAvailableCloser(
        supabaseUrl,
        serviceKey,
        teamId,
        scheduledForDate,
        closeDurationMinutes,
        originalAppointment.lead_id,
        originalAppointment.opportunity_id || undefined,
        originalAppointment.address_text || originalAppointment.leads?.address_text || undefined,
        originalAppointment.canvasser_user_id,
        profile.org_id,
        undefined,
        {
          homeownerName: originalAppointment.leads?.homeowner_name,
          phone: originalAppointment.leads?.phone,
          notes: notes || undefined,
          setterName: setterDisplayName,
          inspectorName: inspectorDisplayName,
          eventLabel: 'close',
        },
        orgRow?.default_scheduling_gap_minutes ?? 15,
        bufferAfter
      )

      if (!assignment.success || !assignment.appointmentId) {
        return NextResponse.json(
          { error: assignment.error || 'No available closer for this time slot' },
          { status: 409 }
        )
      }

      const closeNotes =
        notes ||
        `Close appointment - follow up from inspection on ${new Date(originalAppointment.scheduled_for).toLocaleDateString()}`

      const { error: patchErr } = await admin
        .from('scheduled_appointments')
        .update({
          appointment_type: 'close',
          notes: closeNotes,
          buffer_after_minutes: bufferAfter,
        })
        .eq('id', assignment.appointmentId)

      if (patchErr) {
        console.error('Failed to tag round-robin appointment as close:', patchErr)
      }

      const { data: rrAppointment } = await admin
        .from('scheduled_appointments')
        .select('*, leads(homeowner_name, address_text, phone)')
        .eq('id', assignment.appointmentId)
        .single()

      closeAppointment = rrAppointment

      const assignedCloserName = assignment.closerName || 'Closer'

      if (originalAppointment.canvasser_user_id && originalAppointment.canvasser_user_id !== user.id) {
        const customerName = originalAppointment.leads?.homeowner_name || 'Customer'
        const customerAddress =
          originalAppointment.leads?.address_text || originalAppointment.address_text || ''

        await supabase.from('notifications').insert({
          org_id: profile.org_id,
          recipient_user_id: originalAppointment.canvasser_user_id,
          actor_user_id: user.id,
          type: 'inspection_outcome',
          title: `Close Appointment Scheduled - ${customerName}`,
          body: `${profile.full_name || 'Rep'} scheduled a close appointment. Assigned closer: ${assignedCloserName}.\n\nCustomer: ${customerName}\nAddress: ${customerAddress}\nScheduled: ${new Date(scheduledForISO).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}\n\n${notes ? `Notes: ${notes}` : ''}`,
          data: {
            appointment_id: assignment.appointmentId,
            original_appointment_id,
            opportunity_id: originalAppointment.opportunity_id,
            lead_id: originalAppointment.lead_id,
            closer_name: assignedCloserName,
            round_robin: true,
          },
        })

        try {
          const { data: setterUser } = await supabase
            .from('users')
            .select('email, full_name')
            .eq('id', originalAppointment.canvasser_user_id)
            .single()
          if (setterUser?.email) {
            const whenLabel = new Date(scheduledForISO).toLocaleString('en-US', {
              timeZone: 'America/New_York',
              dateStyle: 'full',
              timeStyle: 'short',
            })
            await sendSetterEmail({
              to: setterUser.email,
              setterName: setterUser.full_name,
              subject: `Close appointment scheduled: ${customerName}`,
              introHtml: `<p style="color: #374151;">${profile.full_name || 'Your rep'} scheduled a close appointment. <strong>Assigned closer: ${assignedCloserName}</strong>.</p>`,
              rows: [
                { label: 'Customer', value: customerName },
                { label: 'Address', value: customerAddress || 'N/A' },
                { label: 'Scheduled', value: `${whenLabel} ET` },
                ...(notes ? [{ label: 'Notes', value: notes }] : []),
              ],
            })
          }
        } catch (e) {
          console.error('Close appointment setter email failed:', e)
        }
      }

      await supabase.from('activities').insert({
        org_id: profile.org_id,
        opportunity_id: originalAppointment.opportunity_id,
        lead_id: originalAppointment.lead_id,
        user_id: user.id,
        type: 'appointment_scheduled',
        body: `Close appointment scheduled (round-robin → ${assignedCloserName}) for ${new Date(scheduledForISO).toLocaleString()}${notes ? ` - ${notes}` : ''}`,
      })

      if (originalAppointment.opportunity_id && assignment.appointmentId) {
        const { error: closeRowError } = await supabase.from('close_appointments').insert({
          org_id: profile.org_id,
          opportunity_id: originalAppointment.opportunity_id,
          scheduled_appointment_id: assignment.appointmentId,
          scheduled_for: scheduledForISO,
        })
        if (closeRowError) {
          console.error('close_appointments insert (non-fatal):', closeRowError)
        }
      }

      // Round-robin creates the calendar event inside assignNextAvailableCloser; if that failed
      // (token/API), the appointment row may exist without google_event_id — sync here.
      if (!assignment.googleEventId && assignment.closerId && assignment.appointmentId) {
        const customerName = originalAppointment.leads?.homeowner_name || 'Customer'
        const address = originalAppointment.address_text || originalAppointment.leads?.address_text || ''
        const backupEventId = await upsertCloseEventOnCloserCalendar(admin, supabase, {
          closerUserId: assignment.closerId,
          localDateTimeStr,
          closeDurationMinutes,
          summary: `Close: ${customerName}`,
          description: buildCloseCalendarDescription({
            customerName,
            address,
            notes: closeNotes,
            setterName: setterDisplayName,
            inspectorName: inspectorDisplayName,
          }),
          location: address,
          setterUserId: originalAppointment.canvasser_user_id,
          scheduledAppointmentId: assignment.appointmentId,
        })
        if (backupEventId && closeAppointment && typeof closeAppointment === 'object') {
          closeAppointment = { ...closeAppointment, google_event_id: backupEventId }
        }
      }

      return NextResponse.json({
        success: true,
        appointment: closeAppointment,
        assigned_closer: { id: assignment.closerId, name: assignment.closerName },
        round_robin: true,
        google_calendar_event_id: closeAppointment?.google_event_id ?? assignment.googleEventId ?? null,
      })
    }

    // Manual: assign to a specific closer (or current user) — same as canvass "individual closer"
    let manualCloserId = user.id
    if (closerUserIdBody && typeof closerUserIdBody === 'string') {
      const { data: closerRow } = await admin
        .from('users')
        .select('id, org_id, active')
        .eq('id', closerUserIdBody)
        .maybeSingle()
      if (!closerRow || closerRow.org_id !== profile.org_id || closerRow.active === false) {
        return NextResponse.json({ error: 'Invalid closer for this organization' }, { status: 400 })
      }
      manualCloserId = closerUserIdBody
    }

    const { data: assignedCloserRow } = await admin
      .from('users')
      .select('full_name')
      .eq('id', manualCloserId)
      .single()
    const assignedCloserName = assignedCloserRow?.full_name || 'Closer'

    const { data: insertedClose, error: createError } = await supabase
      .from('scheduled_appointments')
      .insert({
        org_id: profile.org_id,
        lead_id: originalAppointment.lead_id,
        opportunity_id: originalAppointment.opportunity_id,
        closer_user_id: manualCloserId,
        canvasser_user_id: originalAppointment.canvasser_user_id,
        scheduled_for: scheduledForISO,
        duration_minutes: closeDurationMinutes,
        buffer_after_minutes: bufferAfter,
        status: 'scheduled',
        address_text: originalAppointment.address_text,
        notes: notes || `Close appointment - follow up from inspection on ${new Date(originalAppointment.scheduled_for).toLocaleDateString()}`,
        appointment_type: 'close',
      })
      .select()
      .single()

    if (createError) {
      console.error('Create close appointment error:', createError)
      return NextResponse.json({ error: 'Failed to create close appointment' }, { status: 500 })
    }

    closeAppointment = insertedClose

    let manualGoogleCalendarEventId: string | null = null
    {
      const customerName = originalAppointment.leads?.homeowner_name || 'Customer'
      const address = originalAppointment.address_text || originalAppointment.leads?.address_text || ''
      manualGoogleCalendarEventId = await upsertCloseEventOnCloserCalendar(admin, supabase, {
        closerUserId: manualCloserId,
        localDateTimeStr,
        closeDurationMinutes,
        summary: `Close: ${customerName}`,
        description: buildCloseCalendarDescription({
          customerName,
          address,
          notes: notes || undefined,
          setterName: setterDisplayName,
          inspectorName: inspectorDisplayName,
        }),
        location: address,
        setterUserId: originalAppointment.canvasser_user_id,
        scheduledAppointmentId: closeAppointment.id,
      })
    }

    // Notify the setter about the close appointment (inspector scheduling on behalf of a closer)
    if (originalAppointment.canvasser_user_id && originalAppointment.canvasser_user_id !== user.id) {
      const customerName = originalAppointment.leads?.homeowner_name || 'Customer'
      const customerAddress = originalAppointment.leads?.address_text || originalAppointment.address_text || ''

      await supabase
        .from('notifications')
        .insert({
          org_id: profile.org_id,
          recipient_user_id: originalAppointment.canvasser_user_id,
          actor_user_id: user.id,
          type: 'inspection_outcome',
          title: `Close Appointment Scheduled - ${customerName}`,
          body: `Great news! ${assignedCloserName} has a close appointment scheduled.\n\nCustomer: ${customerName}\nAddress: ${customerAddress}\nScheduled: ${new Date(scheduledForISO).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}\n\n${notes ? `Notes: ${notes}` : ''}`,
          data: {
            appointment_id: closeAppointment.id,
            original_appointment_id,
            opportunity_id: originalAppointment.opportunity_id,
            lead_id: originalAppointment.lead_id,
            closer_name: assignedCloserName,
          },
        })

      try {
        const { data: setterUser } = await supabase
          .from('users')
          .select('email, full_name')
          .eq('id', originalAppointment.canvasser_user_id)
          .single()
        if (setterUser?.email) {
          const whenLabel = new Date(scheduledForISO).toLocaleString('en-US', {
            timeZone: 'America/New_York',
            dateStyle: 'full',
            timeStyle: 'short',
          })
          await sendSetterEmail({
            to: setterUser.email,
            setterName: setterUser.full_name,
            subject: `Close appointment scheduled: ${customerName}`,
            introHtml: `<p style="color: #374151;"><strong>${assignedCloserName}</strong> is assigned for the close appointment (scheduled by ${profile.full_name || 'your team'}).</p>`,
            rows: [
              { label: 'Customer', value: customerName },
              { label: 'Address', value: customerAddress || 'N/A' },
              { label: 'Scheduled', value: `${whenLabel} ET` },
              ...(notes ? [{ label: 'Notes', value: notes }] : []),
            ],
          })
        }
      } catch (e) {
        console.error('Close appointment setter email failed:', e)
      }
    }

    // Create activity record
    await supabase
      .from('activities')
      .insert({
        org_id: profile.org_id,
        opportunity_id: originalAppointment.opportunity_id,
        lead_id: originalAppointment.lead_id,
        user_id: user.id,
        type: 'appointment_scheduled',
        body: `Close appointment for ${assignedCloserName} on ${new Date(scheduledForISO).toLocaleString()}${notes ? ` - ${notes}` : ''}`,
      })

    // Persist a close_appointments row for opportunity UI / close-feedback flow (non-fatal if table missing).
    if (originalAppointment.opportunity_id && closeAppointment?.id) {
      const { error: closeRowError } = await supabase.from('close_appointments').insert({
        org_id: profile.org_id,
        opportunity_id: originalAppointment.opportunity_id,
        scheduled_appointment_id: closeAppointment.id,
        scheduled_for: scheduledForISO,
      })
      if (closeRowError) {
        console.error('close_appointments insert (non-fatal):', closeRowError)
      }
    }

    return NextResponse.json({
      success: true,
      appointment: closeAppointment,
      assigned_closer: { id: manualCloserId, name: assignedCloserName },
      round_robin: false,
      google_calendar_event_id: manualGoogleCalendarEventId ?? closeAppointment?.google_event_id ?? null,
    })

  } catch (error) {
    console.error('Schedule close error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
