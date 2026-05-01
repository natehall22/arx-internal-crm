import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  mapLatestInspectionByLeadId,
  mapLatestInspectionByOpportunityId,
  withEffectiveInspectionFields,
} from '@/lib/effective-inspection-state'
import {
  canViewInsideSalesFollowUp,
  hasActiveInsideSalesFollowUp,
  isInsideSalesRoleLike,
} from '@/lib/inside-sales-follow-up'
import { assignNextAvailableCloser, getDefaultTeam } from '@/lib/round-robin'
import {
  fetchOrgAppointmentTypesFromTable,
  getInspectionBufferAfterFromTable,
  getInspectionDurationFromTable,
} from '@/lib/org-appointment-types'
import { createCalendarEvent, refreshAccessToken, type CalendarEvent } from '@/lib/google-calendar'
import { fromZonedTime } from 'date-fns-tz'
import { computeInspectionFeedbackPromptAt } from '@/lib/scheduling-prompt'

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

type ActionType =
  | 'claim_self'
  | 'log_call'
  | 'log_text'
  | 'mark_rescheduled'
  | 'mark_unresponsive'
  | 'mark_lost'
  | 'schedule_back_to_closer'

async function getValidAccessToken(adminClient: ReturnType<typeof getAdminClient>, userId: string): Promise<string | null> {
  const { data: tokenData } = await adminClient
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
      await adminClient
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

async function getTimezoneForUser(adminClient: ReturnType<typeof getAdminClient>, userId: string): Promise<string> {
  try {
    const { data: userProfile } = await adminClient
      .from('users')
      .select('team_id')
      .eq('id', userId)
      .single()
    if (userProfile?.team_id) {
      const { data: team } = await adminClient
        .from('teams')
        .select('timezone')
        .eq('id', userProfile.team_id)
        .single()
      if (team?.timezone) return team.timezone
    }
  } catch {
    /* default */
  }
  return 'America/New_York'
}

function buildInspectionCalendarDescription(params: {
  customerName: string
  phone?: string | null
  address?: string | null
  note?: string | null
}): string {
  return [
    `Customer: ${params.customerName}`,
    params.phone ? `Phone: ${params.phone}` : '',
    params.address ? `Address: ${params.address}` : '',
    params.note ? `Inside Sales Notes:\n${params.note}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

async function createInspectionEventOnCloserCalendar(
  adminClient: ReturnType<typeof getAdminClient>,
  params: {
    closerUserId: string
    scheduledAppointmentId: string
    localDateTimeStr: string
    inspectionDuration: number
    customerName: string
    phone?: string | null
    address?: string | null
    note?: string | null
  }
): Promise<string | null> {
  const accessToken = await getValidAccessToken(adminClient, params.closerUserId)
  if (!accessToken) return null

  const timezone = await getTimezoneForUser(adminClient, params.closerUserId)
  const [datePart, timePart] = params.localDateTimeStr.split('T')
  const [hourPart, minutePart] = timePart.split(':').map(Number)
  let endHour = hourPart
  let endMin = minutePart + params.inspectionDuration
  while (endMin >= 60) {
    endMin -= 60
    endHour += 1
  }

  const event: CalendarEvent = {
    summary: `Inspection: ${params.customerName}`,
    description: buildInspectionCalendarDescription(params),
    location: params.address || undefined,
    start: { dateTime: `${params.localDateTimeStr}:00`, timeZone: timezone },
    end: {
      dateTime: `${datePart}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00`,
      timeZone: timezone,
    },
  }

  const createdEvent = await createCalendarEvent(accessToken, event, 'primary', 'none')
  if (!createdEvent?.id) return null

  await adminClient
    .from('scheduled_appointments')
    .update({ google_event_id: createdEvent.id })
    .eq('id', params.scheduledAppointmentId)

  return createdEvent.id
}

export async function POST(
  request: NextRequest,
  context: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const { id: opportunityId } = await context.params
    const { client: authClient, accessToken } = getAuthClient(request)

    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()

    const { data: profile } = await admin
      .from('users')
      .select('id, org_id, role, full_name, custom_role:custom_roles(name, display_name)')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const profileCustomRole = Array.isArray((profile as any).custom_role)
      ? (profile as any).custom_role[0]
      : (profile as any).custom_role

    if (
      !canViewInsideSalesFollowUp({
        role: profile.role,
        customRoleName: profileCustomRole?.name || null,
        customRoleDisplayName: profileCustomRole?.display_name || null,
      })
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [{ data: opportunity }, { data: orgRow }] = await Promise.all([
      admin
        .from('opportunities')
        .select('id, org_id, lead_id, status, inspection_outcome, inspection_outcome_at, notes, created_at, updated_at, inspection_notes')
        .eq('id', opportunityId)
        .eq('org_id', profile.org_id)
        .single(),
      admin.from('orgs').select('settings').eq('id', profile.org_id).maybeSingle(),
    ])

    if (!opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    const opportunityForFollowUp = {
      ...opportunity,
      pipeline_stage: null,
      assigned_user_id: null,
      follow_up_at: null,
    }

    const inspectionOutcomeSettings = orgRow?.settings?.inspection_outcomes

    const [{ data: oppInspectionRows }, { data: leadInspectionRows }] = await Promise.all([
      admin
        .from('inspection_status_updates')
        .select('opportunity_id, lead_id, outcome, notes, created_at')
        .eq('opportunity_id', opportunityId)
        .order('created_at', { ascending: false }),
      opportunity.lead_id
        ? admin
            .from('inspection_status_updates')
            .select('opportunity_id, lead_id, outcome, notes, created_at')
            .eq('lead_id', opportunity.lead_id)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] as any[] }),
    ])

    const inspectionByOpportunityId = mapLatestInspectionByOpportunityId(oppInspectionRows || [])
    const inspectionByLeadId = mapLatestInspectionByLeadId(leadInspectionRows || [])
    const opportunityEffective = withEffectiveInspectionFields(
      opportunityForFollowUp as any,
      inspectionByOpportunityId,
      inspectionByLeadId
    )

    if (!hasActiveInsideSalesFollowUp(opportunityEffective, inspectionOutcomeSettings)) {
      return NextResponse.json({ error: 'No active inside sales follow-up for this opportunity' }, { status: 400 })
    }

    const body = await request.json()
    const action = String(body.action || '') as ActionType
    const note = typeof body.note === 'string' ? body.note.trim() : ''
    const result = typeof body.result === 'string' ? body.result.trim() : ''
    const schedule = body.schedule && typeof body.schedule === 'object' ? body.schedule : null

    if (!action) {
      return NextResponse.json({ error: 'Missing action' }, { status: 400 })
    }

    const updateData: Record<string, unknown> = {}
    let activityType: 'call' | 'text' | 'status_change' | null = null
    let activityBody: string | null = null

    if (action === 'schedule_back_to_closer') {
      if (!schedule?.scheduledLocal) {
        return NextResponse.json({ error: 'Missing scheduled time' }, { status: 400 })
      }

      const { data: originalAppointment, error: originalAppointmentError } = await admin
        .from('scheduled_appointments')
        .select('id, org_id, lead_id, opportunity_id, closer_user_id, canvasser_user_id, address_text, scheduled_for, leads(homeowner_name, phone, address_text)')
        .eq('opportunity_id', opportunityId)
        .eq('org_id', profile.org_id)
        .eq('appointment_type', 'inspection')
        .order('scheduled_for', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (originalAppointmentError || !originalAppointment) {
        return NextResponse.json({ error: 'Original inspection appointment not found' }, { status: 404 })
      }

      const appointmentTypeRows = await fetchOrgAppointmentTypesFromTable(admin, profile.org_id)
      const inspectionDuration = getInspectionDurationFromTable(appointmentTypeRows, 60)
      const { data: orgRow } = await admin
        .from('orgs')
        .select('default_scheduling_gap_minutes')
        .eq('id', profile.org_id)
        .single()
      const defaultGap = orgRow?.default_scheduling_gap_minutes ?? 15
      const bufferAfter = getInspectionBufferAfterFromTable(appointmentTypeRows, defaultGap)

      const localDateTimeStr = String(schedule.scheduledLocal).slice(0, 16)
      const wall = `${localDateTimeStr}:00`
      const scheduledForISO = fromZonedTime(wall, 'America/New_York').toISOString()
      const scheduledForDate = new Date(scheduledForISO)

      let scheduledAppointmentId: string | null = null
      let assignedCloserName = 'Closer'
      let assignedCloserId: string | null = null
      let googleCalendarEventId: string | null = null
      const customerName = (originalAppointment.leads as any)?.homeowner_name || 'Customer'
      const customerPhone = (originalAppointment.leads as any)?.phone || null
      const customerAddress =
        (originalAppointment.leads as any)?.address_text || originalAppointment.address_text || null

      if (schedule.useRoundRobin) {
        const teamId =
          schedule.teamId ||
          (await getDefaultTeam(admin, profile.org_id))

        if (!teamId) {
          return NextResponse.json({ error: 'No team found for round-robin assignment' }, { status: 400 })
        }

        const assignment = await assignNextAvailableCloser(
          admin,
          teamId,
          scheduledForDate,
          inspectionDuration,
          originalAppointment.lead_id || undefined,
          originalAppointment.opportunity_id || undefined,
          originalAppointment.address_text || (originalAppointment.leads as any)?.address_text || undefined,
          originalAppointment.canvasser_user_id || undefined,
          profile.org_id,
          undefined,
          {
            homeownerName: (originalAppointment.leads as any)?.homeowner_name || undefined,
            phone: (originalAppointment.leads as any)?.phone || undefined,
            notes: note || 'Scheduled back to closer by inside sales.',
            eventLabel: 'inspection',
          },
          defaultGap,
          bufferAfter
        )

        if (!assignment.success || !assignment.appointmentId) {
          return NextResponse.json({ error: assignment.error || 'No available closer for this time slot' }, { status: 409 })
        }

        scheduledAppointmentId = assignment.appointmentId
        assignedCloserId = assignment.closerId || null
        assignedCloserName = assignment.closerName || assignedCloserName
        googleCalendarEventId = assignment.googleEventId || null

        await admin
          .from('scheduled_appointments')
          .update({
            appointment_type: 'inspection',
            notes: note || 'Scheduled back to closer by inside sales.',
            buffer_after_minutes: bufferAfter,
          })
          .eq('id', assignment.appointmentId)

        if (!googleCalendarEventId && assignedCloserId && scheduledAppointmentId) {
          try {
            googleCalendarEventId = await createInspectionEventOnCloserCalendar(admin, {
              closerUserId: assignedCloserId,
              scheduledAppointmentId,
              localDateTimeStr,
              inspectionDuration,
              customerName,
              phone: customerPhone,
              address: customerAddress,
              note: note || 'Scheduled back to closer by inside sales.',
            })
          } catch (calendarError) {
            console.error('Inside sales round-robin backup calendar sync failed:', calendarError)
          }
        }

        if (!googleCalendarEventId && scheduledAppointmentId) {
          await admin.from('scheduled_appointments').delete().eq('id', scheduledAppointmentId)
          return NextResponse.json(
            { error: 'Failed to push this inspection onto the closer calendar. No appointment was created.' },
            { status: 409 }
          )
        }
      } else {
        const closerUserId = typeof schedule.closerUserId === 'string' ? schedule.closerUserId : null
        if (!closerUserId) {
          return NextResponse.json({ error: 'Please choose a closer or team.' }, { status: 400 })
        }

        const { data: closerRow } = await admin
          .from('users')
          .select('id, full_name, org_id, active')
          .eq('id', closerUserId)
          .maybeSingle()

        if (!closerRow || closerRow.org_id !== profile.org_id || closerRow.active === false) {
          return NextResponse.json({ error: 'Invalid closer for this organization' }, { status: 400 })
        }

        assignedCloserId = closerUserId
        assignedCloserName = closerRow.full_name || assignedCloserName

        const { data: insertedAppointment, error: createError } = await admin
          .from('scheduled_appointments')
          .insert({
            org_id: profile.org_id,
            lead_id: originalAppointment.lead_id,
            opportunity_id: originalAppointment.opportunity_id,
            closer_user_id: closerUserId,
            canvasser_user_id: originalAppointment.canvasser_user_id,
            scheduled_for: scheduledForISO,
            duration_minutes: inspectionDuration,
            buffer_after_minutes: bufferAfter,
            status: 'scheduled',
            address_text: originalAppointment.address_text,
            notes: note || 'Scheduled back to closer by inside sales.',
            appointment_type: 'inspection',
          })
          .select('id')
          .single()

        if (createError || !insertedAppointment) {
          return NextResponse.json({ error: 'Failed to create new inspection appointment' }, { status: 500 })
        }

        scheduledAppointmentId = insertedAppointment.id

        googleCalendarEventId = await createInspectionEventOnCloserCalendar(admin, {
          closerUserId,
          scheduledAppointmentId: insertedAppointment.id,
          localDateTimeStr,
          inspectionDuration,
          customerName,
          phone: customerPhone,
          address: customerAddress,
          note: note || 'Scheduled back to closer by inside sales.',
        })
        if (!googleCalendarEventId || !scheduledAppointmentId) {
          await admin.from('scheduled_appointments').delete().eq('id', insertedAppointment.id)
          return NextResponse.json(
            { error: 'Failed to push this inspection onto the closer calendar. No appointment was created.' },
            { status: 409 }
          )
        }
      }

      if (scheduledAppointmentId && assignedCloserId) {
        const promptAt = computeInspectionFeedbackPromptAt(scheduledForISO, inspectionDuration, bufferAfter, 0)
        await admin.from('pending_status_prompts').upsert(
          {
            org_id: profile.org_id,
            appointment_id: scheduledAppointmentId,
            closer_user_id: assignedCloserId,
            prompt_at: promptAt,
            completed: false,
            dismissed: false,
          },
          { onConflict: 'appointment_id' }
        )
      }

      const scheduleLabel = new Date(scheduledForISO).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })

      const { data: updatedOpportunity, error: scheduleUpdateError } = await admin
        .from('opportunities')
        .update({
          inspection_outcome: null,
          inspection_outcome_at: null,
          inspection_notes: null,
          notes: note || opportunity.notes || null,
        })
        .eq('id', opportunityId)
        .eq('org_id', profile.org_id)
        .select('id, status, notes, inspection_outcome, inspection_outcome_at, inspection_notes')
        .single()

      if (scheduleUpdateError || !updatedOpportunity) {
        return NextResponse.json({ error: 'Scheduled appointment, but failed to update opportunity follow-up state' }, { status: 500 })
      }

      await admin.from('activities').insert({
        org_id: profile.org_id,
        opportunity_id: opportunityId,
        lead_id: opportunity.lead_id,
        user_id: profile.id,
        type: 'appointment_scheduled',
        body: `Inside sales scheduled inspection back to closer (${assignedCloserName}) for ${scheduleLabel}${note ? ` — ${note}` : ''}`,
      })

      return NextResponse.json({
        opportunity: updatedOpportunity,
        scheduled_appointment_id: scheduledAppointmentId,
      })
    }

    if (action === 'claim_self') {
      if (!isInsideSalesRoleLike({
        role: profile.role,
        customRoleName: profileCustomRole?.name || null,
        customRoleDisplayName: profileCustomRole?.display_name || null,
      })) {
        return NextResponse.json({ error: 'Only inside sales users can self-assign follow-ups' }, { status: 403 })
      }
      activityType = 'status_change'
      activityBody = 'Inside sales follow-up claimed.'
    } else {
      if (action === 'log_call' || action === 'log_text') {
        if (!result) {
          return NextResponse.json({ error: 'Please choose a result before saving.' }, { status: 400 })
        }
        activityType = action === 'log_call' ? 'call' : 'text'
        activityBody = `${action === 'log_call' ? 'Inside sales call' : 'Inside sales text'}: ${result}${note ? ` — ${note}` : ''}`
      } else if (action === 'mark_rescheduled') {
        activityType = 'status_change'
        activityBody = `Inside sales marked rescheduled${note ? ` — ${note}` : ''}`
        updateData.inspection_outcome = null
        updateData.inspection_outcome_at = null
        updateData.inspection_notes = null
      } else if (action === 'mark_unresponsive') {
        activityType = 'status_change'
        activityBody = `Inside sales marked unresponsive${note ? ` — ${note}` : ''}`
        updateData.inspection_outcome = null
        updateData.inspection_outcome_at = null
        updateData.inspection_notes = null
      } else if (action === 'mark_lost') {
        activityType = 'status_change'
        activityBody = `Inside sales marked lost${note ? ` — ${note}` : ''}`
        updateData.status = 'lost'
        updateData.inspection_outcome = null
        updateData.inspection_outcome_at = null
        updateData.inspection_notes = null
      }
    }

    if (note) {
      updateData.notes = note
    }

    let updatedOpportunity: any = {
      id: opportunity.id,
      status: opportunity.status,
      notes: opportunity.notes ?? null,
      inspection_outcome: opportunity.inspection_outcome ?? null,
      inspection_outcome_at: opportunity.inspection_outcome_at ?? null,
      inspection_notes: opportunity.inspection_notes ?? null,
    }

    if (Object.keys(updateData).length > 0) {
      const { data, error: updateError } = await admin
        .from('opportunities')
        .update(updateData)
        .eq('id', opportunityId)
        .eq('org_id', profile.org_id)
        .select('id, status, notes, inspection_outcome, inspection_outcome_at, inspection_notes')
        .single()

      if (updateError || !data) {
        return NextResponse.json({ error: 'Failed to update inside sales follow-up' }, { status: 500 })
      }

      updatedOpportunity = data
    }

    if (activityType && activityBody) {
      await admin.from('activities').insert({
        org_id: profile.org_id,
        opportunity_id: opportunityId,
        lead_id: opportunity.lead_id,
        user_id: profile.id,
        type: activityType,
        body: activityBody,
      })
    }

    return NextResponse.json({ opportunity: updatedOpportunity })
  } catch (error) {
    console.error('Inside sales follow-up POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
