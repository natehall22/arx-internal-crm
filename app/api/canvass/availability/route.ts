import { requireAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getFreeBusy, refreshAccessToken } from '@/lib/google-calendar'

export const dynamic = 'force-dynamic'

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Helper to get valid access token (refresh if needed)
async function getValidAccessToken(adminClient: any, userId: string): Promise<string | null> {
  console.log(`getValidAccessToken: Looking up token for user ${userId}`)
  
  const { data: tokenData, error: tokenError } = await adminClient
    .from('user_google_tokens')
    .select('*')
    .eq('user_id', userId)
    .single()

  console.log(`getValidAccessToken: Query result - found: ${!!tokenData}, error: ${tokenError?.message || 'none'}`)

  if (!tokenData) {
    console.log(`getValidAccessToken: No token found for user ${userId}`)
    return null
  }

  const expiresAt = new Date(tokenData.expires_at)
  const now = new Date()

  // If token expires in less than 5 minutes, refresh it
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
    } catch (error) {
      console.error('Failed to refresh token:', error)
      return null
    }
  }

  return tokenData.access_token
}

// Helper to get timezone for a user based on their team
async function getTimezoneForUser(adminClient: any, userId: string): Promise<string> {
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
      
      if (team?.timezone) {
        return team.timezone
      }
    }
  } catch (e) {
    console.log('Could not fetch team timezone, using default')
  }
  
  return 'America/New_York'
}

export async function GET(request: NextRequest) {
  try {
    await requireAuth()
    const adminClient = getAdminClient()

    const closerId = request.nextUrl.searchParams.get('closer_id')
    const dateStr = request.nextUrl.searchParams.get('date')
    const durationStr = request.nextUrl.searchParams.get('duration')

    console.log(`Availability API called with: closer_id=${closerId}, date=${dateStr}, duration=${durationStr}`)

    if (!closerId || !dateStr) {
      console.error(`Availability: Missing required params - closer_id: ${closerId}, date: ${dateStr}`)
      return NextResponse.json({ error: 'closer_id and date are required', slots: [], hasCalendar: false }, { status: 400 })
    }
    
    // Validate closer_id is a valid UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(closerId)) {
      console.error(`Availability: Invalid closer_id format: ${closerId}`)
      return NextResponse.json({ error: 'Invalid closer_id format', slots: [], hasCalendar: false }, { status: 400 })
    }

    const durationMinutes = parseInt(durationStr || '60', 10)

    // Get closer's timezone
    const timezone = await getTimezoneForUser(adminClient, closerId)

    // Get closer's working hours from settings
    const { data: settings } = await adminClient
      .from('user_settings')
      .select('working_hours_start, working_hours_end, appointment_buffer_minutes')
      .eq('user_id', closerId)
      .single()

    // Default working hours: 8 AM - 6 PM
    let workingHoursStart = settings?.working_hours_start || '08:00'
    let workingHoursEnd = settings?.working_hours_end || '18:00'
    const bufferMinutes = settings?.appointment_buffer_minutes || 30

    console.log(`Availability: Raw settings:`, settings)
    console.log(`Availability: Working hours from DB: start=${workingHoursStart} (type: ${typeof workingHoursStart}), end=${workingHoursEnd} (type: ${typeof workingHoursEnd})`)

    // Normalize working hours to HH:MM format
    // Handle various formats: "08:00", "8:00", "08:00:00", etc.
    const normalizeTime = (time: string): string => {
      if (!time || typeof time !== 'string') return '08:00'
      // Remove seconds if present
      const parts = time.split(':')
      if (parts.length >= 2) {
        const hour = parts[0].padStart(2, '0')
        const min = parts[1].padStart(2, '0')
        return `${hour}:${min}`
      }
      return '08:00'
    }
    
    workingHoursStart = normalizeTime(workingHoursStart)
    workingHoursEnd = normalizeTime(workingHoursEnd)

    // Parse the date - we'll work in the closer's timezone
    console.log(`Availability: Parsing date ${dateStr} with normalized working hours ${workingHoursStart} - ${workingHoursEnd}`)
    
    // Validate date format (YYYY-MM-DD)
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      console.error(`Availability: Invalid date format: ${dateStr}`)
      return NextResponse.json({ error: 'Invalid date format', slots: [], hasCalendar: false }, { status: 400 })
    }
    
    // Parse date parts manually to avoid timezone issues
    const [year, month, day] = dateStr.split('-').map(Number)
    const [startHour, startMin] = workingHoursStart.split(':').map(Number)
    const [endHour, endMin] = workingHoursEnd.split(':').map(Number)
    
    // Create dates using local time components (for display/slot generation)
    const dayStart = new Date(year, month - 1, day, startHour, startMin, 0)
    const dayEnd = new Date(year, month - 1, day, endHour, endMin, 0)
    
    // For Google Calendar API, we need to convert to UTC
    // The timezone variable tells us what timezone the closer is in
    // For now, assume Eastern Time (-5 hours from UTC, or -4 during DST)
    // TODO: Use proper timezone library for accurate conversion based on 'timezone' variable
    const tzOffsetHours = -5 // Eastern Standard Time
    
    // Create UTC times for Google Calendar API query
    const dayStartUTC = new Date(Date.UTC(year, month - 1, day, startHour - tzOffsetHours, startMin, 0))
    const dayEndUTC = new Date(Date.UTC(year, month - 1, day, endHour - tzOffsetHours, endMin, 0))
    
    console.log(`Availability: Parsed - year=${year}, month=${month}, day=${day}, startHour=${startHour}, endHour=${endHour}`)
    console.log(`Availability: Day start (local): ${dayStart.toISOString()}, Day end (local): ${dayEnd.toISOString()}`)
    console.log(`Availability: Day start (UTC for API): ${dayStartUTC.toISOString()}, Day end (UTC for API): ${dayEndUTC.toISOString()}`)
    
    // Validate dates are valid
    if (isNaN(dayStart.getTime()) || isNaN(dayEnd.getTime())) {
      console.error(`Availability: Invalid date objects - dayStart: ${dayStart}, dayEnd: ${dayEnd}`)
      return NextResponse.json({ error: 'Failed to parse date', slots: [], hasCalendar: false }, { status: 400 })
    }

    // Get access token for closer
    console.log(`Availability check for closer ${closerId} on ${dateStr}`)
    const accessToken = await getValidAccessToken(adminClient, closerId)
    
    let busySlots: { start: string; end: string }[] = []
    let hasCalendar = false

    if (accessToken) {
      hasCalendar = true
      console.log(`Availability: Found calendar token for ${closerId}`)
      try {
        // Use UTC times for Google Calendar API
        busySlots = await getFreeBusy(accessToken, dayStartUTC, dayEndUTC)
        console.log(`Availability: ${closerId} has ${busySlots.length} busy slots:`, JSON.stringify(busySlots))
      } catch (error: any) {
        console.error('Failed to get free/busy:', error?.message || error)
      }
    } else {
      console.log(`Availability: No calendar token found for ${closerId}`)
    }

    // Generate 15-minute time slots
    const slots: { time: string; available: boolean; display: string }[] = []
    const slotInterval = 15 * 60 * 1000 // 15 minutes
    
    let currentSlot = new Date(dayStart)
    const now = new Date()
    
    console.log(`Availability: Generating slots from ${dayStart.toISOString()} to ${dayEnd.toISOString()}`)
    console.log(`Availability: Current time (now): ${now.toISOString()}`)
    console.log(`Availability: Duration: ${durationMinutes} minutes`)
    
    let skippedPast = 0
    let totalSlots = 0
    
    while (currentSlot.getTime() + durationMinutes * 60 * 1000 <= dayEnd.getTime()) {
      const slotEnd = new Date(currentSlot.getTime() + durationMinutes * 60 * 1000)
      totalSlots++
      
      // Skip slots in the past
      if (currentSlot <= now) {
        skippedPast++
        currentSlot = new Date(currentSlot.getTime() + slotInterval)
        continue
      }
      
      // Check if slot conflicts with any busy period (including buffer)
      const bufferedStart = new Date(currentSlot.getTime() - bufferMinutes * 60 * 1000)
      const bufferedEnd = new Date(slotEnd.getTime() + bufferMinutes * 60 * 1000)
      
      const hasConflict = busySlots.some(busy => {
        const busyStart = new Date(busy.start)
        const busyEnd = new Date(busy.end)
        return bufferedStart < busyEnd && bufferedEnd > busyStart
      })
      
      // Format time for display (e.g., "9:00 AM")
      const hours = currentSlot.getHours()
      const minutes = currentSlot.getMinutes()
      const ampm = hours >= 12 ? 'PM' : 'AM'
      const displayHours = hours % 12 || 12
      const displayMinutes = minutes.toString().padStart(2, '0')
      const display = `${displayHours}:${displayMinutes} ${ampm}`
      
      // Format as local time string (YYYY-MM-DDTHH:MM) - NOT UTC
      // This preserves the intended local time in the closer's timezone
      const year = currentSlot.getFullYear()
      const month = String(currentSlot.getMonth() + 1).padStart(2, '0')
      const day = String(currentSlot.getDate()).padStart(2, '0')
      const hourStr = String(hours).padStart(2, '0')
      const minStr = String(minutes).padStart(2, '0')
      const timeValue = `${year}-${month}-${day}T${hourStr}:${minStr}`
      
      slots.push({
        time: timeValue,
        available: !hasConflict,
        display,
      })
      
      currentSlot = new Date(currentSlot.getTime() + slotInterval)
    }

    // Count how many slots have conflicts
    const unavailableCount = slots.filter(s => !s.available).length
    
    console.log(`Availability: Generated ${slots.length} slots (${unavailableCount} unavailable, ${slots.length - unavailableCount} available), skipped ${skippedPast} past. hasCalendar=${hasCalendar}, busySlots=${busySlots.length}, closerId=${closerId}`)
    console.log(`Availability: Busy slots from Google:`, JSON.stringify(busySlots))
    console.log(`Availability: Day range: ${dayStart.toISOString()} to ${dayEnd.toISOString()}`)

    return NextResponse.json({
      slots,
      hasCalendar,
      timezone,
      workingHours: {
        start: workingHoursStart,
        end: workingHoursEnd,
      },
      debug: {
        busySlotsCount: busySlots.length,
        busySlots: busySlots,
        dayStart: dayStart.toISOString(),
        dayEnd: dayEnd.toISOString(),
      }
    })

  } catch (error) {
    console.error('Availability check error:', error)
    return NextResponse.json({ error: 'Failed to check availability' }, { status: 500 })
  }
}
