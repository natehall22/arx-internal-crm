import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { 
  createCalendarEvent, 
  refreshAccessToken,
  isSlotAvailable,
  getAvailableSlots,
  CalendarEvent 
} from '@/lib/google-calendar'

export const dynamic = 'force-dynamic'

function getSessionFromRequest(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
  const cookieName = `sb-${projectRef}-auth-token`
  
  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      return JSON.parse(singleCookie.value)
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
      return JSON.parse(chunks.join(''))
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

// Helper to get valid access token (refresh if needed)
async function getValidAccessToken(adminClient: any, userId: string): Promise<string | null> {
  const { data: tokenData } = await adminClient
    .from('user_google_tokens')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (!tokenData) return null

  const expiresAt = new Date(tokenData.expires_at)
  const now = new Date()

  // If token expires in less than 5 minutes, refresh it
  if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
    try {
      const refreshed = await refreshAccessToken(tokenData.refresh_token)
      
      // Update token in database
      await adminClient
        .from('user_google_tokens')
        .update({
          access_token: refreshed.access_token,
          expires_at: refreshed.expires_at.toISOString(),
        })
        .eq('user_id', userId)

      return refreshed.access_token
    } catch (error) {
      console.error('Failed to refresh token:', error)
      return null
    }
  }

  return tokenData.access_token
}

// POST - Create a calendar event for an appointment
export async function POST(request: NextRequest) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user } } = await authClient.auth.getUser(accessToken)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = getAdminClient()
    const body = await request.json()
    
    const { 
      closer_user_id,
      scheduled_for,
      duration_minutes = 60,
      homeowner_name,
      address_text,
      phone,
      notes,
      lead_id,
      opportunity_id,
      timezone: providedTimezone,
    } = body

    if (!closer_user_id || !scheduled_for) {
      return NextResponse.json({ error: 'closer_user_id and scheduled_for are required' }, { status: 400 })
    }

    // Get closer's Google token
    const googleAccessToken = await getValidAccessToken(adminClient, closer_user_id)
    
    if (!googleAccessToken) {
      // Closer doesn't have Google Calendar connected - that's okay, just skip sync
      return NextResponse.json({ 
        success: true, 
        calendar_synced: false,
        message: 'Closer does not have Google Calendar connected'
      })
    }

    // Get timezone from closer's team, or use provided timezone, or default to Eastern
    let timezone = providedTimezone || 'America/New_York'
    
    if (!providedTimezone) {
      // Try to get timezone from closer's team
      const { data: closerProfile } = await adminClient
        .from('users')
        .select('team_id')
        .eq('id', closer_user_id)
        .single()
      
      if (closerProfile?.team_id) {
        const { data: team } = await adminClient
          .from('teams')
          .select('timezone')
          .eq('id', closerProfile.team_id)
          .single()
        
        if (team?.timezone) {
          timezone = team.timezone
        }
      }
    }

    // Create calendar event
    // scheduled_for should be in format "YYYY-MM-DDTHH:MM" (local time in closer's timezone)
    // We need to send it to Google Calendar with the timezone, NOT as UTC
    const startDateTime = scheduled_for.includes(':') && scheduled_for.length === 16 
      ? `${scheduled_for}:00`  // Add seconds if not present
      : scheduled_for.includes('T') && scheduled_for.length > 16
        ? scheduled_for.slice(0, 19) // Trim to YYYY-MM-DDTHH:MM:SS
        : scheduled_for
    
    // Calculate end time by parsing the local time and adding duration
    const [datePart, timePart] = scheduled_for.split('T')
    const timeOnly = timePart?.split(':') || ['00', '00']
    let endHour = parseInt(timeOnly[0], 10)
    let endMin = parseInt(timeOnly[1], 10) + duration_minutes
    
    // Handle minute overflow
    while (endMin >= 60) {
      endMin -= 60
      endHour += 1
    }
    
    const endDateTime = `${datePart}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00`

    const event: CalendarEvent = {
      summary: `Inspection: ${homeowner_name || 'Customer'}`,
      description: [
        notes || '',
        phone ? `Phone: ${phone}` : '',
        lead_id ? `Lead ID: ${lead_id}` : '',
        opportunity_id ? `Opportunity ID: ${opportunity_id}` : '',
      ].filter(Boolean).join('\n'),
      location: address_text || undefined,
      start: {
        dateTime: startDateTime,
        timeZone: timezone,
      },
      end: {
        dateTime: endDateTime,
        timeZone: timezone,
      },
    }

    const createdEvent = await createCalendarEvent(googleAccessToken, event)

    return NextResponse.json({ 
      success: true, 
      calendar_synced: true,
      google_event_id: createdEvent.id,
    })
  } catch (error) {
    console.error('Calendar sync error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to sync calendar' 
    }, { status: 500 })
  }
}

// GET - Check availability or get available slots
export async function GET(request: NextRequest) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user } } = await authClient.auth.getUser(accessToken)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = getAdminClient()
    const searchParams = request.nextUrl.searchParams
    
    const closerUserId = searchParams.get('closer_user_id')
    const date = searchParams.get('date')
    const startTime = searchParams.get('start_time')
    const endTime = searchParams.get('end_time')
    const action = searchParams.get('action') || 'check' // 'check' or 'slots'

    if (!closerUserId) {
      return NextResponse.json({ error: 'closer_user_id is required' }, { status: 400 })
    }

    // Get closer's Google token
    const googleAccessToken = await getValidAccessToken(adminClient, closerUserId)
    
    if (!googleAccessToken) {
      // No Google Calendar - assume available
      return NextResponse.json({ 
        available: true,
        has_calendar: false,
        message: 'Closer does not have Google Calendar connected'
      })
    }

    // Get closer's settings for buffer time
    const { data: closerSettings } = await adminClient
      .from('user_settings')
      .select('appointment_buffer_minutes, working_hours_start, working_hours_end')
      .eq('user_id', closerUserId)
      .single()

    const bufferMinutes = closerSettings?.appointment_buffer_minutes || 30
    const workingStart = closerSettings?.working_hours_start ? parseInt(closerSettings.working_hours_start.split(':')[0]) : 8
    const workingEnd = closerSettings?.working_hours_end ? parseInt(closerSettings.working_hours_end.split(':')[0]) : 18

    if (action === 'slots' && date) {
      // Get available slots for a date
      const targetDate = new Date(date)
      const slots = await getAvailableSlots(
        googleAccessToken,
        targetDate,
        60, // duration
        bufferMinutes,
        workingStart,
        workingEnd
      )

      return NextResponse.json({
        has_calendar: true,
        date,
        available_slots: slots.map(s => s.toISOString()),
      })
    }

    if (action === 'check' && startTime && endTime) {
      // Check if specific slot is available
      const start = new Date(startTime)
      const end = new Date(endTime)
      
      const available = await isSlotAvailable(googleAccessToken, start, end, bufferMinutes)

      return NextResponse.json({
        has_calendar: true,
        available,
        start_time: startTime,
        end_time: endTime,
      })
    }

    return NextResponse.json({ error: 'Invalid request parameters' }, { status: 400 })
  } catch (error) {
    console.error('Calendar availability check error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to check availability' 
    }, { status: 500 })
  }
}
