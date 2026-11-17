/**
 * The ONE calendar-provider contract. Google (lib/google-calendar.ts, wrapped by ./google-provider.ts) and Microsoft
 * 365 / Outlook (./microsoft-calendar.ts) implement `CalendarClient`; callers get a client for the user's connected
 * provider from ./connection.ts and never branch on the provider themselves. Event shapes stay Google-shaped (they are
 * the app's own event model); the Microsoft side translates at its edge.
 */

export type CalendarProviderId = 'google' | 'microsoft'

/**
 * A timed instant (used by every existing caller — appointment sync, adjuster meetings, closer calendar sync): a
 * specific time plus an IANA timezone.
 */
export interface CalendarEventDateTime {
  dateTime: string
  timeZone?: string
  /**
   * Send `null` when PATCHing an event that was all-day: events.patch merges nested objects field by field, so an
   * omitted `date` survives next to the new `dateTime` and Google rejects the update.
   */
  date?: null
}

/**
 * An all-day date (used by install scheduling): a bare `YYYY-MM-DD`, no time or timezone component at all — this is
 * Google's own representation of an all-day event and must never be constructed from a JS `Date`/`toISOString()`
 * round-trip, which can shift the calendar day.
 */
export interface CalendarEventDate {
  date: string
  /** Send `null` when PATCHing an event that was timed — see {@link CalendarEventDateTime.date}. */
  dateTime?: null
  timeZone?: null
}

export interface CalendarEvent {
  id?: string
  summary: string
  description?: string
  location?: string
  start: CalendarEventDateTime | CalendarEventDate
  end: CalendarEventDateTime | CalendarEventDate
  attendees?: { email: string }[]
  /** Explicit reminder overrides. For all-day events Google counts back from midnight of the start date. */
  reminders?: {
    useDefault: boolean
    overrides?: { method: 'popup' | 'email'; minutes: number }[]
  }
}

export interface FreeBusySlot {
  start: string
  end: string
}

/**
 * Per-calendar free/busy result: either the calendar's busy blocks, or the error the provider returned for it.
 * Reasons are normalised to Google's words (`notFound` = never shared, `forbidden` = access revoked) so
 * `lib/sub-availability.ts` maps them to `not_shared` for either provider. Callers MUST branch on `'error' in result`
 * — an errored calendar has no `busy` array and must never be read as "free".
 */
export type FreeBusyCalendarResult = { busy: FreeBusySlot[] } | { error: string }

/** One event as returned by `listEventsInRange` — only the fields RSVP reading needs. */
export interface CalendarEventListItem {
  id: string
  /** `responseStatus` uses Google's words: accepted | declined | tentative | needsAction. */
  attendees?: { email: string; responseStatus?: string }[]
}

export type SendUpdates = 'all' | 'externalOnly' | 'none'

/** Carries the provider's HTTP status so callers can react (a 404/410 on update = the event is gone). */
export class CalendarApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'CalendarApiError'
  }
}

/** True when the provider says the event no longer exists, so a stored id is stale. Works for either provider. */
export function isMissingEventError(error: unknown): boolean {
  return error instanceof CalendarApiError && (error.status === 404 || error.status === 410)
}

/** Google event ids are base32hex: lowercase a-v and 0-9, 5-1024 chars. Graph ids are long base64 (`AAMk...`, with - _ =). */
const GOOGLE_ID_FORMAT = /^[a-v0-9]{5,1024}$/
const GRAPH_ID_FORMAT = /^[A-Za-z0-9_\-=]{20,}$/

/** True when `eventId` can only have been minted by the OTHER provider (decided locally, from the id's shape). */
export function eventIdBelongsToOtherProvider(eventId: string, provider: CalendarProviderId): boolean {
  if (provider === 'google') return !GOOGLE_ID_FORMAT.test(eventId)
  // Outlook: a Google-shaped id (short, lowercase base32hex) is foreign. Graph ids are far longer and mixed-case.
  return GOOGLE_ID_FORMAT.test(eventId) && !(GRAPH_ID_FORMAT.test(eventId) && eventId.length >= 64)
}

/**
 * A stored id is stale when the provider says it is gone (404/410), or when it is an id of the OTHER provider (the user
 * switched Google <-> Outlook; it comes back "invalid", HTTP 400). Any other 400 on a correctly-shaped id is a real
 * failure: never recreate or clear ids on it. Only call sites that act on a STORED id use this. Never use it for a create.
 */
export function isStaleEventIdError(error: unknown, eventId: string, provider: CalendarProviderId): boolean {
  if (isMissingEventError(error)) return true
  return error instanceof CalendarApiError && error.status === 400 && eventIdBelongsToOtherProvider(eventId, provider)
}

/**
 * Returned instead of writing when the write could not be done without emailing guests the caller said must not be
 * told (`sendUpdates: 'none'`). Outlook cannot suppress guest mail; Google can, so Google never returns this.
 */
export type CalendarWriteSkipped = { skipped: 'guests_would_be_notified' }
export type CalendarUpdateResult = CalendarEvent & Partial<CalendarWriteSkipped>

/** A calendar bound to one user's valid access token. Event/calendar ids are the provider's own. */
export interface CalendarClient {
  readonly provider: CalendarProviderId
  readonly accessToken: string
  /** Busy blocks across the token owner's own calendars. */
  getFreeBusy(timeMin: Date, timeMax: Date): Promise<FreeBusySlot[]>
  /** Busy blocks of other people's calendars shared with the token owner. One result per id; never throws per id. */
  getFreeBusyForCalendars(timeMin: Date, timeMax: Date, calendarIds: string[]): Promise<Record<string, FreeBusyCalendarResult>>
  isSlotAvailable(start: Date, end: Date, bufferMinutes?: number): Promise<boolean>
  getAvailableSlots(
    date: Date,
    durationMinutes?: number,
    bufferMinutes?: number,
    workingHoursStart?: number,
    workingHoursEnd?: number
  ): Promise<Date[]>
  createEvent(event: CalendarEvent, calendarId?: string, sendUpdates?: SendUpdates): Promise<CalendarEvent>
  /**
   * `sendUpdates` omitted = no preference (Google: its own default, none; Outlook: guests in the patch are applied and
   * Graph mails them). Explicit 'none' on Outlook with guests on the event = nothing is written (see CalendarWriteSkipped).
   */
  updateEvent(eventId: string, event: Partial<CalendarEvent>, calendarId?: string, sendUpdates?: SendUpdates): Promise<CalendarUpdateResult>
  deleteEvent(eventId: string, calendarId?: string, sendUpdates?: SendUpdates): Promise<void | CalendarWriteSkipped>
  listEventsInRange(calendarId: string, timeMinIso: string, timeMaxIso: string): Promise<CalendarEventListItem[]>
}

/** The working-hours window of `date` (server-local hours, exactly as Google's loop always computed it). */
export function workingWindow(date: Date, workingHoursStart: number = 8, workingHoursEnd: number = 20): { dayStart: Date; dayEnd: Date } {
  const dayStart = new Date(date)
  dayStart.setHours(workingHoursStart, 0, 0, 0)
  const dayEnd = new Date(date)
  dayEnd.setHours(workingHoursEnd, 0, 0, 0)
  return { dayStart, dayEnd }
}

/**
 * Open slots every 30 minutes inside the window that don't touch a busy block (plus buffer). Pure; the one
 * slot-picking rule for both providers (Google's own loop, moved here unchanged).
 */
export function pickOpenSlots(
  busySlots: FreeBusySlot[],
  dayStart: Date,
  dayEnd: Date,
  durationMinutes: number = 60,
  bufferMinutes: number = 60
): Date[] {
  const slots: Date[] = []
  const slotInterval = 30 * 60 * 1000
  let currentSlot = new Date(dayStart)
  while (currentSlot.getTime() + durationMinutes * 60 * 1000 <= dayEnd.getTime()) {
    const slotEnd = new Date(currentSlot.getTime() + durationMinutes * 60 * 1000)
    const bufferedStart = new Date(currentSlot.getTime() - bufferMinutes * 60 * 1000)
    const bufferedEnd = new Date(slotEnd.getTime() + bufferMinutes * 60 * 1000)
    const hasConflict = busySlots.some((busy) => {
      const busyStart = new Date(busy.start)
      const busyEnd = new Date(busy.end)
      return bufferedStart < busyEnd && bufferedEnd > busyStart
    })
    if (!hasConflict) slots.push(new Date(currentSlot))
    currentSlot = new Date(currentSlot.getTime() + slotInterval)
  }
  return slots
}

/** Whether `[start,end]` plus buffer touches nothing busy — Google's `isSlotAvailable` rule, shared. */
export function isWindowFree(busySlots: FreeBusySlot[]): boolean {
  return busySlots.length === 0
}
