/**
 * Google Calendar sync for roof install scheduling.
 *
 * ARX uses subcontractor crews only (no in-house crews). A sub has no CRM
 * login and no Google OAuth of their own — instead they give ARX a Google
 * email address (`sub_contractors.scheduling_email`), and that address is
 * added to the install event as an ATTENDEE so Google pushes the invite to
 * the sub's own calendar and emails them updates natively. We never send the
 * sub anything ourselves; Google does it because they're a guest on the event.
 *
 * An install is an ALL-DAY event lasting 1-2 days (`production_jobs.
 * install_days`, NULL treated as 1).
 *
 * THE MOST IMPORTANT RULE IN THIS FILE: `production_jobs.scheduled_date` is a
 * bare SQL `DATE` (`YYYY-MM-DD`). It must reach Google as that exact string
 * and must NEVER be round-tripped through a JS `Date` + `toISOString()` (which
 * shifts across UTC offsets) or any `America/New_York`-formatting helper (the
 * codebase hardcodes that timezone in ~150 places and it has already caused a
 * production double-timezone bug). All date arithmetic here — adding
 * `install_days` — is done with `date-fns`'s `addDays` on a Date built from
 * the raw `y/m/d` parts (a *local* Date, never parsed from an ISO string),
 * then re-serialized with `format(d, 'yyyy-MM-dd')`. No `new Date(str)` +
 * `toISOString()` appears anywhere in this file.
 *
 * Google's all-day `end.date` is EXCLUSIVE: a 1-day install on 2026-09-10 is
 * `start.date: '2026-09-10'`, `end.date: '2026-09-11'`; a 2-day install ends
 * `'2026-09-12'`. Getting this backwards renders every install one day short
 * or one day long — see `lib/__tests__/install-calendar.test.ts` for the
 * pinned behavior.
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
 * Google failure is recorded to `install_sync_failed_at` / `install_sync_error`
 * and the DB change stands. A scheduling user with no Google token at all
 * (very common — most ops staff don't connect Google) is NOT an error either:
 * the assignment simply succeeds with no calendar event.
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

const DEFAULT_APP_URL = 'https://arx-internal-crm.vercel.app'

/**
 * `sendUpdates` for create, update AND delete. Google defaults every one of
 * these to `none`, so each call site has to pass this explicitly or the sub is
 * never told anything after the first invite.
 */
export const INSTALL_SEND_UPDATES = 'all' as const

function resolveAppUrl(appUrl?: string | null): string {
  return appUrl || process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL
}

export function installJobPageUrl(jobId: string, appUrl?: string | null): string {
  return `${resolveAppUrl(appUrl)}/ops/jobs/${jobId}`
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
 * exactly the round-trip this file must avoid. Constructing from numeric
 * parts always yields the intended calendar day regardless of the process's
 * local timezone or any DST boundary.
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

export type BuildInstallEventInput = {
  jobId: string
  jobNumber: string
  customerName: string
  addressText?: string | null
  /** Bare `YYYY-MM-DD` — the raw `production_jobs.scheduled_date` value, never a parsed `Date`. */
  scheduledDate: string
  /** 1 or 2; `null`/`undefined` is treated as 1. */
  installDays?: number | null
  totalSquares?: number | null
  /** The sub's Google address (`sub_contractors.scheduling_email`); omitted when not on file. */
  schedulingEmail?: string | null
  appUrl?: string | null
}

/** Pure function — no I/O. Builds the Google all-day event body for a job's install. */
export function buildInstallEvent(input: BuildInstallEventInput): CalendarEvent {
  const days = input.installDays === 2 ? 2 : 1
  const startDate = input.scheduledDate
  // Google's all-day `end.date` is EXCLUSIVE — see file header.
  const endDate = addDaysToDateOnly(startDate, days)

  const descriptionLines = [
    `Job #: ${input.jobNumber}`,
    typeof input.totalSquares === 'number' && input.totalSquares > 0
      ? `Squares: ${input.totalSquares}`
      : null,
    `Job page: ${installJobPageUrl(input.jobId, input.appUrl)}`,
  ].filter((line): line is string => Boolean(line))

  const schedulingEmail = (input.schedulingEmail ?? '').trim().toLowerCase()
  const attendees = schedulingEmail ? [{ email: schedulingEmail }] : undefined

  return {
    summary: `Install — ${input.jobNumber} — ${input.customerName}`,
    description: descriptionLines.join('\n'),
    ...(input.addressText ? { location: input.addressText } : {}),
    start: { date: startDate },
    end: { date: endDate },
    ...(attendees ? { attendees } : {}),
  }
}

/** The subset of `production_jobs` columns the sync layer needs. */
export type InstallSyncJobRow = {
  id: string
  org_id: string
  job_number: string
  address_text: string | null
  /** Bare `YYYY-MM-DD`, or null if the job somehow has no scheduled_date. */
  scheduled_date: string | null
  install_days: number | null
  install_google_event_id: string | null
  install_calendar_id: string | null
}

export type SyncInstallToCalendarParams = {
  job: InstallSyncJobRow
  customerName: string
  totalSquares?: number | null
  /** The sub's Google address; omitted when the sub has none on file. */
  schedulingEmail?: string | null
  /** The ops user performing the assignment — their connected Google token is used. */
  schedulingUserId: string
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
  job: InstallSyncJobRow,
  message: string
): Promise<void> {
  try {
    await adminClient
      .from('production_jobs')
      .update({
        install_sync_failed_at: new Date().toISOString(),
        install_sync_error: message.slice(0, 2000),
      })
      .eq('id', job.id)
      .eq('org_id', job.org_id)
  } catch (e) {
    // Pre-migration (or a transient DB error) the columns/row may be unreachable.
    // Never let recording the failure become a second failure.
    console.warn('syncInstallToCalendar: could not record sync failure', e)
  }
}

/**
 * Push a job's install to Google Calendar: creates the event when the job has
 * no `install_google_event_id` yet, PATCHes it in place otherwise (so
 * rescheduling never leaves a duplicate invite behind). Persists the new
 * `install_google_event_id` / `install_calendar_id` onto the job on success.
 *
 * NON-DESTRUCTIVE BY CONTRACT: the caller must commit the `production_jobs`
 * scheduling write BEFORE calling this. Nothing here rolls that back, and no
 * failure path deletes an existing event — see file header.
 */
export async function syncInstallToCalendar(
  adminClient: SupabaseClient,
  params: SyncInstallToCalendarParams
): Promise<InstallCalendarSyncResult> {
  const { job } = params

  if (!job.scheduled_date) {
    const message = 'Job has no scheduled_date to sync.'
    await recordInstallSyncFailure(adminClient, job, message)
    return { outcome: 'failed', eventId: job.install_google_event_id, calendarId: job.install_calendar_id, error: message }
  }

  let token: string | null = null
  try {
    token = await getValidAccessToken(adminClient, params.schedulingUserId)
  } catch (e) {
    console.warn('syncInstallToCalendar: token lookup failed, treating as no_token', e)
    token = null
  }

  if (!token) {
    // Not an error — most ops users have not connected Google, and the
    // assignment is fully valid without a calendar event.
    return {
      outcome: 'no_token',
      eventId: job.install_google_event_id,
      calendarId: job.install_calendar_id,
    }
  }

  const event = buildInstallEvent({
    jobId: job.id,
    jobNumber: job.job_number,
    customerName: params.customerName,
    addressText: job.address_text,
    scheduledDate: job.scheduled_date,
    installDays: job.install_days,
    totalSquares: params.totalSquares,
    schedulingEmail: params.schedulingEmail,
    appUrl: params.appUrl,
  })

  const calendarId = job.install_calendar_id || resolveInstallCalendarId()

  try {
    let eventId = job.install_google_event_id
    if (eventId) {
      try {
        await updateCalendarEvent(token, eventId, event, calendarId, INSTALL_SEND_UPDATES)
      } catch (e) {
        // The event is gone — somebody deleted it out of Google directly. Without
        // this, the stale id is retried forever and the job's sync is wedged for
        // good, because nothing else ever clears it.
        if (!isMissingEventError(e)) throw e
        console.warn('syncInstallToCalendar: stored event is gone, recreating', eventId)
        eventId = null
      }
    }
    if (!eventId) {
      const created = await createCalendarEvent(token, event, calendarId, INSTALL_SEND_UPDATES)
      eventId = created?.id ?? null
      if (!eventId) {
        const message = 'Google Calendar accepted the event but returned no id.'
        await recordInstallSyncFailure(adminClient, job, message)
        return { outcome: 'failed', eventId: null, calendarId, error: message }
      }
    }

    await adminClient
      .from('production_jobs')
      .update({
        install_google_event_id: eventId,
        install_calendar_id: calendarId,
        install_sync_failed_at: null,
        install_sync_error: null,
      })
      .eq('id', job.id)
      .eq('org_id', job.org_id)

    return { outcome: 'synced', eventId, calendarId }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('syncInstallToCalendar: Google sync failed', message)
    // NEVER roll back or delete the database write, and never delete the
    // event on error — just record the failure for the board to surface.
    await recordInstallSyncFailure(adminClient, job, message)
    return {
      outcome: 'failed',
      eventId: job.install_google_event_id,
      calendarId: job.install_calendar_id,
      error: message,
    }
  }
}

/**
 * Remove an install's calendar event (used by unassign). Best-effort against
 * Google — a delete failure still clears the stored ids so a re-assign
 * doesn't try to PATCH an event that may no longer exist.
 */
export async function removeInstallFromCalendar(
  adminClient: SupabaseClient,
  params: { job: InstallSyncJobRow; schedulingUserId: string }
): Promise<{ ok: boolean; warning?: string | null }> {
  const { job } = params
  if (!job.install_google_event_id) {
    return { ok: true }
  }

  let warning: string | null = null
  let token: string | null = null
  try {
    token = await getValidAccessToken(adminClient, params.schedulingUserId)
  } catch (e) {
    token = null
  }

  if (!token) {
    warning = 'No connected Google Calendar for this user; the existing event was not removed from Google.'
  } else {
    try {
      await deleteCalendarEvent(
        token,
        job.install_google_event_id,
        job.install_calendar_id || resolveInstallCalendarId(),
        // The sub is an attendee — cancelling without telling them means a crew
        // drives to a job that is no longer theirs.
        INSTALL_SEND_UPDATES
      )
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      console.warn('removeInstallFromCalendar: delete failed (clearing stored ids anyway)', message)
      warning = `Google Calendar delete failed: ${message}`
    }
  }

  await adminClient
    .from('production_jobs')
    .update({
      install_google_event_id: null,
      install_calendar_id: null,
      install_sync_failed_at: null,
      install_sync_error: null,
    })
    .eq('id', job.id)
    .eq('org_id', job.org_id)

  return { ok: true, warning }
}
