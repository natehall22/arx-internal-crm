/**
 * Google Calendar sync for install scheduling — one event PER TRADE.
 *
 * A job's crews (roofing, gutters, siding, …) are `work_orders` rows with
 * `trade` set (see `lib/job-trades.ts`). Each trade gets its own event, its own
 * guest (its sub) and its own crew photo link, so the gutter crew is never sent
 * the roofer's day and a reschedule of one trade leaves the others alone.
 *
 * ARX uses subcontractor crews only (no in-house crews). A sub has no CRM login
 * and no Google OAuth of their own — instead they give ARX whatever email they
 * already use (`sub_contractors.scheduling_email`), and that address goes on the
 * event as an ATTENDEE. Google then emails them the invite and every later
 * change. We never send the sub anything ourselves.
 *
 * IT DOES NOT HAVE TO BE A GOOGLE ACCOUNT. Google mails an invitation with a
 * standard `.ics` attachment to any attendee address — Gmail renders it inline
 * with RSVP buttons, and Outlook / iCloud / Yahoo open the attachment and offer
 * "add to calendar". Nothing here should ever tell ops the sub must create an
 * account first; that is a made-up onboarding step.
 *
 * LENGTH (`work_orders.install_days`, ops-selected): ½, 1, 1½ or 2 days.
 *   - 1, 1½ and 2 days are ALL-DAY events over 1, 2 and 2 calendar dates.
 *   - ½ day is a TIMED 4-hour block from `scheduled_time_start` (default 8:00
 *     AM), so the crew's calendar shows the afternoon free. Built as a wall-clock
 *     `dateTime` string plus an explicit IANA `timeZone` — never via a JS `Date`.
 *
 * THE MOST IMPORTANT RULE IN THIS FILE: `scheduled_date` is a bare SQL `DATE`
 * (`YYYY-MM-DD`). It must reach Google as that exact string and must NEVER be
 * round-tripped through a JS `Date` + `toISOString()` (which shifts across UTC
 * offsets) or any `America/New_York`-formatting helper (the codebase hardcodes
 * that timezone in ~150 places and it has already caused a production
 * double-timezone bug). All date arithmetic here is done with `date-fns`'s
 * `addDays` on a Date built from the raw `y/m/d` parts, then re-serialized with
 * `format(d, 'yyyy-MM-dd')`.
 *
 * Google's all-day `end.date` is EXCLUSIVE: a 1-day install on 2026-09-10 is
 * `start.date: '2026-09-10'`, `end.date: '2026-09-11'`; a 2-day install ends
 * `'2026-09-12'`. See `lib/__tests__/install-calendar.test.ts`.
 *
 * FAILURE POLICY — mirrors `lib/adjuster-meeting-calendar.ts`, not the
 * inspection scheduler:
 *
 *   Inspection scheduling                  | Install scheduling
 *   ---------------------------------------|------------------------------------
 *   DELETES the row if Google fails         | NEVER deletes; records for retry
 *   conflict/failure blocks the booking     | Google failure never blocks or
 *                                            | rolls back the database write
 *
 * The install board is the source of truth; Google is a one-way export. A
 * Google failure is recorded to the trade's `install_sync_failed_at` /
 * `install_sync_error` and the DB change stands. No Google token anywhere is
 * NOT an error either: the assignment simply succeeds with no calendar event.
 */

import { addDays, format } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  createCalendarEvent,
  deleteCalendarEvent,
  isMissingEventError,
  updateCalendarEvent,
  type CalendarEvent,
} from '@/lib/google-calendar'
import { getValidAccessToken } from '@/lib/appointment-calendar-sync'
import { CALENDAR_BUSINESS_TZ } from '@/lib/calendar-business-tz'
import {
  TRADE_LABELS,
  HALF_DAY_HOURS,
  calendarDaySpan,
  crewLinkUrl,
  formatWallClock12h,
  halfDayStartMinutes,
  installDaysOrDefault,
  resolveAppUrl,
  type Trade,
} from '@/lib/job-trades'

/**
 * `sendUpdates` for create, update AND delete. Google defaults every one of
 * these to `none`, so each call site has to pass this explicitly or the sub is
 * never told anything after the first invite.
 */
export const INSTALL_SEND_UPDATES = 'all' as const

export function installJobPageUrl(jobId: string, appUrl?: string | null): string {
  return `${resolveAppUrl(appUrl)}/ops/jobs/${jobId}`
}

/**
 * Everything install scheduling needs to talk to Google: WHICH ACCOUNT it acts
 * as, and WHICH OF ITS CALENDARS events land on. One org read answers both,
 * because there is no case where a caller wants one without the other.
 *
 * Appointment scheduling already answers "which account" per-user: a closer
 * connects their own Google on `/admin/scheduling` and their appointments land
 * on their own calendar. This reuses that exact plumbing (`user_google_tokens`,
 * `getValidAccessToken`) — installs just need a different answer to *which*
 * user, because an install belongs to the company and a subcontractor rather
 * than to whoever happened to click schedule.
 *
 * Using one nominated account for writes AND free/busy reads matters because:
 *
 *   1. Crews share their calendar with exactly one address. Reads from that
 *      account and writes from the clicker would never line up, and RSVP
 *      lookups would silently find nothing.
 *   2. Every install lands on ONE calendar instead of scattering across staff
 *      primaries, so the schedule survives someone leaving.
 *   3. An ops user who has never connected Google can still schedule and the
 *      crew still gets the invite.
 *
 * Both settings fall back safely: no nominated account uses the acting user's
 * own token, and no nominated calendar uses `GOOGLE_INSTALL_CALENDAR_ID` and
 * then that account's `primary`.
 */
export type InstallCalendarConfig = {
  token: string | null
  calendarId: string
}

export async function resolveInstallCalendarConfig(
  adminClient: SupabaseClient,
  orgId: string,
  fallbackUserId: string
): Promise<InstallCalendarConfig> {
  let nominatedUserId: string | null = null
  let nominatedCalendarId: string | null = null

  try {
    const { data: org } = await adminClient
      .from('orgs')
      .select('install_scheduling_user_id, install_scheduling_calendar_id')
      .eq('id', orgId)
      .maybeSingle()
    nominatedUserId = org?.install_scheduling_user_id ?? null
    nominatedCalendarId = org?.install_scheduling_calendar_id ?? null
  } catch (e) {
    console.warn('resolveInstallCalendarConfig: org lookup failed, falling back', e)
  }

  let token: string | null = null
  if (nominatedUserId) {
    try {
      token = await getValidAccessToken(adminClient, nominatedUserId)
    } catch (e) {
      console.warn('resolveInstallCalendarConfig: nominated account token failed', e)
    }
  }
  if (!token) {
    try {
      token = await getValidAccessToken(adminClient, fallbackUserId)
    } catch (e) {
      console.warn('resolveInstallCalendarConfig: fallback token failed', e)
      token = null
    }
  }

  return {
    token,
    calendarId: nominatedCalendarId?.trim() || resolveInstallCalendarId(),
  }
}

/**
 * Which calendar an install event is written to:
 * `GOOGLE_INSTALL_CALENDAR_ID` when configured, else the scheduling user's
 * own `'primary'` calendar.
 */
export function resolveInstallCalendarId(): string {
  return process.env.GOOGLE_INSTALL_CALENDAR_ID || 'primary'
}

/**
 * Build a local (non-UTC) Date from a bare `YYYY-MM-DD` string's own y/m/d
 * parts. This is NOT `new Date(dateStr)` — that parses as UTC midnight and is
 * exactly the round-trip this file must avoid.
 */
function dateOnlyFromParts(dateStr: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!match) throw new Error(`Invalid YYYY-MM-DD date: ${dateStr}`)
  const [, y, m, d] = match
  return new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0)
}

/**
 * Add `days` calendar days to a bare `YYYY-MM-DD` string, returning a bare
 * `YYYY-MM-DD` string. Pure date-only arithmetic — see file header.
 */
export function addDaysToDateOnly(dateStr: string, days: number): string {
  const shifted = addDays(dateOnlyFromParts(dateStr), days)
  return format(shifted, 'yyyy-MM-dd')
}

function minutesToWallClock(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

function crewLengthLine(installDays: number, scheduledTimeStart?: string | null): string {
  switch (installDays) {
    case 0.5:
      return `½ day — starts ${formatWallClock12h(scheduledTimeStart)}`
    case 1.5:
      return '1½ days — plan on both days'
    case 2:
      return '2 days'
    default:
      return '1 day'
  }
}

export type BuildInstallEventInput = {
  jobId: string
  jobNumber: string
  customerName: string
  addressText?: string | null
  /** Which crew this event is for; defaults to roofing. */
  trade?: Trade | null
  /** Bare `YYYY-MM-DD` — never a parsed `Date`. */
  scheduledDate: string
  /** ½, 1, 1½ or 2; anything else is treated as 1. */
  installDays?: number | string | null
  /** `HH:mm[:ss]` wall clock — only used for a ½-day block. */
  scheduledTimeStart?: string | null
  /** Roofing only — a gutter crew does not care how many squares the roof is. */
  totalSquares?: number | null
  /** The sub's address (`sub_contractors.scheduling_email`); omitted when not on file. */
  schedulingEmail?: string | null
  /** ARX's own number, so the crew has someone to call from the invite itself. */
  orgPhone?: string | null
  /** The crew's photo link token; the line is omitted without one. */
  crewLinkToken?: string | null
  appUrl?: string | null
}

/**
 * Pure function — no I/O. Builds the Google event body for one trade's crew.
 *
 * WRITTEN FOR THE CREW, NOT FOR US. The person who opens this is a subcontractor
 * on a phone deciding where to drive tomorrow morning. So the body leads with the
 * address, how long they're booked, and the photo link they tap when they finish.
 *
 * The CRM job link is explicitly marked staff-only: the sub has no login, so for
 * them it is a dead end. It stays because the same event sits on ARX's own
 * calendar, where ops can use it.
 */
export function buildInstallEvent(input: BuildInstallEventInput): CalendarEvent {
  const trade: Trade = input.trade ?? 'roofing'
  const installDays = installDaysOrDefault(input.installDays)
  const halfDay = installDays === 0.5

  const squares =
    trade === 'roofing' && typeof input.totalSquares === 'number' && input.totalSquares > 0
      ? input.totalSquares
      : null

  const photoUrl = input.crewLinkToken ? crewLinkUrl(input.crewLinkToken, input.appUrl) : null

  const descriptionLines = [
    input.addressText ? `📍 ${input.addressText}` : null,
    `${TRADE_LABELS[trade]}: ${crewLengthLine(installDays, input.scheduledTimeStart)}${squares != null ? ` · ${squares} sq` : ''}`,
    `Homeowner: ${input.customerName}`,
    '',
    photoUrl ? `📸 When you finish, take the job photos here: ${photoUrl}` : null,
    photoUrl ? '' : null,
    input.orgPhone ? `Questions or a problem on site — call ARX at ${input.orgPhone}.` : 'Questions or a problem on site — call ARX.',
    `Job #${input.jobNumber} (quote this when you call).`,
    '',
    `ARX staff only: ${installJobPageUrl(input.jobId, input.appUrl)}`,
  ].filter((line): line is string => line !== null)

  const schedulingEmail = (input.schedulingEmail ?? '').trim().toLowerCase()
  /**
   * ALWAYS present, empty when there is no address. Google's `events.patch`
   * leaves omitted fields untouched, so omitting this on a reassignment would
   * leave the PREVIOUS sub attached to the event as a guest — and email them the
   * details of a job that is no longer theirs while the new crew hears nothing.
   */
  const attendees = schedulingEmail ? [{ email: schedulingEmail }] : []

  let start: CalendarEvent['start']
  let end: CalendarEvent['end']
  let reminderAnchorMinutes: number
  if (halfDay) {
    const startMinutes = halfDayStartMinutes(input.scheduledTimeStart)
    // Explicit `date: null` / `dateTime: null`: the same body PATCHes an existing
    // event, and events.patch merges start/end field by field — a trade changed
    // from 1 day to ½ day would otherwise keep its old `date` beside the new
    // `dateTime` and Google rejects it (and the reverse for ½ day → 1 day).
    start = {
      dateTime: `${input.scheduledDate}T${minutesToWallClock(startMinutes)}`,
      timeZone: CALENDAR_BUSINESS_TZ,
      date: null,
    }
    end = {
      dateTime: `${input.scheduledDate}T${minutesToWallClock(startMinutes + HALF_DAY_HOURS * 60)}`,
      timeZone: CALENDAR_BUSINESS_TZ,
      date: null,
    }
    reminderAnchorMinutes = startMinutes
  } else {
    start = { date: input.scheduledDate, dateTime: null, timeZone: null }
    // Google's all-day `end.date` is EXCLUSIVE — see file header.
    end = { date: addDaysToDateOnly(input.scheduledDate, calendarDaySpan(installDays)), dateTime: null, timeZone: null }
    reminderAnchorMinutes = 0
  }

  return {
    summary: `${TRADE_LABELS[trade]} install — ${input.customerName}${squares != null ? ` (${squares} sq)` : ''}${halfDay ? ' (½ day)' : ''}`,
    description: descriptionLines.join('\n'),
    ...(input.addressText ? { location: input.addressText } : {}),
    start,
    end,
    // An event otherwise inherits whatever default the guest happens to have —
    // often nothing at all. A crew that isn't reminded doesn't show up. Both
    // reminders fire the day before (when a crew plans the day and loads the
    // truck): 9:00 AM and 5:00 PM. Google counts all-day reminders back from
    // midnight of the start date and timed ones back from the start time, so
    // the offset is measured from whichever anchor applies.
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: reminderAnchorMinutes + 15 * 60 },
        { method: 'popup', minutes: reminderAnchorMinutes + 7 * 60 },
      ],
    },
    attendees,
  }
}

/**
 * The explicit nulls in {@link buildInstallEvent} exist only to clear fields on
 * a PATCH. A brand-new event has nothing to clear, so insert sends the plain shape.
 */
export function withoutClearedTimeFields(event: CalendarEvent): CalendarEvent {
  const strip = (t: CalendarEvent['start']): CalendarEvent['start'] =>
    Object.fromEntries(Object.entries(t).filter(([, v]) => v !== null)) as CalendarEvent['start']
  return { ...event, start: strip(event.start), end: strip(event.end) }
}

/** The subset of a trade (`work_orders` row + its job) the sync layer needs. */
export type InstallSyncTradeRow = {
  /** The work order id. */
  id: string
  org_id: string
  job_id: string
  job_number: string
  trade: Trade
  address_text: string | null
  /** Bare `YYYY-MM-DD`, or null if the trade somehow has no date. */
  scheduled_date: string | null
  scheduled_time_start: string | null
  install_days: number | string | null
  install_google_event_id: string | null
  install_calendar_id: string | null
  crew_link_token: string | null
}

export type SyncInstallToCalendarParams = {
  trade: InstallSyncTradeRow
  customerName: string
  totalSquares?: number | null
  /** The sub's address; omitted when the sub has none on file. */
  schedulingEmail?: string | null
  /** The ops user performing the assignment — fallback Google token. */
  schedulingUserId: string
  orgPhone?: string | null
  appUrl?: string | null
}

export type InstallCalendarSyncOutcome = 'synced' | 'no_token' | 'failed'

export type InstallCalendarSyncResult = {
  outcome: InstallCalendarSyncOutcome
  eventId: string | null
  calendarId: string | null
  error?: string | null
}

async function recordInstallSyncFailure(
  adminClient: SupabaseClient,
  trade: InstallSyncTradeRow,
  message: string
): Promise<void> {
  try {
    await adminClient
      .from('work_orders')
      .update({
        install_sync_failed_at: new Date().toISOString(),
        install_sync_error: message.slice(0, 2000),
      })
      .eq('id', trade.id)
      .eq('org_id', trade.org_id)
  } catch (e) {
    // Never let recording the failure become a second failure.
    console.warn('syncInstallToCalendar: could not record sync failure', e)
  }
}

/**
 * Push one trade's install to Google Calendar: creates the event when the trade
 * has no `install_google_event_id` yet, PATCHes it in place otherwise (so
 * rescheduling never leaves a duplicate invite behind). Persists the event id /
 * calendar id onto the trade on success.
 *
 * NON-DESTRUCTIVE BY CONTRACT: the caller must commit the `work_orders`
 * scheduling write BEFORE calling this. Nothing here rolls that back, and no
 * failure path deletes an existing event — see file header.
 */
export async function syncInstallToCalendar(
  adminClient: SupabaseClient,
  params: SyncInstallToCalendarParams
): Promise<InstallCalendarSyncResult> {
  const { trade } = params

  if (!trade.scheduled_date) {
    const message = 'Trade has no scheduled_date to sync.'
    await recordInstallSyncFailure(adminClient, trade, message)
    return { outcome: 'failed', eventId: trade.install_google_event_id, calendarId: trade.install_calendar_id, error: message }
  }

  const { token, calendarId: defaultCalendarId } = await resolveInstallCalendarConfig(
    adminClient,
    trade.org_id,
    params.schedulingUserId
  )

  if (!token) {
    // Not an error — the assignment is fully valid without a calendar event.
    return {
      outcome: 'no_token',
      eventId: trade.install_google_event_id,
      calendarId: trade.install_calendar_id,
    }
  }

  const event = buildInstallEvent({
    jobId: trade.job_id,
    jobNumber: trade.job_number,
    customerName: params.customerName,
    addressText: trade.address_text,
    trade: trade.trade,
    scheduledDate: trade.scheduled_date,
    installDays: trade.install_days,
    scheduledTimeStart: trade.scheduled_time_start,
    totalSquares: params.totalSquares,
    schedulingEmail: params.schedulingEmail,
    orgPhone: params.orgPhone,
    crewLinkToken: trade.crew_link_token,
    appUrl: params.appUrl,
  })

  // The trade's own stored calendar wins so an update or delete finds the event
  // it actually created, even if the org setting has changed since.
  const calendarId = trade.install_calendar_id || defaultCalendarId

  try {
    let eventId = trade.install_google_event_id
    if (eventId) {
      try {
        // A PATCH that switches an all-day event to a timed one (1 day → ½ day)
        // is accepted by Google as long as start and end change together, which
        // `buildInstallEvent` always sends.
        await updateCalendarEvent(token, eventId, event, calendarId, INSTALL_SEND_UPDATES)
      } catch (e) {
        // The event is gone — somebody deleted it out of Google directly. Without
        // this, the stale id is retried forever and the trade's sync is wedged.
        if (!isMissingEventError(e)) throw e
        console.warn('syncInstallToCalendar: stored event is gone, recreating', eventId)
        eventId = null
      }
    }
    if (!eventId) {
      const created = await createCalendarEvent(token, withoutClearedTimeFields(event), calendarId, INSTALL_SEND_UPDATES)
      eventId = created?.id ?? null
      if (!eventId) {
        const message = 'Google Calendar accepted the event but returned no id.'
        await recordInstallSyncFailure(adminClient, trade, message)
        return { outcome: 'failed', eventId: null, calendarId, error: message }
      }
    }

    await adminClient
      .from('work_orders')
      .update({
        install_google_event_id: eventId,
        install_calendar_id: calendarId,
        install_sync_failed_at: null,
        install_sync_error: null,
      })
      .eq('id', trade.id)
      .eq('org_id', trade.org_id)

    return { outcome: 'synced', eventId, calendarId }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('syncInstallToCalendar: Google sync failed', message)
    await recordInstallSyncFailure(adminClient, trade, message)
    return {
      outcome: 'failed',
      eventId: trade.install_google_event_id,
      calendarId: trade.install_calendar_id,
      error: message,
    }
  }
}

/**
 * Remove a trade's calendar event (unassign / remove trade). Best-effort against
 * Google — a delete failure still clears the stored ids so a re-assign doesn't
 * try to PATCH an event that may no longer exist.
 */
export async function removeInstallFromCalendar(
  adminClient: SupabaseClient,
  params: {
    trade: Pick<InstallSyncTradeRow, 'id' | 'org_id' | 'install_google_event_id' | 'install_calendar_id'>
    schedulingUserId: string
  }
): Promise<{ ok: boolean; warning?: string | null }> {
  const { trade } = params
  if (!trade.install_google_event_id) {
    return { ok: true }
  }

  let warning: string | null = null
  const { token, calendarId: defaultCalendarId } = await resolveInstallCalendarConfig(
    adminClient,
    trade.org_id,
    params.schedulingUserId
  )

  if (!token) {
    warning = 'No connected Google Calendar for this user; the existing event was not removed from Google.'
  } else {
    try {
      await deleteCalendarEvent(
        token,
        trade.install_google_event_id,
        trade.install_calendar_id || defaultCalendarId,
        // The sub is an attendee — cancelling without telling them means a crew
        // drives to a job that is no longer theirs.
        INSTALL_SEND_UPDATES
      )
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      if (!isMissingEventError(e)) {
        console.warn('removeInstallFromCalendar: delete failed (clearing stored ids anyway)', message)
        warning = `Google Calendar delete failed: ${message}`
      }
    }
  }

  await adminClient
    .from('work_orders')
    .update({
      install_google_event_id: null,
      install_calendar_id: null,
      install_sync_failed_at: null,
      install_sync_error: null,
    })
    .eq('id', trade.id)
    .eq('org_id', trade.org_id)

  return { ok: true, warning }
}
