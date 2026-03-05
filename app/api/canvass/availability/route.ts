import { requireAuthApi } from '@/lib/auth'
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

  // If token expires in less than 5 minutes, try to refresh it
  if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
    console.log(`Token for user ${userId} expires soon (${expiresAt.toISOString()}), attempting refresh...`)
    try {
      const refreshed = await refreshAccessToken(tokenData.refresh_token)
      
      await adminClient
        .from('user_google_tokens')
        .update({
          access_token: refreshed.access_token,
          expires_at: refreshed.expires_at.toISOString(),
        })
        .eq('user_id', userId)

      console.log(`Token refreshed successfully for user ${userId}`)
      return refreshed.access_token
    } catch (error) {
      console.error(`Failed to refresh token for user ${userId}:`, error)
      // If refresh fails but token hasn't actually expired yet, try using it anyway
      if (expiresAt > now) {
        console.log(`Token refresh failed but token not yet expired, trying existing token`)
        return tokenData.access_token
      }
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
    await requireAuthApi()
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
      .select('working_hours_start, working_hours_end, appointment_buffer_minutes, appointment_buffer_before, appointment_buffer_after')
      .eq('user_id', closerId)
      .single()

    // Also check if this closer is in any team queue (to get their buffer settings from there)
    const { data: queueEntry } = await adminClient
      .from('team_closer_queue')
      .select('buffer_before, buffer_after, buffer_minutes')
      .eq('user_id', closerId)
      .eq('active', true)
      .limit(1)
      .single()

    // Default working hours: 8 AM - 8 PM
    let workingHoursStart = settings?.working_hours_start || '08:00'
    let workingHoursEnd = settings?.working_hours_end || '20:00'
    
    // Use buffer settings from team queue if available, otherwise fall back to user_settings
    // Priority: team_closer_queue > user_settings > defaults
    const bufferBefore = queueEntry?.buffer_before ?? settings?.appointment_buffer_before ?? 0
    const bufferAfter = queueEntry?.buffer_after ?? settings?.appointment_buffer_after ?? settings?.appointment_buffer_minutes ?? 15
    
    console.log(`Availability: Buffer settings - before=${bufferBefore}, after=${bufferAfter} (from queue: ${!!queueEntry})`)

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
    console.log(`Availability: Parsing date ${dateStr} with normalized working hours ${workingHoursStart} - ${workingHoursEnd}, timezone: ${timezone}`)
    
    // Validate date format (YYYY-MM-DD)
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      console.error(`Availability: Invalid date format: ${dateStr}`)
      return NextResponse.json({ error: 'Invalid date format', slots: [], hasCalendar: false }, { status: 400 })
    }
    
    // Parse date parts manually to avoid timezone issues
    const [year, month, day] = dateStr.split('-').map(Number)
    const [startHour, startMin] = workingHoursStart.split(':').map(Number)
    const [endHour, endMin] = workingHoursEnd.split(':').map(Number)
    
    // Determine timezone offset based on the TARGET date (not current date)
    // DST in US starts second Sunday of March, ends first Sunday of November
    const isDST = (month > 3 && month < 11) || 
                  (month === 3 && day >= 8) || 
                  (month === 11 && day < 7)
    
    let tzOffsetHours = 5 // Default to Eastern Standard Time
    if (timezone === 'America/New_York' || timezone === 'America/Detroit' || timezone === 'US/Eastern') {
      tzOffsetHours = isDST ? 4 : 5
    } else if (timezone === 'America/Chicago' || timezone === 'US/Central') {
      tzOffsetHours = isDST ? 5 : 6
    } else if (timezone === 'America/Denver' || timezone === 'US/Mountain') {
      tzOffsetHours = isDST ? 6 : 7
    } else if (timezone === 'America/Los_Angeles' || timezone === 'US/Pacific') {
      tzOffsetHours = isDST ? 7 : 8
    } else if (timezone === 'America/Phoenix') {
      tzOffsetHours = 7 // Arizona doesn't observe DST
    }
    
    console.log(`Availability: Using timezone offset ${tzOffsetHours} hours (isDST: ${isDST})`)
    
    // Create UTC times for Google Calendar API query
    // Working hours are in local time, so we add the offset to get UTC
    const dayStartUTC = new Date(Date.UTC(year, month - 1, day, startHour + tzOffsetHours, startMin, 0))
    const dayEndUTC = new Date(Date.UTC(year, month - 1, day, endHour + tzOffsetHours, endMin, 0))
    
    console.log(`Availability: Parsed - year=${year}, month=${month}, day=${day}, startHour=${startHour}, endHour=${endHour}`)
    console.log(`Availability: Day start (UTC for API): ${dayStartUTC.toISOString()}, Day end (UTC for API): ${dayEndUTC.toISOString()}`)
    
    // Validate dates are valid
    if (isNaN(dayStartUTC.getTime()) || isNaN(dayEndUTC.getTime())) {
      console.error(`Availability: Invalid date objects - dayStartUTC: ${dayStartUTC}, dayEndUTC: ${dayEndUTC}`)
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
        console.log(`Availability: ${closerId} has ${busySlots.length} Google Calendar busy slots`)
        
        // Log each busy slot with local time conversion for debugging
        if (busySlots.length > 0) {
          for (const slot of busySlots) {
            const startUTC = new Date(slot.start)
            const endUTC = new Date(slot.end)
            // Convert to local time for logging
            const startLocal = new Date(startUTC.getTime() - tzOffsetHours * 60 * 60 * 1000)
            const endLocal = new Date(endUTC.getTime() - tzOffsetHours * 60 * 60 * 1000)
            console.log(`Availability: Busy slot - UTC: ${slot.start} to ${slot.end} | Local: ${startLocal.toISOString()} to ${endLocal.toISOString()}`)
          }
        }
      } catch (error: any) {
        console.error('Failed to get free/busy:', error?.message || error)
      }
    } else {
      console.log(`Availability: No calendar token found for ${closerId}`)
    }

    // Also check scheduled_appointments table for appointments that may not be synced to calendar
    // This ensures we don't double-book even if calendar sync failed
    const { data: dbAppointments } = await adminClient
      .from('scheduled_appointments')
      .select('scheduled_for, duration_minutes')
      .eq('closer_user_id', closerId)
      .gte('scheduled_for', dayStartUTC.toISOString())
      .lte('scheduled_for', dayEndUTC.toISOString())
      .in('status', ['scheduled', 'confirmed'])

    if (dbAppointments && dbAppointments.length > 0) {
      console.log(`Availability: Found ${dbAppointments.length} appointments in database for ${closerId}`)
      
      // Add database appointments to busy slots
      for (const appt of dbAppointments) {
        const apptStart = new Date(appt.scheduled_for)
        const apptEnd = new Date(apptStart.getTime() + (appt.duration_minutes || 60) * 60 * 1000)
        
        // Check if this slot already exists in busySlots (from Google Calendar)
        const alreadyInBusy = busySlots.some(busy => {
          const busyStart = new Date(busy.start)
          const busyEnd = new Date(busy.end)
          // Consider it a duplicate if times overlap significantly
          return Math.abs(busyStart.getTime() - apptStart.getTime()) < 5 * 60 * 1000
        })
        
        if (!alreadyInBusy) {
          busySlots.push({
            start: apptStart.toISOString(),
            end: apptEnd.toISOString(),
          })
          console.log(`Availability: Added DB appointment to busy slots: ${apptStart.toISOString()} - ${apptEnd.toISOString()}`)
        }
      }
    }

    // Generate 15-minute time slots
    const slots: { time: string; available: boolean; display: string }[] = []
    const slotInterval = 15 * 60 * 1000 // 15 minutes
    
    // Current time in UTC
    const nowUTC = new Date()
    
    // Generate slots starting from dayStartUTC, incrementing by slotInterval
    // All comparisons will be done in UTC
    let currentSlotUTC = new Date(dayStartUTC)
    const dayEndUTCTime = dayEndUTC.getTime()
    
    console.log(`Availability: Generating slots from ${dayStartUTC.toISOString()} to ${dayEndUTC.toISOString()}`)
    console.log(`Availability: Now UTC=${nowUTC.toISOString()}`)
    console.log(`Availability: Duration: ${durationMinutes} minutes, tzOffset: ${tzOffsetHours}`)
    
    let skippedPast = 0
    let totalSlots = 0
    
    while (currentSlotUTC.getTime() + durationMinutes * 60 * 1000 <= dayEndUTCTime) {
      const slotEndUTC = new Date(currentSlotUTC.getTime() + durationMinutes * 60 * 1000)
      totalSlots++
      
      // Skip slots in the past
      if (currentSlotUTC <= nowUTC) {
        skippedPast++
        currentSlotUTC = new Date(currentSlotUTC.getTime() + slotInterval)
        continue
      }
      
      // Slot times are already in UTC for comparison
      const slotStartUTC = currentSlotUTC
      
      // Check for conflicts with separate before/after buffers
      let conflictReason = ''
      const hasConflict = busySlots.some(busy => {
        const busyStart = new Date(busy.start)
        const busyEnd = new Date(busy.end)
        
        // Slot would conflict if:
        // 1. Slot overlaps with busy period directly
        // 2. Slot ends within buffer_after time before busy period starts (need gap after this appt)
        // 3. Slot starts within buffer_before time after busy period ends (need gap before this appt)
        const slotOverlaps = slotStartUTC < busyEnd && slotEndUTC > busyStart
        const tooCloseBeforeEvent = bufferAfter > 0 && slotEndUTC > new Date(busyStart.getTime() - bufferAfter * 60 * 1000) && slotEndUTC <= busyStart
        const tooCloseAfterEvent = bufferBefore > 0 && slotStartUTC < new Date(busyEnd.getTime() + bufferBefore * 60 * 1000) && slotStartUTC >= busyEnd
        
        if (slotOverlaps) conflictReason = `overlaps with ${busy.start}-${busy.end}`
        else if (tooCloseBeforeEvent) conflictReason = `too close before event at ${busy.start}`
        else if (tooCloseAfterEvent) conflictReason = `too close after event ending ${busy.end}`
        
        return slotOverlaps || tooCloseBeforeEvent || tooCloseAfterEvent
      })
      
      // Convert UTC slot time to local time for display
      // Subtract tzOffsetHours to go from UTC to local
      const localSlotTime = new Date(currentSlotUTC.getTime() - tzOffsetHours * 60 * 60 * 1000)
      
      // Format time for display (e.g., "9:00 AM")
      const hours = localSlotTime.getUTCHours()
      const minutes = localSlotTime.getUTCMinutes()
      const ampm = hours >= 12 ? 'PM' : 'AM'
      const displayHours = hours % 12 || 12
      const displayMinutes = minutes.toString().padStart(2, '0')
      const display = `${displayHours}:${displayMinutes} ${ampm}`
      
      // Format as local time string (YYYY-MM-DDTHH:MM) for the form value
      // This is what gets sent back to the server when scheduling
      const localYear = localSlotTime.getUTCFullYear()
      const localMonth = String(localSlotTime.getUTCMonth() + 1).padStart(2, '0')
      const localDay = String(localSlotTime.getUTCDate()).padStart(2, '0')
      const hourStr = String(hours).padStart(2, '0')
      const minStr = String(minutes).padStart(2, '0')
      const timeValue = `${localYear}-${localMonth}-${localDay}T${hourStr}:${minStr}`
      
      // Log first few unavailable slots to help debug
      if (hasConflict && slots.filter(s => !s.available).length < 5) {
        console.log(`Availability: Slot ${display} (${timeValue}) UNAVAILABLE - ${conflictReason}`)
      }
      
      slots.push({
        time: timeValue,
        available: !hasConflict,
        display,
      })
      
      currentSlotUTC = new Date(currentSlotUTC.getTime() + slotInterval)
    }

    // Count how many slots have conflicts
    const unavailableCount = slots.filter(s => !s.available).length
    
    console.log(`Availability: Generated ${slots.length} slots (${unavailableCount} unavailable, ${slots.length - unavailableCount} available), skipped ${skippedPast} past. hasCalendar=${hasCalendar}, busySlots=${busySlots.length}, closerId=${closerId}`)
    console.log(`Availability: Busy slots from Google:`, JSON.stringify(busySlots))
    console.log(`Availability: Day range (UTC): ${dayStartUTC.toISOString()} to ${dayEndUTC.toISOString()}`)

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
        dayStartUTC: dayStartUTC.toISOString(),
        dayEndUTC: dayEndUTC.toISOString(),
        tzOffsetHours,
      }
    })

  } catch (error) {
    console.error('Availability check error:', error)
    return NextResponse.json({ error: 'Failed to check availability' }, { status: 500 })
  }
}
