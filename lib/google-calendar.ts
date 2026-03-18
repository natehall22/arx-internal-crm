// Google Calendar Integration
// Requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI in env

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

export interface CalendarEvent {
  id?: string
  summary: string
  description?: string
  location?: string
  start: {
    dateTime: string
    timeZone?: string
  }
  end: {
    dateTime: string
    timeZone?: string
  }
  attendees?: { email: string }[]
}

export interface FreeBusySlot {
  start: string
  end: string
}

/**
 * Generate Google OAuth URL for user authorization
 */
export function getGoogleAuthUrl(state?: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`

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
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`

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
  return busySlots.length === 0
}

/**
 * Create a calendar event
 */
export async function createCalendarEvent(
  accessToken: string,
  event: CalendarEvent,
  calendarId: string = 'primary',
  sendUpdates: 'all' | 'externalOnly' | 'none' = 'none'
): Promise<CalendarEvent> {
  const eventUrl = new URL(`${GOOGLE_CALENDAR_API}/calendars/${calendarId}/events`)
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
    const error = await response.text()
    throw new Error(`Failed to create event: ${error}`)
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
  calendarId: string = 'primary'
): Promise<CalendarEvent> {
  const response = await fetch(`${GOOGLE_CALENDAR_API}/calendars/${calendarId}/events/${eventId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  })

  if (!response.ok) {
    throw new Error('Failed to update event')
  }

  return response.json()
}

/**
 * Delete a calendar event
 */
export async function deleteCalendarEvent(
  accessToken: string,
  eventId: string,
  calendarId: string = 'primary'
): Promise<void> {
  const response = await fetch(`${GOOGLE_CALENDAR_API}/calendars/${calendarId}/events/${eventId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  })

  if (!response.ok && response.status !== 404) {
    throw new Error('Failed to delete event')
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
  // Get start and end of the day
  const dayStart = new Date(date)
  dayStart.setHours(workingHoursStart, 0, 0, 0)
  
  const dayEnd = new Date(date)
  dayEnd.setHours(workingHoursEnd, 0, 0, 0)

  // Get busy slots for the day
  const busySlots = await getFreeBusy(accessToken, dayStart, dayEnd)

  // Generate potential slots (every 30 minutes)
  const slots: Date[] = []
  const slotInterval = 30 * 60 * 1000 // 30 minutes
  
  let currentSlot = new Date(dayStart)
  
  while (currentSlot.getTime() + durationMinutes * 60 * 1000 <= dayEnd.getTime()) {
    const slotEnd = new Date(currentSlot.getTime() + durationMinutes * 60 * 1000)
    
    // Check if slot conflicts with any busy period (including buffer)
    const bufferedStart = new Date(currentSlot.getTime() - bufferMinutes * 60 * 1000)
    const bufferedEnd = new Date(slotEnd.getTime() + bufferMinutes * 60 * 1000)
    
    const hasConflict = busySlots.some(busy => {
      const busyStart = new Date(busy.start)
      const busyEnd = new Date(busy.end)
      return bufferedStart < busyEnd && bufferedEnd > busyStart
    })
    
    if (!hasConflict) {
      slots.push(new Date(currentSlot))
    }
    
    currentSlot = new Date(currentSlot.getTime() + slotInterval)
  }

  return slots
}
