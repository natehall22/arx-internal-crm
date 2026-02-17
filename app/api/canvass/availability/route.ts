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
    const workingHoursStart = settings?.working_hours_start || '08:00'
    const workingHoursEnd = settings?.working_hours_end || '18:00'
    const bufferMinutes = settings?.appointment_buffer_minutes || 30

    // Parse the date - we'll work in the closer's timezone
    console.log(`Availability: Parsing date ${dateStr} with working hours ${workingHoursStart} - ${workingHoursEnd}`)
    
    // Validate date format (YYYY-MM-DD)
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      console.error(`Availability: Invalid date format: ${dateStr}`)
      return NextResponse.json({ error: 'Invalid date format', slots: [], hasCalendar: false }, { status: 400 })
    }
    
    // Create ISO strings with the timezone offset for the closer's timezone
    // Format: YYYY-MM-DDTHH:MM:SS (local time in closer's timezone)
    const dayStartStr = `${dateStr}T${workingHoursStart}:00`
    const dayEndStr = `${dateStr}T${workingHoursEnd}:00`
    
    console.log(`Availability: Day start string: ${dayStartStr}, Day end string: ${dayEndStr}`)
    
    // For Google Calendar API, we need to convert to actual Date objects
    const dayStart = new Date(dayStartStr)
    const dayEnd = new Date(dayEndStr)
    
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
        busySlots = await getFreeBusy(accessToken, dayStart, dayEnd)
        console.log(`Availability: ${closerId} has ${busySlots.length} busy slots`)
      } catch (error) {
        console.error('Failed to get free/busy:', error)
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

    console.log(`Availability: Generated ${slots.length} available slots, skipped ${skippedPast} past slots out of ${totalSlots} total`)

    return NextResponse.json({
      slots,
      hasCalendar,
      timezone,
      workingHours: {
        start: workingHoursStart,
        end: workingHoursEnd,
      },
    })

  } catch (error) {
    console.error('Availability check error:', error)
    return NextResponse.json({ error: 'Failed to check availability' }, { status: 500 })
  }
}
