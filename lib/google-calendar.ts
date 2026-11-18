// Google Calendar Integration
// Requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI in env
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAppUrl } from '@/lib/app-url'
import { microsoftConfigured } from '@/lib/calendar/microsoft-calendar'
import { calendarSwitchBlockReason } from '@/lib/calendar/switch-guard'
import {
  CalendarApiError,
  isWindowFree,
  pickOpenSlots,
  workingWindow,
  type CalendarEvent,
  type CalendarEventListItem,
  type FreeBusyCalendarResult,
  type FreeBusySlot,
} from '@/lib/calendar/provider'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ')

export interface GoogleTokens {
  access_token: string
  refresh_token: string
  expires_at: Date
  token_type: string
  scope: string
}

// The event/free-busy shapes live in the provider contract; re-exported so every existing import keeps working.
export type { CalendarEventDateTime, CalendarEventDate, CalendarEvent, FreeBusySlot, FreeBusyCalendarResult, CalendarEventListItem } from '@/lib/calendar/provider'

/**
 * Carries Google's HTTP status so callers can react to it rather than
 * string-matching a message — notably a 404/410 on update, which means the
 * event is gone and the caller should create a fresh one instead of retrying
 * a dead id forever.
 */
export class GoogleCalendarError extends CalendarApiError {
  constructor(message: string, status: number) {
    super(message, status)
    this.name = 'GoogleCalendarError'
  }
}

/** True when Google says the event no longer exists, so a stored id is stale. */
export { isMissingEventError } from '@/lib/calendar/provider'

/** The OAuth callback Google redirects to. Must be listed exactly in the Google OAuth client (see docs/domain-cutover.md). */
function googleRedirectUri(): string {
  return process.env.GOOGLE_REDIRECT_URI || `${getAppUrl()}/api/auth/google/callback`
}

/**
 * Generate Google OAuth URL for user authorization
 */
export function getGoogleAuthUrl(state?: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const redirectUri = googleRedirectUri()

  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID not configured')
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    ...(state && { state }),
  })

  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = googleRedirectUri()

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials not configured')
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to exchange code: ${error}`)
  }

  const data = await response.json()
  
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000),
    token_type: data.token_type,
    scope: data.scope,
  }
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_at: Date }> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials not configured')
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Google token refresh failed (${response.status}):`, errorText)
    throw new Error(`Failed to refresh token: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  
  return {
    access_token: data.access_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000),
  }
}

/**
 * Get list of user's calendars (filtered to only include calendars that support freeBusy)
 */
export async function getCalendarList(accessToken: string): Promise<{ id: string; summary: string; primary?: boolean; accessRole?: string }[]> {
  const response = await fetch(`${GOOGLE_CALENDAR_API}/users/me/calendarList`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    console.error(`getCalendarList: API error ${response.status}`)
    return [{ id: 'primary', summary: 'Primary' }]
  }

  const data = await response.json()
  const allCalendars = data.items || [{ id: 'primary', summary: 'Primary' }]
  
  // Filter out calendars that don't support freeBusy queries:
  // - Holiday calendars (contain #holiday@group.v.calendar.google.com)
  // - Contacts birthdays (contain #contacts@group.v.calendar.google.com)
  // - Other Google-provided calendars that are read-only
  const filteredCalendars = allCalendars.filter((cal: any) => {
    const id = cal.id || ''
    
    // Skip holiday calendars
    if (id.includes('#holiday@group.v.calendar.google.com')) {
      return false
    }
    
    // Skip birthday calendars
    if (id.includes('#contacts@group.v.calendar.google.com')) {
      return false
    }
    
    // Skip "Holidays in" calendars by name as fallback
    if (cal.summary?.toLowerCase().includes('holidays in')) {
      return false
    }
    
    // Skip week numbers calendar
    if (id.includes('#weeknum@group.v.calendar.google.com')) {
      return false
    }
    
    return true
  })
  
  console.log(`getCalendarList: Filtered ${allCalendars.length} calendars down to ${filteredCalendars.length}`)
  
  return filteredCalendars.length > 0 ? filteredCalendars : [{ id: 'primary', summary: 'Primary' }]
}

/**
 * Get free/busy information for ALL of a user's calendars
 */
export async function getFreeBusy(
  accessToken: string,
  timeMin: Date,
  timeMax: Date,
  calendarId: string = 'primary'
): Promise<FreeBusySlot[]> {
  console.log(`getFreeBusy: Checking from ${timeMin.toISOString()} to ${timeMax.toISOString()}`)
  
  // First, get list of all user's calendars
  const calendars = await getCalendarList(accessToken)
  console.log(`getFreeBusy: User has ${calendars.length} calendars:`, calendars.map(c => c.summary).join(', '))
  
  // Query free/busy for ALL calendars
  const calendarItems = calendars.map(c => ({ id: c.id }))
  
  const response = await fetch(`${GOOGLE_CALENDAR_API}/freeBusy`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: calendarItems,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`getFreeBusy: API error ${response.status}:`, errorText)
    throw new Error(`Failed to get free/busy info: ${response.status}`)
  }

  const data = await response.json()
  
  // Collect busy slots from ALL calendars
  const allBusySlots: FreeBusySlot[] = []
  
  for (const calendar of calendars) {
    const calendarData = data.calendars?.[calendar.id]
    const busySlots = calendarData?.busy || []
    const errors = calendarData?.errors
    
    if (errors && errors.length > 0) {
      console.error(`getFreeBusy: Errors for ${calendar.summary}:`, JSON.stringify(errors))
    }
    
    if (busySlots.length > 0) {
      console.log(`getFreeBusy: ${calendar.summary} has ${busySlots.length} busy slots`)
      allBusySlots.push(...busySlots)
    }
  }
  
  console.log(`getFreeBusy: Total ${allBusySlots.length} busy slots across all calendars`)
  if (allBusySlots.length > 0) {
    console.log(`getFreeBusy: Busy times:`, allBusySlots.map((s: FreeBusySlot) => `${s.start} - ${s.end}`).join(', '))
  }
  
  return allBusySlots
}


/**
 * Free/busy for a specific, caller-supplied list of calendars — unlike
 * {@link getFreeBusy}, which ignores its `calendarId` argument and always
 * queries every calendar the token owner personally owns. This is for reading
 * OTHER people's calendars that were explicitly shared with the token owner
 * (sub-contractor free/busy shares), where querying "all of my calendars"
 * would be wrong.
 *
 * Returns one result per requested calendar id — never throws per-calendar;
 * a `notFound`/`forbidden` from Google surfaces as `{ error }` on that one
 * entry rather than failing the whole batch, so one broken share doesn't hide
 * every other sub's availability.
 */
export async function getFreeBusyForCalendars(
  accessToken: string,
  timeMin: Date,
  timeMax: Date,
  calendarIds: string[]
): Promise<Record<string, FreeBusyCalendarResult>> {
  const uniqueIds = Array.from(new Set(calendarIds.map((id) => id.trim()).filter(Boolean)))
  if (uniqueIds.length === 0) return {}

  const response = await fetch(`${GOOGLE_CALENDAR_API}/freeBusy`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: uniqueIds.map((id) => ({ id })),
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    console.error(`getFreeBusyForCalendars: API error ${response.status}:`, errorText)
    throw new Error(`Failed to get free/busy info: ${response.status}`)
  }

  const data = await response.json()
  const result: Record<string, FreeBusyCalendarResult> = {}

  for (const id of uniqueIds) {
    const calendarData = data.calendars?.[id]
    const errors = calendarData?.errors as { domain?: string; reason?: string }[] | undefined

    if (errors && errors.length > 0) {
      // Prefer `reason` (e.g. "notFound", "forbidden") — that's what
      // `lib/sub-availability.ts` pattern-matches to tell "never shared" apart
      // from "share was revoked" apart from a generic error.
      result[id] = { error: errors[0]?.reason || errors[0]?.domain || 'unknown_error' }
      continue
    }

    if (!calendarData) {
      // Google omitted this calendar from the response entirely (has happened
      // for malformed ids). Treat as an error, not as "zero busy slots" — we
      // genuinely don't know, and reporting free would be worse than reporting
      // unknown.
      result[id] = { error: 'no_response' }
      continue
    }

    result[id] = { busy: (calendarData.busy || []) as FreeBusySlot[] }
  }

  return result
}


/**
 * List events on `calendarId` overlapping `[timeMinIso, timeMaxIso)`, paging
 * through `nextPageToken` until exhausted. Used to read RSVP status off OUR
 * OWN install events in one call per window instead of one `events.get` per
 * job — see `resolveInstallCalendarId()` in `lib/install-calendar.ts` for
 * which calendar that is. Requires no permission beyond the token owner's own
 * calendar access, since these are events ARX created.
 */
export async function listCalendarEventsInRange(
  accessToken: string,
  calendarId: string,
  timeMinIso: string,
  timeMaxIso: string
): Promise<CalendarEventListItem[]> {
  const items: CalendarEventListItem[] = []
  let pageToken: string | undefined

  do {
    const url = new URL(calendarEventsBase(calendarId))
    url.searchParams.set('timeMin', timeMinIso)
    url.searchParams.set('timeMax', timeMaxIso)
    url.searchParams.set('singleEvents', 'true')
    url.searchParams.set('maxResults', '2500')
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const response = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      console.error('listCalendarEventsInRange: API error', response.status, detail.slice(0, 500))
      throw new GoogleCalendarError(`Failed to list events (${response.status})`, response.status)
    }

    const data = await response.json()
    for (const item of data.items || []) {
      if (item?.id) items.push({ id: item.id, attendees: item.attendees })
    }
    pageToken = data.nextPageToken || undefined
  } while (pageToken)

  return items
}

/**
 * Check if a time slot is available
 */
export async function isSlotAvailable(
  accessToken: string,
  startTime: Date,
  endTime: Date,
  bufferMinutes: number = 0
): Promise<boolean> {
  // Add buffer time
  const bufferedStart = new Date(startTime.getTime() - bufferMinutes * 60 * 1000)
  const bufferedEnd = new Date(endTime.getTime() + bufferMinutes * 60 * 1000)

  const busySlots = await getFreeBusy(accessToken, bufferedStart, bufferedEnd)
  
  // If no busy slots in range, the time is available
  return isWindowFree(busySlots)
}

/**
 * Create a calendar event
 */
function calendarEventsBase(calendarId: string) {
  return `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`
}

export async function createCalendarEvent(
  accessToken: string,
  event: CalendarEvent,
  calendarId: string = 'primary',
  sendUpdates: 'all' | 'externalOnly' | 'none' = 'none'
): Promise<CalendarEvent> {
  const eventUrl = new URL(`${calendarEventsBase(calendarId)}`)
  if (sendUpdates !== 'none') {
    eventUrl.searchParams.set('sendUpdates', sendUpdates)
  }

  const response = await fetch(eventUrl.toString(), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error('Google Calendar create failed', {
      status: response.status,
      detail: detail.slice(0, 500),
    })
    throw new Error(`Google Calendar create failed (${response.status})`)
  }

  return response.json()
}

/**
 * Update a calendar event
 */
export async function updateCalendarEvent(
  accessToken: string,
  eventId: string,
  event: Partial<CalendarEvent>,
  calendarId: string = 'primary',
  /**
   * Google's `events.patch` defaults this to `none` — an updated event notifies
   * NOBODY unless asked. Callers whose attendees must hear about a change (a
   * moved install, a reassigned crew) have to pass 'all' explicitly. Default
   * stays 'none' so existing callers keep their current behavior.
   */
  sendUpdates: 'all' | 'externalOnly' | 'none' = 'none'
): Promise<CalendarEvent> {
  const eventUrl = new URL(`${calendarEventsBase(calendarId)}/${encodeURIComponent(eventId)}`)
  if (sendUpdates !== 'none') {
    eventUrl.searchParams.set('sendUpdates', sendUpdates)
  }

  const response = await fetch(eventUrl.toString(), {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error('Google Calendar update failed', {
      status: response.status,
      detail: detail.slice(0, 500),
    })
    throw new GoogleCalendarError(`Google Calendar update failed (${response.status})`, response.status)
  }

  return response.json()
}

/**
 * Delete a calendar event
 */
export async function deleteCalendarEvent(
  accessToken: string,
  eventId: string,
  calendarId: string = 'primary',
  /**
   * As with patch, Google's `events.delete` defaults to `none` — cancelling an
   * event tells the attendees nothing. Pass 'all' when someone is relying on
   * that event (a sub who would otherwise drive to a cancelled job). Default
   * stays 'none' to preserve existing callers.
   */
  sendUpdates: 'all' | 'externalOnly' | 'none' = 'none'
): Promise<void> {
  const eventUrl = new URL(`${calendarEventsBase(calendarId)}/${encodeURIComponent(eventId)}`)
  if (sendUpdates !== 'none') {
    eventUrl.searchParams.set('sendUpdates', sendUpdates)
  }

  const response = await fetch(eventUrl.toString(), {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  })

  if (!response.ok && response.status !== 404) {
    const detail = await response.text().catch(() => '')
    throw new GoogleCalendarError(`Failed to delete event: ${response.status} ${detail}`, response.status)
  }
}

/**
 * Get available time slots for a closer
 */
export async function getAvailableSlots(
  accessToken: string,
  date: Date,
  durationMinutes: number = 60,
  bufferMinutes: number = 60,
  workingHoursStart: number = 8, // 8 AM
  workingHoursEnd: number = 20 // 8 PM
): Promise<Date[]> {
  const { dayStart, dayEnd } = workingWindow(date, workingHoursStart, workingHoursEnd)

  // Get busy slots for the day
  const busySlots = await getFreeBusy(accessToken, dayStart, dayEnd)

  return pickOpenSlots(busySlots, dayStart, dayEnd, durationMinutes, bufferMinutes)
}

/**
 * Exchange a connect's one-time code and store the user's Google tokens — the ONE writer of a new connection, used by
 * the legacy callback and the company-address finish step. Returns false when storing failed.
 */
export async function saveGoogleConnection(admin: SupabaseClient, code: string, userId: string, orgId: string): Promise<boolean> {
  // Refuse before spending the one-time code when this would orphan the install schedule (lib/calendar/switch-guard.ts).
  if (await calendarSwitchBlockReason(admin, userId, orgId, 'google')) return false
  const tokens = await exchangeCodeForTokens(code)
  // org-scope-ok: upsert key user_id is the signed-in user (both callers: callback + finish) and orgId is that user's own profile org; a user belongs to one company, so the row cannot be re-homed
  const { error } = await admin.from('user_google_tokens').upsert(
    {
      user_id: userId,
      org_id: orgId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_at: tokens.expires_at.toISOString(),
      scope: tokens.scope,
    },
    { onConflict: 'user_id' }
  )
  if (error) {
    console.error('Failed to store Google tokens:', error)
    return false
  }
  // One calendar provider per user: connecting Google clears an Outlook connection.
  // Only when Outlook is on at all: with it off there is no such connection to clear (and no extra query).
  if (microsoftConfigured()) {
    // org-scope-ok: the signed-in user's own row
    const { error: clearError } = await admin.from('user_microsoft_tokens').delete().eq('user_id', userId)
    if (clearError) console.error('Failed to clear Outlook connection after Google connect:', clearError.message)
  }
  return true
}
