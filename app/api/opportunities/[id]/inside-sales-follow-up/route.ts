import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  mapLatestInspectionByLeadId,
  mapLatestInspectionByOpportunityId,
  withEffectiveInspectionFields,
} from '@/lib/effective-inspection-state'
import {
  canViewInsideSalesFollowUp,
  DIDNT_SIT_PIPELINE_PREFIX,
  getInsideSalesFollowUpKind,
  HANDOFF_INSIDE_SALES_PIPELINE_PREFIX,
  hasActiveInsideSalesFollowUp,
  isInsideSalesRoleLike,
  KNOCKBACK_PIPELINE_PREFIX,
  STORM_PIPELINE_PREFIX,
  pipelineStageForInsideSalesClaim,
} from '@/lib/inside-sales-follow-up'
import {
  ADJUSTER_MEETING_APPOINTMENT_TYPE,
  DEFAULT_ADJUSTER_MEETING_DURATION_MINUTES,
  INSIDE_SALES_STATUS_MUTABLE_APPOINTMENT_TYPES,
  normalizeAdjusterMeetingDuration,
  resolveSchedulingPolicy,
} from '@/lib/adjuster-meeting'
import {
  sendAdjusterMeetingSyncAlert,
  shouldSendAdjusterMeetingAlert,
} from '@/lib/adjuster-meeting-alert'
import {
  describeAttendeeConflict,
  findAttendeeConflicts,
  syncAdjusterMeetingToGoogle,
  type AdjusterMeetingSyncResult,
  type AppointmentTimeSpan,
} from '@/lib/adjuster-meeting-calendar'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { assignNextAvailableCloser, getDefaultTeam } from '@/lib/round-robin'
import {
  fetchOrgAppointmentTypesFromTable,
  getInspectionBufferAfterFromTable,
  getInspectionDurationFromTable,
} from '@/lib/org-appointment-types'
import {
  createCalendarEvent,
  refreshAccessToken,
  updateCalendarEvent,
  type CalendarEvent,
} from '@/lib/google-calendar'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
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

/**
 * Record WHO in inside sales put this insurance appointment on the calendar.
 *
 * This is deliberately separate from `canvasser_user_id`, which is the setter who
 * booked the ORIGINAL inspection and must stay untouched — the setter keeps setter
 * credit and setter commission. Until this column existed, "who set the original
 * appointment" and "who got it re-booked" were the same field, so an inside-sales
 * rep earned nothing for a re-book. It drives the inside-sales sit credit in
 * lib/inside-sales-booker-attribution.ts.
 *
 * Best-effort on purpose: the column ships in a hand-applied migration
 * (202608050005). Booking the customer must never fail because an optional pay
 * attribution column is not there yet, so a failure here is logged and swallowed
 * rather than 500-ing the inside-sales queue. Worst case the rep loses a $10
 * credit that was default-OFF anyway; the alternative is a broken booking flow.
 */
async function stampInsideSalesBooker(
  admin: ReturnType<typeof getAdminClient>,
  params: { orgId: string; userId: string; opportunityId: string }
): Promise<void> {
  try {
    const { error } = await admin
      .from('scheduled_appointments')
      .update({ inside_sales_booked_by_user_id: params.userId })
      .eq('org_id', params.orgId)
      .eq('opportunity_id', params.opportunityId)
      .eq('appointment_type', 'insurance_call')
      // Only rows still open at this point — the caller runs this straight after
      // moving scheduled_for and before any completed-marking, so this is exactly
      // the set of appointments the rep just re-booked.
      .eq('status', 'scheduled')

    if (error) {
      console.warn('stampInsideSalesBooker: could not record inside-sales booker', {
        orgId: params.orgId,
        opportunityId: params.opportunityId,
        error: error.message,
      })
    }
  } catch (err) {
    console.warn('stampInsideSalesBooker: unexpected failure', err)
  }
}

type ActionType =
  | 'claim_self'
  | 'log_call'
  | 'log_text'
  | 'mark_rescheduled'
  | 'mark_unresponsive'
  | 'mark_lost'
  | 'schedule_back_to_closer'
  | 'schedule_adjuster_meeting'
  | 'retry_adjuster_meeting_sync'
  | 'mark_knockback'

function resolvedPipelineStage(
  kind: 'didnt_sit' | 'handoff' | 'knockback' | 'storm' | null,
  status: 'scheduled' | 'rescheduled' | 'unresponsive' | 'lost'
): string {
  if (kind === 'knockback') {
    return `${KNOCKBACK_PIPELINE_PREFIX}_${status === 'scheduled' ? 'rescheduled' : status}`
  }
  if (kind === 'storm') {
    return `${STORM_PIPELINE_PREFIX}_${status === 'scheduled' ? 'rescheduled' : status}`
  }
  const prefix = kind === 'handoff' ? HANDOFF_INSIDE_SALES_PIPELINE_PREFIX : DIDNT_SIT_PIPELINE_PREFIX
  if (status === 'scheduled') {
    return kind === 'handoff' ? `${prefix}_scheduled` : `${prefix}_rescheduled`
  }
  return `${prefix}_${status}`
}

function activePipelinePrefix(kind: 'didnt_sit' | 'handoff' | 'knockback' | 'storm' | null): string {
  if (kind === 'knockback') return KNOCKBACK_PIPELINE_PREFIX
  if (kind === 'storm') return STORM_PIPELINE_PREFIX
  return kind === 'handoff' ? HANDOFF_INSIDE_SALES_PIPELINE_PREFIX : DIDNT_SIT_PIPELINE_PREFIX
}

function parseFollowUpInput(value: unknown, timezone: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const trimmed = value.trim()
  // If the value already carries zone info (UTC "Z" or a numeric offset), the
  // client has already resolved the instant — use it as-is. Slicing off the zone
  // and re-interpreting the wall-clock portion in `timezone` would double-shift
  // by the ET offset (e.g. a 10:00 ET reschedule landing at 14:00 ET).
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed)
    return Number.isFinite(d.getTime()) ? d.toISOString() : null
  }
  const localDateTimeStr = trimmed.slice(0, 16)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localDateTimeStr)) return null
  return fromZonedTime(`${localDateTimeStr}:00`, timezone).toISOString()
}

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

function formatCalendarLocal(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd'T'HH:mm:ss")
}

async function createInspectionEventOnCloserCalendar(
  adminClient: ReturnType<typeof getAdminClient>,
  params: {
    closerUserId: string
    scheduledAppointmentId: string
    scheduledForISO: string
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
  const startDate = new Date(params.scheduledForISO)
  const endDate = new Date(startDate.getTime() + params.inspectionDuration * 60 * 1000)

  const event: CalendarEvent = {
    summary: `Inspection: ${params.customerName}`,
    description: buildInspectionCalendarDescription(params),
    location: params.address || undefined,
    start: { dateTime: formatCalendarLocal(startDate, timezone), timeZone: timezone },
    end: {
      dateTime: formatCalendarLocal(endDate, timezone),
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

/**
 * Route-level adapter: wires the real Supabase/Google clients into
 * `syncAdjusterMeetingToGoogle`, which owns the non-destructive contract and is
 * unit-tested in lib/__tests__/adjuster-meeting-calendar.test.ts.
 *
 * The `scheduled_appointments` row is always committed by the caller BEFORE this
 * runs, and no failure path here removes it.
 */
async function pushAdjusterMeetingToGoogle(
  adminClient: ReturnType<typeof getAdminClient>,
  params: {
    orgId: string
    appointmentId: string
    attendeeUserId: string
    bookerUserId: string | null
    scheduledForIso: string
    durationMinutes: number
    customerName: string
    phone?: string | null
    address?: string | null
    bookedByName?: string | null
    /** Alert context only — who was supposed to attend. */
    attendeeName?: string | null
    note?: string | null
    existingEventId?: string | null
    /** True when this is an explicit retry, which always alerts on failure. */
    isRetry?: boolean
  }
): Promise<AdjusterMeetingSyncResult> {
  const { orgId, attendeeName: _attendeeName, isRetry: _isRetry, ...syncParams } = params

  return syncAdjusterMeetingToGoogle(
    {
      getAccessToken: (userId) => getValidAccessToken(adminClient, userId),
      getTimezone: (userId) => getTimezoneForUser(adminClient, userId),
      formatLocal: formatCalendarLocal,
      createEvent: (token, event, calendarId, sendUpdates) =>
        createCalendarEvent(token, event, calendarId, sendUpdates),
      updateEvent: (token, eventId, event) => updateCalendarEvent(token, eventId, event),
      getUserEmail: async (userId) => {
        const { data } = await adminClient
          .from('users')
          .select('email')
          .eq('id', userId)
          .eq('org_id', orgId)
          .eq('active', true)
          .maybeSingle()
        return (data?.email as string | null) ?? null
      },
      saveSuccess: async (appointmentId, eventId) => {
        const { error } = await adminClient
          .from('scheduled_appointments')
          .update({ google_event_id: eventId, google_sync_failed_at: null, google_sync_error: null })
          .eq('id', appointmentId)
          .eq('org_id', orgId)
        if (error) {
          // Columns absent pre-migration 202608050006 — still store the link so the
          // calendar association is not lost.
          const { error: fallbackError } = await adminClient
            .from('scheduled_appointments')
            .update({ google_event_id: eventId })
            .eq('id', appointmentId)
            .eq('org_id', orgId)
          if (fallbackError) throw fallbackError
        }
      },
      saveFailure: async (appointmentId, message, knownEventId) => {
        // Dedupe: read the prior state BEFORE overwriting it. The alert fires when a
        // failure is newly recorded (previously clean) or on an explicit retry —
        // never again and again for an already-known failure that some later read or
        // write happens to touch.
        const { data: priorRow } = await adminClient
          .from('scheduled_appointments')
          .select('google_sync_failed_at')
          .eq('id', appointmentId)
          .eq('org_id', orgId)
          .maybeSingle()
        const alreadyFailing = Boolean(
          (priorRow as { google_sync_failed_at?: string | null } | null)?.google_sync_failed_at
        )

        const failureUpdate: Record<string, unknown> = {
          google_sync_failed_at: new Date().toISOString(),
          google_sync_error: message,
        }
        if (knownEventId) failureUpdate.google_event_id = knownEventId
        const { error } = await adminClient
          .from('scheduled_appointments')
          .update(failureUpdate)
          .eq('id', appointmentId)
          .eq('org_id', orgId)
        if (error) {
          console.warn('pushAdjusterMeetingToGoogle: could not record sync failure', error.message)
        }

        if (shouldSendAdjusterMeetingAlert({ alreadyFailing, isRetry: Boolean(params.isRetry) })) {
          // Never awaited into the booking's success path in a way that could throw —
          // sendAdjusterMeetingSyncAlert swallows everything internally.
          await sendAdjusterMeetingSyncAlert({
            appointmentId,
            customerName: params.customerName,
            address: params.address ?? null,
            scheduledForIso: params.scheduledForIso,
            attendeeName: params.attendeeName ?? null,
            bookedByName: params.bookedByName ?? null,
            error: message,
            isRetry: Boolean(params.isRetry),
          })
        }
      },
    },
    syncParams
  )
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
      .select('id, org_id, role, full_name, custom_role_id, custom_role:custom_roles(name, display_name)')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const profileCustomRole = Array.isArray((profile as any).custom_role)
      ? (profile as any).custom_role[0]
      : (profile as any).custom_role

    const { permissionNames } = await resolveEffectivePermissionNames(admin, user.id, {
      role: profile.role,
      custom_role_id: profile.custom_role_id,
    })

    const insideSalesAccessInput = {
      role: profile.role,
      customRoleName: profileCustomRole?.name || null,
      customRoleDisplayName: profileCustomRole?.display_name || null,
      permissionNames,
    }

    if (!canViewInsideSalesFollowUp(insideSalesAccessInput)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [{ data: opportunity }, { data: orgRow }] = await Promise.all([
      admin
        .from('opportunities')
        .select('id, org_id, lead_id, status, address_text, inspection_outcome, inspection_outcome_at, notes, created_at, updated_at, inspection_notes, pipeline_stage, follow_up_at, assigned_user_id')
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
      assigned_user_id: null,
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

    const body = await request.json()
    const action = String(body.action || '') as ActionType
    const note = typeof body.note === 'string' ? body.note.trim() : ''
    const spokeWith = typeof body.spoke_with === 'string' ? body.spoke_with.trim() : null

    if (!action) {
      return NextResponse.json({ error: 'Missing action' }, { status: 400 })
    }

    if (action === 'mark_knockback') {
      const status = String(opportunity.status || '').toLowerCase()
      if (status === 'won' || status === 'lost') {
        return NextResponse.json({ error: 'Cannot mark knockback on a won or lost opportunity' }, { status: 400 })
      }
    } else if (!hasActiveInsideSalesFollowUp(opportunityEffective, inspectionOutcomeSettings)) {
      return NextResponse.json({ error: 'No active inside sales follow-up for this opportunity' }, { status: 400 })
    }

    const followUpKind = getInsideSalesFollowUpKind(opportunityEffective, inspectionOutcomeSettings)

    const result = typeof body.result === 'string' ? body.result.trim() : ''
    const schedule = body.schedule && typeof body.schedule === 'object' ? body.schedule : null
    const followUpTimezone =
      typeof body.next_follow_up_timezone === 'string' && body.next_follow_up_timezone.trim()
        ? body.next_follow_up_timezone.trim()
        : 'America/New_York'
    const nextFollowUpAt = parseFollowUpInput(body.next_follow_up_at, followUpTimezone)

    const updateData: Record<string, unknown> = {}
    let activityType: 'call' | 'text' | 'status_change' | null = null
    let activityBody: string | null = null

    if (action === 'mark_knockback') {
      const knockbackReason = body.knockback_reason as string | undefined
      const knockbackMonths = typeof body.knockback_follow_up_months === 'number'
        ? body.knockback_follow_up_months
        : null

      if (!knockbackReason || !['credit_fail', 'not_ready', 'price_objection'].includes(knockbackReason)) {
        return NextResponse.json({ error: 'Valid knockback_reason required' }, { status: 400 })
      }
      if (!knockbackMonths || ![2, 4, 6].includes(knockbackMonths)) {
        return NextResponse.json({ error: 'knockback_follow_up_months must be 2, 4, or 6' }, { status: 400 })
      }

      const followUpDate = new Date()
      followUpDate.setMonth(followUpDate.getMonth() + knockbackMonths)
      const followUpAt = followUpDate.toISOString()

      activityType = 'status_change'
      activityBody = `Knockback: ${knockbackReason.replace(/_/g, ' ')} — follow up in ${knockbackMonths} months${note ? ` — ${note}` : ''}`
      updateData.pipeline_stage = KNOCKBACK_PIPELINE_PREFIX
      updateData.knockback_reason = knockbackReason
      updateData.knockback_follow_up_months = knockbackMonths
      updateData.follow_up_at = followUpAt
      updateData.assigned_user_id = null
    } else if (action === 'retry_adjuster_meeting_sync') {
      // Retry a push that previously failed. Same non-destructive contract: the
      // meeting already exists and stays put whatever Google does.
      if (!isInsideSalesRoleLike(insideSalesAccessInput)) {
        return NextResponse.json(
          { error: 'Only inside sales users can retry adjuster meeting sync' },
          { status: 403 }
        )
      }

      const { data: meetingRow } = await admin
        .from('scheduled_appointments')
        .select('id, closer_user_id, inside_sales_booked_by_user_id, scheduled_for, duration_minutes, address_text, google_event_id, notes, lead_id')
        .eq('org_id', profile.org_id)
        .eq('opportunity_id', opportunityId)
        .eq('appointment_type', ADJUSTER_MEETING_APPOINTMENT_TYPE)
        .neq('status', 'cancelled')
        .order('scheduled_for', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!meetingRow?.id) {
        return NextResponse.json({ error: 'No adjuster meeting to sync for this opportunity' }, { status: 404 })
      }
      if (!meetingRow.closer_user_id) {
        return NextResponse.json(
          { error: 'Assign the rep who will attend before syncing to their calendar.' },
          { status: 400 }
        )
      }

      const { data: retryLead } = await admin
        .from('leads')
        .select('homeowner_name, phone, address_text')
        .eq('id', meetingRow.lead_id)
        .eq('org_id', profile.org_id)
        .maybeSingle()

      const { data: retryAttendee } = await admin
        .from('users')
        .select('full_name, active')
        .eq('id', meetingRow.closer_user_id)
        .eq('org_id', profile.org_id)
        .maybeSingle()
      if (!retryAttendee || retryAttendee.active === false) {
        return NextResponse.json(
          { error: 'The assigned attendee is not active in this organization.' },
          { status: 400 }
        )
      }
      const retryAttendeeName = (retryAttendee?.full_name as string | null) || null

      const retrySync = await pushAdjusterMeetingToGoogle(admin, {
        orgId: profile.org_id,
        appointmentId: meetingRow.id as string,
        attendeeUserId: meetingRow.closer_user_id as string,
        bookerUserId: (meetingRow.inside_sales_booked_by_user_id as string | null) || null,
        scheduledForIso: meetingRow.scheduled_for as string,
        durationMinutes: normalizeAdjusterMeetingDuration(meetingRow.duration_minutes),
        customerName: retryLead?.homeowner_name || 'Customer',
        phone: retryLead?.phone || null,
        address: (meetingRow.address_text as string) || retryLead?.address_text || null,
        bookedByName: profile.full_name || null,
        attendeeName: retryAttendeeName,
        note: (meetingRow.notes as string) || null,
        existingEventId: (meetingRow.google_event_id as string | null) || null,
        // An explicit retry always alerts on failure — the human is actively trying
        // to fix this and needs to know it still did not work.
        isRetry: true,
      })

      return NextResponse.json({
        scheduled_appointment_id: meetingRow.id,
        google_synced: retrySync.ok,
        ...(retrySync.ok ? {} : { google_sync_error: retrySync.error }),
        ...(retrySync.eventId ? { google_event_id: retrySync.eventId } : {}),
      })
    } else if (action === 'schedule_adjuster_meeting') {
      // Inside sales books the physical adjuster meeting. Two things make this
      // different from every other appointment this route creates:
      //   - it carries inside_sales_booked_by_user_id, so the booker earns a sit
      //     unit once the meeting is certified as having happened;
      //   - it carries closer_user_id, the field rep who will ATTEND. That was NULL
      //     on the live insurance_call rows, which is exactly why the meeting never
      //     appeared on the attendee's calendar.
      // The booker cannot complete it — see lib/adjuster-meeting.ts.
      if (!isInsideSalesRoleLike(insideSalesAccessInput)) {
        return NextResponse.json(
          { error: 'Only inside sales users can schedule adjuster meetings' },
          { status: 403 }
        )
      }
      if (!schedule?.scheduledLocal) {
        return NextResponse.json({ error: 'Missing scheduled time' }, { status: 400 })
      }

      const meetingTimezone =
        typeof schedule.timezone === 'string' && schedule.timezone.trim()
          ? schedule.timezone.trim()
          : 'America/New_York'
      const meetingLocal = String(schedule.scheduledLocal).slice(0, 16)
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(meetingLocal)) {
        return NextResponse.json({ error: 'Invalid scheduled time' }, { status: 400 })
      }
      const meetingIso = fromZonedTime(`${meetingLocal}:00`, meetingTimezone).toISOString()
      if (!Number.isFinite(new Date(meetingIso).getTime())) {
        return NextResponse.json({ error: 'Invalid scheduled time' }, { status: 400 })
      }

      const durationMinutes = normalizeAdjusterMeetingDuration(
        schedule.durationMinutes ?? DEFAULT_ADJUSTER_MEETING_DURATION_MINUTES
      )

      // The relaxed rules, derived from the appointment type — not from anything in
      // the request body. No availability gating, no slot validation and no
      // business-hours check runs anywhere below: this branch routes AROUND the
      // shared validators rather than adding a bypass mode to them, so an inspection
      // cannot reach these rules even in future. Enforced by
      // lib/__tests__/appointment-scheduling-policy.test.ts.
      const meetingPolicy = resolveSchedulingPolicy(ADJUSTER_MEETING_APPOINTMENT_TYPE)
      if (meetingPolicy.enforceAvailability || meetingPolicy.deleteOnCalendarFailure) {
        // Unreachable by construction; guards against someone later making
        // resolveSchedulingPolicy return the strict policy for this type.
        console.error('adjuster meeting resolved to the strict scheduling policy — refusing to gate a booking we cannot re-ask for')
      }

      // Who attends. Explicit choice wins; otherwise fall back to the rep who ran
      // the inspection, then the opportunity owner. A meeting with nobody assigned
      // can never be completed (and so never pays), so resolving this matters.
      let attendeeUserId: string | null =
        typeof schedule.closerUserId === 'string' && schedule.closerUserId.trim()
          ? schedule.closerUserId.trim()
          : null

      if (!attendeeUserId) {
        const { data: priorInspection } = await admin
          .from('scheduled_appointments')
          .select('closer_user_id')
          .eq('org_id', profile.org_id)
          .eq('opportunity_id', opportunityId)
          .eq('appointment_type', 'inspection')
          .not('closer_user_id', 'is', null)
          .order('scheduled_for', { ascending: true })
          .limit(1)
          .maybeSingle()
        attendeeUserId = (priorInspection?.closer_user_id as string | null) || null
      }

      if (!attendeeUserId) {
        const { data: oppOwner } = await admin
          .from('opportunities')
          .select('owner_user_id')
          .eq('id', opportunityId)
          .eq('org_id', profile.org_id)
          .maybeSingle()
        attendeeUserId = (oppOwner?.owner_user_id as string | null) || null
      }

      if (!attendeeUserId) {
        return NextResponse.json(
          { error: 'Choose the rep who will attend this adjuster meeting.' },
          { status: 400 }
        )
      }

      const { data: attendee } = await admin
        .from('users')
        .select('id, full_name, org_id, active')
        .eq('id', attendeeUserId)
        .maybeSingle()

      if (!attendee || attendee.org_id !== profile.org_id || attendee.active === false) {
        return NextResponse.json(
          { error: 'Invalid attending rep for this organization' },
          { status: 400 }
        )
      }

      if (attendeeUserId === profile.id) {
        return NextResponse.json(
          { error: 'The inside-sales booker cannot also be the attending certifier.' },
          { status: 400 }
        )
      }

      const { data: leadRow } = await admin
        .from('leads')
        .select('address_text, homeowner_name, phone, pin_attributed_user_id, owner_user_id')
        .eq('id', opportunity.lead_id)
        .eq('org_id', profile.org_id)
        .maybeSingle()

      const meetingNotes = [
        `Insurance adjuster meeting booked by ${profile.full_name || 'inside sales'}.`,
        `Attending: ${attendee.full_name || 'assigned rep'}.`,
        note || null,
      ]
        .filter(Boolean)
        .join('\n')

      const insertPayload: Record<string, unknown> = {
        org_id: profile.org_id,
        lead_id: opportunity.lead_id,
        opportunity_id: opportunityId,
        closer_user_id: attendeeUserId,
        // Setter attribution copied through untouched — the setter keeps setter
        // credit and setter commission on this deal.
        canvasser_user_id: leadRow?.pin_attributed_user_id || leadRow?.owner_user_id || null,
        scheduled_for: meetingIso,
        duration_minutes: durationMinutes,
        status: 'scheduled',
        address_text: opportunity.address_text || leadRow?.address_text || null,
        notes: meetingNotes,
        appointment_type: ADJUSTER_MEETING_APPOINTMENT_TYPE,
      }

      // Migration 202608050005 is applied before this code ships. Its partial unique
      // index makes this insert idempotent for one opportunity + exact slot, while
      // the lookup after any error reconciles an ambiguous response where Postgres
      // committed but the HTTP response was lost. Never retry without the booker
      // stamp: that could duplicate the meeting and silently discard pay attribution.
      let createdMeetingId: string | null = null
      let createdNewMeeting = false
      const withStamp = await admin
        .from('scheduled_appointments')
        .insert({ ...insertPayload, inside_sales_booked_by_user_id: profile.id })
        .select('id')
        .single()

      if (withStamp.error) {
        const { data: committedMeeting, error: reconcileError } = await admin
          .from('scheduled_appointments')
          .select('id')
          .eq('org_id', profile.org_id)
          .eq('opportunity_id', opportunityId)
          .eq('appointment_type', ADJUSTER_MEETING_APPOINTMENT_TYPE)
          .eq('scheduled_for', meetingIso)
          .eq('closer_user_id', attendeeUserId)
          .eq('inside_sales_booked_by_user_id', profile.id)
          .eq('duration_minutes', durationMinutes)
          .neq('status', 'cancelled')
          .maybeSingle()
        if (reconcileError || !committedMeeting?.id) {
          console.error('schedule_adjuster_meeting: insert/reconcile failed', {
            insertError: withStamp.error.message,
            reconcileError: reconcileError?.message,
          })
          return NextResponse.json({ error: 'Failed to schedule the adjuster meeting' }, { status: 500 })
        }
        createdMeetingId = committedMeeting.id as string
      } else {
        createdMeetingId = withStamp.data.id as string
        createdNewMeeting = true
      }

      if (createdNewMeeting) {
        await admin.from('activities').insert({
          org_id: profile.org_id,
          opportunity_id: opportunityId,
          lead_id: opportunity.lead_id,
          user_id: profile.id,
          type: 'appointment_scheduled',
          body: `Inside sales scheduled an insurance adjuster meeting for ${new Date(meetingIso).toLocaleString('en-US', {
            timeZone: 'America/New_York',
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })} ET — ${attendee.full_name || 'assigned rep'} attending${note ? ` — ${note}` : ''}`,
        })
      }

      // Conflict awareness — a WARNING, never a block. The adjuster picked this
      // time; if the rep is double-booked the inside rep should reassign who
      // attends, not lose the slot.
      const { data: attendeeAppointments } = await admin
        .from('scheduled_appointments')
        .select('id, scheduled_for, duration_minutes, status')
        .eq('org_id', profile.org_id)
        .eq('closer_user_id', attendeeUserId)
        .neq('status', 'cancelled')
        .gte('scheduled_for', new Date(new Date(meetingIso).getTime() - 12 * 60 * 60 * 1000).toISOString())
        .lte('scheduled_for', new Date(new Date(meetingIso).getTime() + 12 * 60 * 60 * 1000).toISOString())

      const conflictWarning = describeAttendeeConflict(
        findAttendeeConflicts((attendeeAppointments || []) as AppointmentTimeSpan[], {
          startIso: meetingIso,
          durationMinutes,
          excludeAppointmentId: createdMeetingId,
        }),
        attendee.full_name as string | null
      )

      // The CRM row is already committed. Everything below is best-effort: a Google
      // failure is recorded for retry and NEVER unwinds the booking.
      const sync = await pushAdjusterMeetingToGoogle(admin, {
        orgId: profile.org_id,
        appointmentId: createdMeetingId,
        attendeeUserId,
        bookerUserId: profile.id,
        scheduledForIso: meetingIso,
        durationMinutes,
        customerName: leadRow?.homeowner_name || 'Customer',
        phone: leadRow?.phone || null,
        address: (opportunity.address_text as string) || leadRow?.address_text || null,
        bookedByName: profile.full_name || null,
        attendeeName: (attendee.full_name as string | null) || null,
        note: note || null,
      })

      return NextResponse.json({
        opportunity: {
          id: opportunity.id,
          status: opportunity.status,
          pipeline_stage: opportunity.pipeline_stage ?? null,
        },
        scheduled_appointment_id: createdMeetingId,
        appointment_type: ADJUSTER_MEETING_APPOINTMENT_TYPE,
        attendee_user_id: attendeeUserId,
        duration_minutes: durationMinutes,
        google_synced: sync.ok,
        ...(sync.ok ? {} : { google_sync_error: sync.error }),
        ...(sync.eventId ? { google_event_id: sync.eventId } : {}),
        ...(conflictWarning ? { conflict_warning: conflictWarning } : {}),
      })
    } else if (action === 'schedule_back_to_closer') {
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

      if (originalAppointmentError) {
        return NextResponse.json({ error: 'Failed to look up original inspection appointment' }, { status: 500 })
      }

      type ScheduleBackSeed = {
        lead_id: string | null
        opportunity_id: string
        closer_user_id: string | null
        canvasser_user_id: string | null
        address_text: string | null
        leads: { homeowner_name?: string | null; phone?: string | null; address_text?: string | null } | null
      }

      let appointmentSeed: ScheduleBackSeed

      if (originalAppointment) {
        appointmentSeed = {
          lead_id: originalAppointment.lead_id,
          opportunity_id: originalAppointment.opportunity_id || opportunityId,
          closer_user_id: originalAppointment.closer_user_id,
          canvasser_user_id: originalAppointment.canvasser_user_id,
          address_text: originalAppointment.address_text,
          leads: (originalAppointment.leads as ScheduleBackSeed['leads']) || null,
        }
      } else {
        let leadRow: {
          homeowner_name?: string | null
          phone?: string | null
          address_text?: string | null
          pin_attributed_user_id?: string | null
          owner_user_id?: string | null
        } | null = null

        if (opportunity.lead_id) {
          const { data: lead, error: leadError } = await admin
            .from('leads')
            .select('homeowner_name, phone, address_text, pin_attributed_user_id, owner_user_id')
            .eq('id', opportunity.lead_id)
            .eq('org_id', profile.org_id)
            .maybeSingle()

          if (leadError) {
            return NextResponse.json({ error: 'Failed to load lead for scheduling' }, { status: 500 })
          }
          leadRow = lead
        }

        appointmentSeed = {
          lead_id: opportunity.lead_id,
          opportunity_id: opportunityId,
          closer_user_id: null,
          canvasser_user_id: leadRow?.pin_attributed_user_id || leadRow?.owner_user_id || null,
          address_text: opportunity.address_text || leadRow?.address_text || null,
          leads: leadRow
            ? {
                homeowner_name: leadRow.homeowner_name,
                phone: leadRow.phone,
                address_text: leadRow.address_text,
              }
            : null,
        }
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

      const timezone =
        typeof schedule.timezone === 'string' && schedule.timezone.trim()
          ? schedule.timezone.trim()
          : 'America/New_York'
      const localDateTimeStr = String(schedule.scheduledLocal).slice(0, 16)
      const wall = `${localDateTimeStr}:00`
      const scheduledForISO = fromZonedTime(wall, timezone).toISOString()
      const scheduledForDate = new Date(scheduledForISO)

      // Inspections take the STRICT path: round-robin availability gating,
      // business-hours/slot validation, 409 on conflict, and delete-the-row when the
      // Google push fails. Derived from the appointment type, not from any caller
      // input, so this cannot be relaxed by a request body. Adjuster meetings never
      // reach this branch at all — they are handled by `schedule_adjuster_meeting`
      // above, which never calls assignNextAvailableCloser.
      const schedulingPolicy = resolveSchedulingPolicy('inspection')

      let scheduledAppointmentId: string | null = null
      let assignedCloserName = 'Closer'
      let assignedCloserId: string | null = null
      let googleCalendarEventId: string | null = null
      const customerName = appointmentSeed.leads?.homeowner_name || 'Customer'
      const customerPhone = appointmentSeed.leads?.phone || null
      const customerAddress =
        appointmentSeed.leads?.address_text || appointmentSeed.address_text || null

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
          appointmentSeed.lead_id || undefined,
          appointmentSeed.opportunity_id || undefined,
          appointmentSeed.address_text || appointmentSeed.leads?.address_text || undefined,
          appointmentSeed.canvasser_user_id || undefined,
          profile.org_id,
          undefined,
          {
            homeownerName: appointmentSeed.leads?.homeowner_name || undefined,
            phone: appointmentSeed.leads?.phone || undefined,
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
              scheduledForISO,
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

        // Unchanged inspection rule: no calendar event means no appointment.
        if (schedulingPolicy.deleteOnCalendarFailure && !googleCalendarEventId && scheduledAppointmentId) {
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
            lead_id: appointmentSeed.lead_id,
            opportunity_id: appointmentSeed.opportunity_id,
            closer_user_id: closerUserId,
            // Setter attribution is copied through unchanged.
            canvasser_user_id: appointmentSeed.canvasser_user_id,
            scheduled_for: scheduledForISO,
            duration_minutes: inspectionDuration,
            buffer_after_minutes: bufferAfter,
            status: 'scheduled',
            address_text: appointmentSeed.address_text || appointmentSeed.leads?.address_text || null,
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
          scheduledForISO,
          inspectionDuration,
          customerName,
          phone: customerPhone,
          address: customerAddress,
          note: note || 'Scheduled back to closer by inside sales.',
        })
        // Unchanged inspection rule: no calendar event means no appointment.
        if (schedulingPolicy.deleteOnCalendarFailure && (!googleCalendarEventId || !scheduledAppointmentId)) {
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
          pipeline_stage: resolvedPipelineStage(followUpKind, 'scheduled'),
          follow_up_at: null,
          notes: note || opportunity.notes || null,
        })
        .eq('id', opportunityId)
        .eq('org_id', profile.org_id)
        .select('id, status, notes, inspection_outcome, inspection_outcome_at, inspection_notes, pipeline_stage, follow_up_at')
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

      // Lead went back to the closer — cancel any still-open inside-sales insurance calls.
      await admin
        .from('scheduled_appointments')
        .update({ status: 'cancelled' })
        .eq('org_id', profile.org_id)
        .eq('opportunity_id', opportunityId)
        .eq('appointment_type', 'insurance_call')
        .eq('status', 'scheduled')

      return NextResponse.json({
        opportunity: updatedOpportunity,
        scheduled_appointment_id: scheduledAppointmentId,
      })
    }

    if (action === 'claim_self') {
      if (!isInsideSalesRoleLike(insideSalesAccessInput)) {
        return NextResponse.json({ error: 'Only inside sales users can self-assign follow-ups' }, { status: 403 })
      }
      activityType = 'status_change'
      activityBody = 'Inside sales follow-up claimed.'
      updateData.assigned_user_id = profile.id
      updateData.pipeline_stage = pipelineStageForInsideSalesClaim(
        opportunityEffective,
        activePipelinePrefix(followUpKind)
      )
    } else {
      if (action === 'log_call' || action === 'log_text') {
        if (!result) {
          return NextResponse.json({ error: 'Please choose a result before saving.' }, { status: 400 })
        }
        activityType = action === 'log_call' ? 'call' : 'text'
        activityBody = `${action === 'log_call' ? 'Inside sales call' : 'Inside sales text'}: ${result}${note ? ` — ${note}` : ''}`
        updateData.pipeline_stage = pipelineStageForInsideSalesClaim(
          opportunityEffective,
          activePipelinePrefix(followUpKind)
        )
        if (nextFollowUpAt) {
          updateData.follow_up_at = nextFollowUpAt
        } else {
          // No next date picked: clear a PAST-due follow-up so the worked lead stops
          // pinning to the top as "overdue" and the attempt cadence takes over.
          // A future follow-up (upcoming scheduled call) is left untouched.
          const existingFollowUpMs = opportunity.follow_up_at
            ? new Date(opportunity.follow_up_at).getTime()
            : NaN
          if (Number.isFinite(existingFollowUpMs) && existingFollowUpMs <= Date.now()) {
            updateData.follow_up_at = null
          }
        }
      } else if (action === 'mark_rescheduled') {
        activityType = 'status_change'
        activityBody = `Inside sales marked rescheduled${note ? ` — ${note}` : ''}`
        updateData.inspection_outcome = null
        updateData.inspection_outcome_at = null
        updateData.inspection_notes = null
        updateData.pipeline_stage = resolvedPipelineStage(followUpKind, 'rescheduled')
        updateData.follow_up_at = null
      } else if (action === 'mark_unresponsive') {
        activityType = 'status_change'
        activityBody = `Inside sales marked unresponsive${note ? ` — ${note}` : ''}`
        updateData.inspection_outcome = null
        updateData.inspection_outcome_at = null
        updateData.inspection_notes = null
        updateData.pipeline_stage = resolvedPipelineStage(followUpKind, 'unresponsive')
        updateData.follow_up_at = null
      } else if (action === 'mark_lost') {
        activityType = 'status_change'
        activityBody = `Inside sales marked lost${note ? ` — ${note}` : ''}`
        updateData.status = 'lost'
        updateData.inspection_outcome = null
        updateData.inspection_outcome_at = null
        updateData.inspection_notes = null
        updateData.pipeline_stage = resolvedPipelineStage(followUpKind, 'lost')
        updateData.follow_up_at = null
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
      pipeline_stage: opportunity.pipeline_stage ?? null,
      follow_up_at: opportunity.follow_up_at ?? null,
      assigned_user_id: opportunity.assigned_user_id ?? null,
    }

    if (Object.keys(updateData).length > 0) {
      const { data, error: updateError } = await admin
        .from('opportunities')
        .update(updateData)
        .eq('id', opportunityId)
        .eq('org_id', profile.org_id)
        .select('id, status, notes, inspection_outcome, inspection_outcome_at, inspection_notes, pipeline_stage, follow_up_at, assigned_user_id')
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
        spoke_with: spokeWith || null,
      })
    }

    // Keep the inside-sales calendar honest: logging the call completes a due
    // insurance-call appointment; rescheduling moves open calls to the new time;
    // resolving the lead cancels any still-open ones.
    if (action === 'log_call' || action === 'log_text') {
      if (nextFollowUpAt) {
        await admin
          .from('scheduled_appointments')
          .update({ scheduled_for: nextFollowUpAt })
          .eq('org_id', profile.org_id)
          .eq('opportunity_id', opportunityId)
          .eq('appointment_type', 'insurance_call')
          .eq('status', 'scheduled')

        await stampInsideSalesBooker(admin, {
          orgId: profile.org_id,
          opportunityId,
          userId: profile.id,
        })
      }
      // Scoped through INSIDE_SALES_STATUS_MUTABLE_APPOINTMENT_TYPES on purpose.
      // Completing an appointment is what triggers the booker's sit unit, and this
      // is the inside-sales rep's own path — so it must never reach an
      // `adjuster_meeting`. Those are certified by the rep who attended, via
      // PATCH /api/appointments/[id]. Keeping the type list in one shared constant
      // stops a future edit here from quietly re-opening the self-serve hole.
      await admin
        .from('scheduled_appointments')
        .update({ status: 'completed' })
        .eq('org_id', profile.org_id)
        .eq('opportunity_id', opportunityId)
        .in('appointment_type', [...INSIDE_SALES_STATUS_MUTABLE_APPOINTMENT_TYPES])
        .eq('status', 'scheduled')
        .lte('scheduled_for', new Date().toISOString())
    } else if (
      action === 'mark_lost' ||
      action === 'mark_unresponsive' ||
      action === 'mark_rescheduled'
    ) {
      await admin
        .from('scheduled_appointments')
        .update({ status: 'cancelled' })
        .eq('org_id', profile.org_id)
        .eq('opportunity_id', opportunityId)
        .eq('appointment_type', 'insurance_call')
        .eq('status', 'scheduled')
    }

    return NextResponse.json({ opportunity: updatedOpportunity })
  } catch (error) {
    console.error('Inside sales follow-up POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
