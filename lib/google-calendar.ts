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
    throw new Error('Failed to refresh token')
  }

  const data = await response.json()
  
  return {
    access_token: data.access_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000),
  }
}

/**
 * Get free/busy information for a user's calendar
 */
export async function getFreeBusy(
  accessToken: string,
  timeMin: Date,
  timeMax: Date,
  calendarId: string = 'primary'
): Promise<FreeBusySlot[]> {
  console.log(`getFreeBusy: Checking ${calendarId} from ${timeMin.toISOString()} to ${timeMax.toISOString()}`)
  
  const response = await fetch(`${GOOGLE_CALENDAR_API}/freeBusy`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: calendarId }],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`getFreeBusy: API error ${response.status}:`, errorText)
    throw new Error(`Failed to get free/busy info: ${response.status}`)
  }

  const data = await response.json()
  console.log(`getFreeBusy: Full response:`, JSON.stringify(data))
  
  const busySlots = data.calendars?.[calendarId]?.busy || []
  console.log(`getFreeBusy: Found ${busySlots.length} busy slots`)
  
  return busySlots
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
  calendarId: string = 'primary'
): Promise<CalendarEvent> {
  const response = await fetch(`${GOOGLE_CALENDAR_API}/calendars/${calendarId}/events`, {
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
  workingHoursEnd: number = 18 // 6 PM
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
