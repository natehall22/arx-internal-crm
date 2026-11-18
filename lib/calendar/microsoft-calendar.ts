/**
 * Microsoft 365 / Outlook calendar through Microsoft Graph. Env: MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET,
 * MICROSOFT_REDIRECT_URI (optional, default `<app url>/api/auth/microsoft/callback`), MICROSOFT_TENANT (optional,
 * default 'common'), plus SECRETS_ENCRYPTION_KEY (tokens are sealed at rest). Any of the first two or the last
 * missing = the integration is off and "Connect Outlook" is hidden.
 *
 * TIME RULE: every timed instant we send or read is UTC (`timeZone: "UTC"`, `Prefer: outlook.timezone="UTC"`); UTC has
 * no DST, so a timed event lands on the right instant by construction. ALL-DAY events are the exception: they are a
 * calendar DATE in the org's time zone, so they are sent as `{dateTime: 'YYYY-MM-DDT00:00:00', timeZone: <org IANA tz>}`
 * with `isAllDay: true` (Graph accepts IANA names; midnight in that zone is what Outlook requires), never built from a
 * Date round-trip, and are read back as the org-local day (`allDayBusy`). The org zone is `DEFAULT_TIMEZONE`, the
 * same constant install scheduling and sub availability already use.
 *
 * GUEST MAIL: Graph always emails guests on create/update/cancel; there is no "send nobody" switch. So an explicit
 * `sendUpdates: 'none'` means: never invite on create, and on update/delete do NOTHING when the event has guests and
 * return `{skipped}` for the caller to surface. Omitting `sendUpdates` means no preference (Google: its default none).
 */
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

import { getAppUrl } from '@/lib/app-url'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'
import {
  CalendarApiError,
  isWindowFree,
  pickOpenSlots,
  workingWindow,
  type CalendarClient,
  type CalendarEvent,
  type CalendarEventListItem,
  type CalendarUpdateResult,
  type CalendarWriteSkipped,
  type FreeBusyCalendarResult,
  type FreeBusySlot,
  type SendUpdates,
} from '@/lib/calendar/provider'

const GRAPH = 'https://graph.microsoft.com/v1.0'
export const MICROSOFT_SCOPES = ['offline_access', 'Calendars.ReadWrite', 'Calendars.Read.Shared', 'User.Read'].join(' ')

export class MicrosoftCalendarError extends CalendarApiError {
  constructor(message: string, status: number) {
    super(message, status)
    this.name = 'MicrosoftCalendarError'
  }
}

export function microsoftTenant(): string {
  return process.env.MICROSOFT_TENANT?.trim() || 'common'
}

/** The integration is on only when it can both talk to Microsoft and seal what it gets back. */
export function microsoftConfigured(): boolean {
  return Boolean(
    process.env.MICROSOFT_CLIENT_ID?.trim() &&
      process.env.MICROSOFT_CLIENT_SECRET?.trim() &&
      (process.env.SECRETS_ENCRYPTION_KEY?.trim().length ?? 0) >= 32
  )
}

export function microsoftRedirectUri(): string {
  return process.env.MICROSOFT_REDIRECT_URI?.trim() || `${getAppUrl()}/api/auth/microsoft/callback`
}

const authority = () => `https://login.microsoftonline.com/${encodeURIComponent(microsoftTenant())}/oauth2/v2.0`

/** Where to send the browser to consent. `codeChallenge` is the S256 challenge of the server-held verifier (PKCE). */
export function getMicrosoftAuthUrl(state: string, codeChallenge: string): string {
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim()
  if (!clientId) throw new Error('MICROSOFT_CLIENT_ID not configured')
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: microsoftRedirectUri(),
    response_mode: 'query',
    scope: MICROSOFT_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })
  return `${authority()}/authorize?${params.toString()}`
}

export type MicrosoftTokens = { accessToken: string; refreshToken: string; expiresAt: Date; scope: string }

async function tokenRequest(body: Record<string, string>, what: string, keepRefreshToken?: string): Promise<MicrosoftTokens> {
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim()
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) throw new Error('Microsoft OAuth credentials not configured')
  const response = await fetch(`${authority()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: MICROSOFT_SCOPES, ...body }),
  })
  if (!response.ok) {
    // Log the error code only: never the body of a token call.
    const err = (await response.json().catch(() => ({}))) as { error?: string }
    console.error(`Microsoft ${what} failed (${response.status}): ${err.error ?? 'unknown'}`)
    throw new MicrosoftCalendarError(`Microsoft ${what} failed (${response.status})`, response.status)
  }
  const data = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }
  // A refresh response may omit a new refresh token: the old one stays valid, so keep it (a code exchange must return one).
  const refreshToken = data.refresh_token || keepRefreshToken
  if (!data.access_token || !refreshToken || typeof data.expires_in !== 'number') {
    throw new MicrosoftCalendarError(`Microsoft ${what} returned an incomplete token`, 502)
  }
  return {
    accessToken: data.access_token,
    refreshToken,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scope: data.scope ?? MICROSOFT_SCOPES,
  }
}

export function exchangeMicrosoftCode(code: string, codeVerifier: string): Promise<MicrosoftTokens> {
  return tokenRequest(
    { grant_type: 'authorization_code', code, redirect_uri: microsoftRedirectUri(), code_verifier: codeVerifier },
    'code exchange'
  )
}

/** Microsoft usually rotates the refresh token: the caller MUST store the returned one (it is the old one when none came back). */
export function refreshMicrosoftToken(refreshToken: string): Promise<MicrosoftTokens> {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }, 'token refresh', refreshToken)
}

/** The connected account's address, for the "Connected as ..." line. Null on any failure (cosmetic). */
export async function fetchMicrosoftAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const r = await fetch(`${GRAPH}/me?$select=mail,userPrincipalName`, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!r.ok) return null
    const d = (await r.json()) as { mail?: string | null; userPrincipalName?: string | null }
    if (d.mail) return d.mail
    // A guest account's UPN is a mangled "name_domain#EXT#@tenant" string nobody can share a calendar with.
    const upn = d.userPrincipalName
    return upn && !upn.toUpperCase().includes('#EXT#') ? upn : null
  } catch {
    return null
  }
}

// ---------- time helpers (pure, exported for tests) ----------

const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i

/** Graph returns UTC wall times without a designator ("2026-11-01T14:00:00.0000000"): make them real ISO instants. */
export function graphUtcToIso(dateTime: string): string {
  const trimmed = dateTime.replace(/(\.\d{3})\d*/, '$1')
  return HAS_ZONE.test(trimmed) ? new Date(trimmed).toISOString() : new Date(`${trimmed}Z`).toISOString()
}

/** The instant a caller's `{dateTime, timeZone?}` means: an offset/Z in the string wins, else the wall time in `timeZone`, else UTC. */
export function instantOf(dateTime: string, timeZone?: string): Date {
  if (HAS_ZONE.test(dateTime)) return new Date(dateTime)
  return timeZone ? fromZonedTime(dateTime, timeZone) : new Date(`${dateTime}Z`)
}

const utcWall = (d: Date) => d.toISOString().slice(0, 19)

type GraphTime = { dateTime: string; timeZone: string }

/**
 * One caller-side start/end → Graph's `{dateTime, timeZone}`; all-day flag set from the shape. Timed = UTC; all-day =
 * the bare date at 00:00 in `orgTimeZone` (never a UTC midnight, which is a different local day).
 */
export function toGraphTime(t: CalendarEvent['start'], orgTimeZone: string = DEFAULT_TIMEZONE): { time: GraphTime; allDay: boolean } {
  if (typeof (t as { date?: unknown }).date === 'string' && (t as { date: string }).date) {
    return { time: { dateTime: `${(t as { date: string }).date}T00:00:00`, timeZone: orgTimeZone }, allDay: true }
  }
  const tt = t as { dateTime: string; timeZone?: string }
  return { time: { dateTime: utcWall(instantOf(tt.dateTime, tt.timeZone)), timeZone: 'UTC' }, allDay: false }
}

/** Google-shaped event (full or patch) → Graph event body. `sendUpdates:'none'` drops attendees: Graph has no switch to mail nobody. */
export function toGraphEvent(event: Partial<CalendarEvent>, sendUpdates: SendUpdates, orgTimeZone: string = DEFAULT_TIMEZONE): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (event.summary !== undefined) out.subject = event.summary
  if (event.description !== undefined) out.body = { contentType: 'text', content: event.description }
  if (event.location !== undefined) out.location = { displayName: event.location }
  if (event.start) {
    const s = toGraphTime(event.start, orgTimeZone)
    out.start = s.time
    out.isAllDay = s.allDay
  }
  if (event.end) out.end = toGraphTime(event.end, orgTimeZone).time
  if (event.attendees && sendUpdates !== 'none') {
    out.attendees = event.attendees.map((a) => ({ emailAddress: { address: a.email }, type: 'required' }))
  }
  if (event.reminders && !event.reminders.useDefault) {
    const popup = event.reminders.overrides?.find((o) => o.method === 'popup') ?? event.reminders.overrides?.[0]
    if (popup) {
      out.isReminderOn = true
      out.reminderMinutesBeforeStart = popup.minutes
    } else {
      out.isReminderOn = false
    }
  }
  return out
}

const RSVP: Record<string, string> = { accepted: 'accepted', declined: 'declined', tentativelyAccepted: 'tentative' }
const BUSY_STATUS = new Set(['busy', 'oof', 'tentative'])

/** Graph response word → Google's, so RSVP readers need no provider branch. */
export function rsvpOf(response: string | undefined): string {
  return (response && RSVP[response]) || 'needsAction'
}

/** Graph `getSchedule` per-schedule error → the reason words `lib/sub-availability.ts` already understands. */
export function scheduleErrorReason(responseCode: string | undefined): string {
  const code = responseCode ?? ''
  if (/NotFound|InvalidUser|FreeBusyDataNotAvailable|NoPermission|NotAvailable/i.test(code)) return 'notFound'
  if (/AccessDenied|Forbidden/i.test(code)) return 'forbidden'
  return code || 'unknown_error'
}

type GraphSchedule = {
  scheduleId?: string
  availabilityView?: string
  scheduleItems?: { status?: string; start?: { dateTime: string }; end?: { dateTime: string } }[]
  error?: { responseCode?: string; message?: string }
}

/** One `getSchedule` entry → busy blocks or an error. Anything we can't positively read is an error, never "free". */
export function resultFromSchedule(s: GraphSchedule | undefined): FreeBusyCalendarResult {
  if (!s) return { error: 'no_response' }
  if (s.error) return { error: scheduleErrorReason(s.error.responseCode) }
  const view = s.availabilityView
  if (typeof view !== 'string' || view.length === 0) return { error: 'notFound' }
  if (!Array.isArray(s.scheduleItems)) {
    // A view with busy characters but no items is unreadable detail; a view of all-free is genuinely free.
    return /[1-3]/.test(view) ? { error: 'unknown_error' } : { busy: [] }
  }
  const busy: FreeBusySlot[] = []
  for (const item of s.scheduleItems) {
    if (!item.status || !BUSY_STATUS.has(item.status) || !item.start || !item.end) continue
    busy.push({ start: graphUtcToIso(item.start.dateTime), end: graphUtcToIso(item.end.dateTime) })
  }
  return { busy }
}

/**
 * One calendarView event → a busy block. Timed events: the UTC instants Graph returned. All-day events are the org-local
 * DAY, not the instants Graph happens to express them in: midnight-to-midnight of its date(s) in `orgTimeZone` (so a
 * DST-change day is 23 or 25 hours, and the day never slides to a neighbour). If Graph returns an all-day event as a
 * floating UTC midnight, its date part is the date; if it returns the org's own midnight as a UTC instant, that instant
 * rendered in the org zone is the date. Both land on the same org-local day.
 */
export function allDayBusy(startDateTime: string, endDateTime: string, orgTimeZone: string = DEFAULT_TIMEZONE): FreeBusySlot {
  const dateOf = (dt: string) => {
    const iso = graphUtcToIso(dt)
    return iso.slice(11, 19) === '00:00:00' ? iso.slice(0, 10) : formatInTimeZone(new Date(iso), orgTimeZone, 'yyyy-MM-dd')
  }
  const startDay = dateOf(startDateTime)
  let endDay = dateOf(endDateTime)
  if (endDay <= startDay) endDay = new Date(Date.parse(`${startDay}T00:00:00Z`) + 24 * 3600_000).toISOString().slice(0, 10)
  return {
    start: fromZonedTime(`${startDay}T00:00:00`, orgTimeZone).toISOString(),
    end: fromZonedTime(`${endDay}T00:00:00`, orgTimeZone).toISOString(),
  }
}

// ---------- the client ----------

const PREFER = 'outlook.timezone="UTC", IdType="ImmutableId"'

/** `primary` (and anything address-shaped, which is how Google names calendars) is the user's own default calendar. */
function calendarBase(calendarId: string): string {
  return !calendarId || calendarId === 'primary' || calendarId.includes('@') ? `${GRAPH}/me` : `${GRAPH}/me/calendars/${encodeURIComponent(calendarId)}`
}

async function graphFetch(accessToken: string, url: string, init: RequestInit = {}): Promise<Response> {
  const run = () =>
    fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, Prefer: PREFER, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers as Record<string, string> | undefined) },
    })
  let res = await run()
  if (res.status === 429 || res.status === 503) {
    const wait = Math.min(Number(res.headers.get('Retry-After')) || 1, 5)
    await new Promise((r) => setTimeout(r, wait * 1000))
    res = await run()
  }
  return res
}

async function failure(res: Response, what: string): Promise<MicrosoftCalendarError> {
  const detail = await res.text().catch(() => '')
  console.error(`Microsoft Calendar ${what} failed`, { status: res.status, detail: detail.slice(0, 300) })
  return new MicrosoftCalendarError(`Microsoft Calendar ${what} failed (${res.status})`, res.status)
}

/** Whether the stored event has any guests (so any write to it would make Graph mail them). A 404 throws the usual missing-event error. */
async function eventHasGuests(accessToken: string, eventUrl: string): Promise<boolean> {
  const res = await graphFetch(accessToken, `${eventUrl}?$select=attendees`)
  if (!res.ok) throw await failure(res, 'read')
  const data = (await res.json()) as { attendees?: unknown[] }
  return Array.isArray(data.attendees) && data.attendees.length > 0
}

async function pagedValues<T>(accessToken: string, firstUrl: string, what: string): Promise<T[]> {
  const items: T[] = []
  let url: string | undefined = firstUrl
  while (url) {
    const res: Response = await graphFetch(accessToken, url)
    if (!res.ok) throw await failure(res, what)
    const data = (await res.json()) as { value?: T[]; '@odata.nextLink'?: string }
    items.push(...(data.value ?? []))
    url = data['@odata.nextLink']
  }
  return items
}

export function microsoftClient(accessToken: string, orgTimeZone: string = DEFAULT_TIMEZONE): CalendarClient {
  const client: CalendarClient = {
    provider: 'microsoft',
    accessToken,

    async getFreeBusy(timeMin, timeMax) {
      const calendars = await pagedValues<{ id: string; isDefaultCalendar?: boolean; canEdit?: boolean }>(
        accessToken,
        `${GRAPH}/me/calendars?$select=id,isDefaultCalendar,canEdit&$top=50`,
        'calendar list'
      )
      const own = calendars.filter((c) => c.isDefaultCalendar || c.canEdit).slice(0, 10)
      const busy: FreeBusySlot[] = []
      for (const cal of own.length ? own : [{ id: '' }]) {
        const base = cal.id ? `${GRAPH}/me/calendars/${encodeURIComponent(cal.id)}` : `${GRAPH}/me`
        const url = `${base}/calendarView?startDateTime=${encodeURIComponent(timeMin.toISOString())}&endDateTime=${encodeURIComponent(timeMax.toISOString())}&$select=start,end,showAs,isCancelled,isAllDay&$top=250`
        const events = await pagedValues<{ start: { dateTime: string }; end: { dateTime: string }; showAs?: string; isCancelled?: boolean; isAllDay?: boolean }>(accessToken, url, 'free/busy')
        for (const e of events) {
          if (e.isCancelled || !e.showAs || !BUSY_STATUS.has(e.showAs)) continue
          busy.push(e.isAllDay ? allDayBusy(e.start.dateTime, e.end.dateTime, orgTimeZone) : { start: graphUtcToIso(e.start.dateTime), end: graphUtcToIso(e.end.dateTime) })
        }
      }
      return busy
    },

    async getFreeBusyForCalendars(timeMin, timeMax, calendarIds) {
      const ids = Array.from(new Set(calendarIds.map((id) => id.trim()).filter(Boolean)))
      const result: Record<string, FreeBusyCalendarResult> = {}
      for (let i = 0; i < ids.length; i += 20) {
        const chunk = ids.slice(i, i + 20)
        const res = await graphFetch(accessToken, `${GRAPH}/me/calendar/getSchedule`, {
          method: 'POST',
          body: JSON.stringify({
            schedules: chunk,
            startTime: { dateTime: utcWall(timeMin), timeZone: 'UTC' },
            endTime: { dateTime: utcWall(timeMax), timeZone: 'UTC' },
            availabilityViewInterval: 30,
          }),
        })
        if (!res.ok) throw await failure(res, 'free/busy')
        const data = (await res.json()) as { value?: GraphSchedule[] }
        const byId = new Map((data.value ?? []).map((s) => [(s.scheduleId ?? '').toLowerCase(), s]))
        for (const id of chunk) result[id] = resultFromSchedule(byId.get(id.toLowerCase()))
      }
      return result
    },

    async isSlotAvailable(start, end, bufferMinutes = 0) {
      const busy = await client.getFreeBusy(new Date(start.getTime() - bufferMinutes * 60_000), new Date(end.getTime() + bufferMinutes * 60_000))
      return isWindowFree(busy)
    },

    async getAvailableSlots(date, durationMinutes = 60, bufferMinutes = 60, workingHoursStart = 8, workingHoursEnd = 20) {
      const { dayStart, dayEnd } = workingWindow(date, workingHoursStart, workingHoursEnd)
      const busy = await client.getFreeBusy(dayStart, dayEnd)
      return pickOpenSlots(busy, dayStart, dayEnd, durationMinutes, bufferMinutes)
    },

    async createEvent(event, calendarId = 'primary', sendUpdates = 'none') {
      const res = await graphFetch(accessToken, `${calendarBase(calendarId)}/events`, {
        method: 'POST',
        // Graph can't take a caller-chosen event id; `transactionId` is its way to make a retried POST create nothing new.
        body: JSON.stringify({ ...toGraphEvent(event, sendUpdates, orgTimeZone), ...(event.id ? { transactionId: event.id } : {}) }),
      })
      if (!res.ok) throw await failure(res, 'create')
      const data = (await res.json()) as { id: string; subject?: string }
      return { ...event, id: data.id, summary: data.subject ?? event.summary }
    },

    async updateEvent(eventId, event, calendarId = 'primary', sendUpdates): Promise<CalendarUpdateResult> {
      const url = `${GRAPH}/me/events/${encodeURIComponent(eventId)}`
      if (sendUpdates === 'none' && ((event.attendees?.length ?? 0) > 0 || (await eventHasGuests(accessToken, url)))) {
        console.warn('Outlook update skipped: the event has guests and the caller asked that nobody be notified', eventId)
        return { ...(event as CalendarEvent), id: eventId, summary: event.summary ?? '', skipped: 'guests_would_be_notified' }
      }
      const res = await graphFetch(accessToken, url, {
        method: 'PATCH',
        body: JSON.stringify(toGraphEvent(event, sendUpdates ?? 'all', orgTimeZone)),
      })
      if (!res.ok) throw await failure(res, 'update')
      const data = (await res.json()) as { id: string; subject?: string }
      return { ...(event as CalendarEvent), id: data.id, summary: data.subject ?? event.summary ?? '' }
    },

    async deleteEvent(eventId, calendarId = 'primary', sendUpdates): Promise<void | CalendarWriteSkipped> {
      const url = `${GRAPH}/me/events/${encodeURIComponent(eventId)}`
      if (sendUpdates === 'none') {
        // Deleting an event with guests makes Graph mail them a cancellation: refuse rather than tell people we said we wouldn't.
        let guests: boolean
        try {
          guests = await eventHasGuests(accessToken, url)
        } catch (e) {
          if (e instanceof CalendarApiError && e.status === 404) return
          throw e
        }
        if (guests) {
          console.warn('Outlook delete skipped: the event has guests and the caller asked that nobody be notified', eventId)
          return { skipped: 'guests_would_be_notified' }
        }
      } else if (sendUpdates) {
        // A meeting we organise is cancelled (attendees are told); a plain event can't be "cancelled", so fall through to delete.
        const c = await graphFetch(accessToken, `${url}/cancel`, { method: 'POST', body: JSON.stringify({ comment: '' }) })
        if (c.ok || c.status === 404) return
      }
      const res = await graphFetch(accessToken, url, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) throw await failure(res, 'delete')
    },

    async listEventsInRange(calendarId, timeMinIso, timeMaxIso) {
      const url = `${calendarBase(calendarId)}/calendarView?startDateTime=${encodeURIComponent(timeMinIso)}&endDateTime=${encodeURIComponent(timeMaxIso)}&$select=id,attendees&$top=100`
      const events = await pagedValues<{ id: string; attendees?: { emailAddress?: { address?: string }; status?: { response?: string } }[] }>(accessToken, url, 'list events')
      const items: CalendarEventListItem[] = []
      for (const e of events) {
        if (!e.id) continue
        items.push({
          id: e.id,
          attendees: e.attendees?.map((a) => ({ email: a.emailAddress?.address ?? '', responseStatus: rsvpOf(a.status?.response) })),
        })
      }
      return items
    },
  }
  return client
}
