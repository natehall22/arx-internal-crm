import { NextResponse } from 'next/server'
import { fromZonedTime } from 'date-fns-tz'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveOpsAccess } from '@/lib/ops-access'
import { parseScheduleWindow } from '@/lib/schedule-window'
import { resolveInstallCalendarConfig } from '@/lib/install-calendar'
import { CALENDAR_BUSINESS_TZ } from '@/lib/calendar-business-tz'
import {
  getFreeBusyForCalendars,
  listCalendarEventsInRange,
  type FreeBusyCalendarResult,
} from '@/lib/google-calendar'
import {
  busyDatesFromSlots,
  resolveSubCalendarId,
  resolveSubShareStatus,
  type SubShareStatus,
} from '@/lib/sub-availability'

/**
 * GET /api/ops/install-schedule/availability?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Deliberately a SEPARATE route from `GET /api/ops/install-schedule` (the
 * board's main data load): reading sub calendar free/busy talks to Google on
 * every request and can be slow or fail independently of the board itself, so
 * it must never be able to break loading the board.
 *
 * Returns, per active sub in the window: whether their calendar could be read
 * (`shareStatus`) and which bare dates they're already busy on
 * (`busyDates`) — plus RSVP status for jobs in the window that already have
 * an install invite out (`install_google_event_id`).
 *
 * See `lib/sub-availability.ts` for the permission model: subs share
 * free/busy with an ARX Google account rather than doing OAuth themselves, so
 * this reads Google using the REQUESTING OPS USER'S OWN token. No token on
 * file for that user is not an error — it's `source: 'no_token'`, HTTP 200,
 * with empty `subs`/`rsvp`.
 */

type SubCalendarRow = {
  id: string
  scheduling_email: string | null
  scheduling_calendar_id: string | null
}

type RsvpStatus = 'accepted' | 'declined' | 'tentative' | 'needsAction'

function isRsvpStatus(value: unknown): value is RsvpStatus {
  return value === 'accepted' || value === 'declined' || value === 'tentative' || value === 'needsAction'
}

export async function GET(request: Request) {
  let authUser: { id: string }
  let profile: { id: string; org_id: string; role: string; custom_role_id?: string | null }
  try {
    const ctx = await requireAuthApi()
    authUser = ctx.authUser
    profile = ctx.profile as typeof profile
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = createServiceClient()
  const { canJobBoard } = await resolveOpsAccess(adminClient, authUser.id, profile)
  if (!canJobBoard) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = parseScheduleWindow(new URL(request.url).searchParams)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  const { start, end } = parsed.window

  const orgId = profile.org_id

  // Same account installs are written from — see `resolveInstallGoogleToken`.
  // Reads and writes MUST act as one account: crews share their free/busy with a
  // single address, and RSVP is read off events that account owns.
  const { token, calendarId: installCalendarId } = await resolveInstallCalendarConfig(
    adminClient,
    orgId,
    authUser.id
  )

  // No connected Google account anywhere degrades gracefully — not an error,
  // just nothing to report, same as install scheduling itself.
  if (!token) {
    return NextResponse.json({ source: 'no_token', subs: [], rsvp: {} })
  }

  const { data: subsData, error: subsError } = await adminClient
    .from('sub_contractors')
    .select('id, scheduling_email, scheduling_calendar_id')
    .eq('org_id', orgId)
    .eq('active', true)

  if (subsError) {
    console.error('[install-schedule availability GET] subs:', subsError)
    return NextResponse.json({ error: 'Failed to load subcontractors' }, { status: 500 })
  }

  const subs = (subsData || []) as SubCalendarRow[]

  // Business-tz instant bounds for the whole window, mirroring the pattern in
  // `lib/calendar-business-tz.ts` (`nyMonthGridRangeUtc` etc) rather than a
  // new ad hoc timezone conversion.
  const windowStartInstant = fromZonedTime(`${start}T00:00:00`, CALENDAR_BUSINESS_TZ)
  const windowEndInstant = fromZonedTime(`${end}T23:59:59.999`, CALENDAR_BUSINESS_TZ)

  const calendarIdBySubId = new Map<string, string | null>()
  for (const sub of subs) {
    calendarIdBySubId.set(sub.id, resolveSubCalendarId(sub))
  }
  const calendarIdsToQuery = Array.from(
    new Set(Array.from(calendarIdBySubId.values()).filter((id): id is string => !!id))
  )

  let freeBusyBySubCalendar: Record<string, FreeBusyCalendarResult> = {}
  if (calendarIdsToQuery.length > 0) {
    try {
      freeBusyBySubCalendar = await getFreeBusyForCalendars(
        token,
        windowStartInstant,
        windowEndInstant,
        calendarIdsToQuery
      )
    } catch (e) {
      // A Google failure here must never 500 the route — every sub just falls
      // back to 'error' below (no per-calendar result), and the board still
      // renders with everything else it has.
      console.error('[install-schedule availability GET] getFreeBusyForCalendars failed', e)
      freeBusyBySubCalendar = {}
    }
  }

  const verifiedSubIds: string[] = []
  const responseSubs: { id: string; shareStatus: SubShareStatus; busyDates: string[] }[] = []

  for (const sub of subs) {
    const calendarId = calendarIdBySubId.get(sub.id) ?? null
    const freeBusyResult = calendarId ? freeBusyBySubCalendar[calendarId] : undefined
    const shareStatus = resolveSubShareStatus(calendarId, freeBusyResult)

    let busyDates: string[] = []
    if (shareStatus === 'ok' && freeBusyResult && 'busy' in freeBusyResult) {
      busyDates = busyDatesFromSlots(freeBusyResult.busy, start, end)
      verifiedSubIds.push(sub.id)
    }

    responseSubs.push({ id: sub.id, shareStatus, busyDates })
  }

  // Stamp calendar_share_verified_at on every sub whose free/busy read just
  // succeeded, so ops can tell a working share from a broken one without
  // re-querying Google. Best-effort: never let this write fail the request.
  if (verifiedSubIds.length > 0) {
    try {
      await adminClient
        .from('sub_contractors')
        .update({ calendar_share_verified_at: new Date().toISOString() })
        .eq('org_id', orgId)
        .in('id', verifiedSubIds)
    } catch (e) {
      console.warn('[install-schedule availability GET] failed to stamp calendar_share_verified_at', e)
    }
  }

  // RSVP: one events.list call against the install calendar for the whole
  // window, mapped back onto jobs by install_google_event_id — never one API
  // call per job.
  const rsvp: Record<string, RsvpStatus | null> = {}
  try {
    const { data: jobsData, error: jobsError } = await adminClient
      .from('production_jobs')
      .select('id, install_google_event_id, assigned_sub_id')
      .eq('org_id', orgId)
      .not('scheduled_date', 'is', null)
      .not('install_google_event_id', 'is', null)
      .gte('scheduled_date', start)
      .lte('scheduled_date', end)

    if (jobsError) {
      console.error('[install-schedule availability GET] jobs (rsvp):', jobsError)
    } else {
      const jobs = (jobsData || []) as {
        id: string
        install_google_event_id: string | null
        assigned_sub_id: string | null
      }[]
      if (jobs.length > 0) {
        const events = await listCalendarEventsInRange(
          token,
          installCalendarId,
          windowStartInstant.toISOString(),
          windowEndInstant.toISOString()
        )
        // Index the whole attendee list per event. Reading `attendees[0]` would
        // happen to work today only because `buildInstallEvent` adds exactly one
        // guest — it silently returns the wrong person's answer the moment a
        // second attendee (an ops watcher, the organizer) appears on an event.
        // Match on the sub's own address instead.
        const attendeesByEventId = new Map<string, { email: string; status: RsvpStatus | null }[]>()
        for (const event of events) {
          attendeesByEventId.set(
            event.id,
            (event.attendees ?? []).map((a) => ({
              email: String(a?.email ?? '').trim().toLowerCase(),
              status: isRsvpStatus(a?.responseStatus) ? a.responseStatus : null,
            }))
          )
        }

        const subAddressById = new Map<string, string>()
        for (const sub of subs) {
          const addr = resolveSubCalendarId(sub)
          if (addr) subAddressById.set(sub.id, addr.trim().toLowerCase())
        }

        for (const job of jobs) {
          if (!job.install_google_event_id) continue
          const attendees = attendeesByEventId.get(job.install_google_event_id)
          if (!attendees || attendees.length === 0) {
            rsvp[job.id] = null
            continue
          }
          const wanted = job.assigned_sub_id ? subAddressById.get(job.assigned_sub_id) : undefined
          const match = wanted ? attendees.find((a) => a.email === wanted) : undefined
          // No address on file for the sub means nobody was invited; report
          // "unknown" rather than borrowing whoever else is on the event.
          rsvp[job.id] = match ? match.status : null
        }
      }
    }
  } catch (e) {
    // Same policy as free/busy above — a Google failure here degrades to "we
    // don't know the RSVP status," never a 500 for the whole route.
    console.error('[install-schedule availability GET] RSVP lookup failed', e)
  }

  return NextResponse.json({ source: 'connected', subs: responseSubs, rsvp })
}
