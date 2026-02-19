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
async function getValidAccessToken(adminClient: any, userId: string, tokenData: any): Promise<string | null> {
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

export async function GET(request: NextRequest) {
  try {
    await requireAuth()
    const adminClient = getAdminClient()

    const teamId = request.nextUrl.searchParams.get('team_id')
    const dateStr = request.nextUrl.searchParams.get('date')
    const durationStr = request.nextUrl.searchParams.get('duration')

    if (!teamId || !dateStr) {
      return NextResponse.json({ error: 'team_id and date are required' }, { status: 400 })
    }

    const durationMinutes = parseInt(durationStr || '60', 10)

    // Get team timezone
    const { data: team } = await adminClient
      .from('teams')
      .select('timezone')
      .eq('id', teamId)
      .single()
    
    const timezone = team?.timezone || 'America/New_York'

    // Get active closers in the team's queue who have Google Calendar connected
    const { data: queueClosers, error: queueError } = await adminClient
      .from('team_closer_queue')
      .select(`
        *,
        user:users(id, full_name, email)
      `)
      .eq('team_id', teamId)
      .eq('active', true)
      .order('priority', { ascending: true })

    // Log buffer values prominently
    const closerBuffers = queueClosers?.map((c: any) => `${c.user?.full_name}:${c.buffer_minutes}min`).join(', ')
    console.log(`BUFFER CHECK: ${closerBuffers}`)

    if (queueError || !queueClosers || queueClosers.length === 0) {
      console.log(`Team availability: No active closers found in queue for team ${teamId}`)
      return NextResponse.json({ 
        error: 'No active closers in team queue',
        slots: [],
        hasCalendar: false,
        timezone,
      })
    }

    // Get Google tokens for all closers in queue
    const closerUserIds = queueClosers.map((c: any) => c.user_id)
    const { data: tokens } = await adminClient
      .from('user_google_tokens')
      .select('*')
      .in('user_id', closerUserIds)

    console.log(`Team availability: Found ${tokens?.length || 0} Google tokens for ${closerUserIds.length} closers`)
    console.log(`Team availability: Token user IDs:`, tokens?.map(t => t.user_id))

    // Filter to only closers with calendars
    const closersWithCalendars = queueClosers.filter((c: any) => 
      tokens?.some(t => t.user_id === c.user_id)
    )

    if (closersWithCalendars.length === 0) {
      console.log(`Team availability: No closers have Google Calendar connected`)
      return NextResponse.json({ 
        error: 'No closers in queue have Google Calendar connected',
        slots: [],
        hasCalendar: false,
        timezone,
      })
    }

    console.log(`Team availability: ${closersWithCalendars.length} closers with calendars:`, 
      closersWithCalendars.map((c: any) => c.user?.full_name))

    // Default working hours: 8 AM - 8 PM
    const workingHoursStart = '08:00'
    const workingHoursEnd = '20:00'
    // Buffer will be per-closer from their queue settings

    // Parse date parts manually
    const [year, month, day] = dateStr.split('-').map(Number)
    const [startHour, startMin] = workingHoursStart.split(':').map(Number)
    const [endHour, endMin] = workingHoursEnd.split(':').map(Number)
    
    // Determine timezone offset based on the TARGET date (not current date)
    // DST in US is roughly second Sunday of March to first Sunday of November
    const isDST = month >= 3 && month <= 10 // Rough DST check for target date
    
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
    
    console.log(`Team availability: Using timezone ${timezone}, offset ${tzOffsetHours} hours (isDST: ${isDST})`)
    
    // Create UTC times for Google Calendar API query
    const dayStartUTC = new Date(Date.UTC(year, month - 1, day, startHour + tzOffsetHours, startMin, 0))
    const dayEndUTC = new Date(Date.UTC(year, month - 1, day, endHour + tzOffsetHours, endMin, 0))
    
    console.log(`Team availability: Date range - UTC for API: ${dayStartUTC.toISOString()} to ${dayEndUTC.toISOString()}`)

    // Get busy slots for ALL closers with calendars
    const allCloserBusySlots: Map<string, { start: string; end: string }[]> = new Map()

    // First, get all scheduled appointments from database for all closers
    const { data: dbAppointments } = await adminClient
      .from('scheduled_appointments')
      .select('closer_user_id, scheduled_for, duration_minutes')
      .in('closer_user_id', closerUserIds)
      .gte('scheduled_for', dayStartUTC.toISOString())
      .lte('scheduled_for', dayEndUTC.toISOString())
      .in('status', ['scheduled', 'confirmed'])

    console.log(`Team availability: Found ${dbAppointments?.length || 0} appointments in database`)
    if (dbAppointments && dbAppointments.length > 0) {
      console.log(`Team availability: DB appointments:`, dbAppointments.map(a => ({
        closer: a.closer_user_id,
        time: a.scheduled_for,
        duration: a.duration_minutes
      })))
    }

    for (const closer of closersWithCalendars) {
      const tokenData = tokens?.find(t => t.user_id === closer.user_id)
      const accessToken = await getValidAccessToken(adminClient, closer.user_id, tokenData)
      
      let busySlots: { start: string; end: string }[] = []
      
      if (accessToken) {
        try {
          // Use UTC times for Google Calendar API
          busySlots = await getFreeBusy(accessToken, dayStartUTC, dayEndUTC)
          console.log(`Team availability: ${closer.user?.full_name} has ${busySlots.length} Google Calendar busy slots`)
        } catch (error) {
          console.error(`Failed to get free/busy for ${closer.user?.full_name}:`, error)
          // Mark as fully busy if we can't check
          busySlots = [{ start: dayStartUTC.toISOString(), end: dayEndUTC.toISOString() }]
        }
      }
      
      // Add database appointments for this closer that aren't already in Google Calendar
      const closerDbAppts = dbAppointments?.filter(a => a.closer_user_id === closer.user_id) || []
      for (const appt of closerDbAppts) {
        const apptStart = new Date(appt.scheduled_for)
        const apptEnd = new Date(apptStart.getTime() + (appt.duration_minutes || 60) * 60 * 1000)
        
        // Check if this slot already exists in busySlots (from Google Calendar)
        const alreadyInBusy = busySlots.some(busy => {
          const busyStart = new Date(busy.start)
          // Consider it a duplicate if times are within 5 minutes
          return Math.abs(busyStart.getTime() - apptStart.getTime()) < 5 * 60 * 1000
        })
        
        if (!alreadyInBusy) {
          busySlots.push({
            start: apptStart.toISOString(),
            end: apptEnd.toISOString(),
          })
        }
      }
      
      allCloserBusySlots.set(closer.user_id, busySlots)
      console.log(`Team availability: ${closer.user?.full_name} total busy slots: ${busySlots.length}`, 
        busySlots.length > 0 ? busySlots.map(s => `${s.start} - ${s.end}`) : [])
    }

    // Generate 15-minute time slots
    const slots: { time: string; available: boolean; display: string; availableClosers?: number }[] = []
    const slotInterval = 15 * 60 * 1000 // 15 minutes
    
    // Current time in UTC
    const nowUTC = new Date()
    
    // Generate slots starting from dayStartUTC
    let currentSlotUTC = new Date(dayStartUTC)
    const dayEndUTCTime = dayEndUTC.getTime()
    
    console.log(`Team availability: Now UTC=${nowUTC.toISOString()}`)
    console.log(`Team availability: Generating slots from ${dayStartUTC.toISOString()} to ${dayEndUTC.toISOString()}`)
    
    while (currentSlotUTC.getTime() + durationMinutes * 60 * 1000 <= dayEndUTCTime) {
      const slotEndUTC = new Date(currentSlotUTC.getTime() + durationMinutes * 60 * 1000)
      
      // Skip slots in the past
      if (currentSlotUTC <= nowUTC) {
        currentSlotUTC = new Date(currentSlotUTC.getTime() + slotInterval)
        continue
      }
      
      // Slot times are already in UTC
      const slotStartUTC = currentSlotUTC
      
      // Check how many closers are available at this slot
      let availableCloserCount = 0
      
      for (const closer of closersWithCalendars) {
        const busySlots = allCloserBusySlots.get(closer.user_id) || []
        
        // Use separate before/after buffers (fall back to buffer_minutes for backwards compatibility)
        const bufferBefore = closer.buffer_before ?? 0
        const bufferAfter = closer.buffer_after ?? closer.buffer_minutes ?? 15
        
        // Check for conflicts with separate before/after buffers
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
          
          return slotOverlaps || tooCloseBeforeEvent || tooCloseAfterEvent
        })
        
        if (!hasConflict) {
          availableCloserCount++
        }
      }
      
      // Convert UTC slot time to local time for display
      const localSlotTime = new Date(currentSlotUTC.getTime() - tzOffsetHours * 60 * 60 * 1000)
      
      // Log slots between 2 PM and 4 PM local time for debugging
      const localHour = localSlotTime.getUTCHours()
      if (localHour >= 14 && localHour < 16) {
        console.log(`Team availability slot ${localSlotTime.getUTCHours()}:${String(localSlotTime.getUTCMinutes()).padStart(2,'0')} (UTC: ${currentSlotUTC.toISOString()}): ${availableCloserCount} closers available`)
      }
      
      // Format time for display (e.g., "9:00 AM")
      const hours = localSlotTime.getUTCHours()
      const minutes = localSlotTime.getUTCMinutes()
      const ampm = hours >= 12 ? 'PM' : 'AM'
      const displayHours = hours % 12 || 12
      const displayMinutes = minutes.toString().padStart(2, '0')
      const display = `${displayHours}:${displayMinutes} ${ampm}`
      
      // Format as local time string (YYYY-MM-DDTHH:MM)
      const localYear = localSlotTime.getUTCFullYear()
      const localMonth = String(localSlotTime.getUTCMonth() + 1).padStart(2, '0')
      const localDay = String(localSlotTime.getUTCDate()).padStart(2, '0')
      const hourStr = String(hours).padStart(2, '0')
      const minStr = String(minutes).padStart(2, '0')
      const timeValue = `${localYear}-${localMonth}-${localDay}T${hourStr}:${minStr}`
      
      slots.push({
        time: timeValue,
        available: availableCloserCount > 0,
        display,
        availableClosers: availableCloserCount,
      })
      
      currentSlotUTC = new Date(currentSlotUTC.getTime() + slotInterval)
    }

    // Include debug info about buffers
    const closerDebug = closersWithCalendars.map((c: any) => ({
      name: c.user?.full_name,
      buffer_before: c.buffer_before ?? 0,
      buffer_after: c.buffer_after ?? c.buffer_minutes ?? 15
    }))

    return NextResponse.json({
      slots,
      hasCalendar: true,
      timezone,
      workingHours: {
        start: workingHoursStart,
        end: workingHoursEnd,
      },
      closersInQueue: closersWithCalendars.length,
      debug: { closers: closerDebug }
    })

  } catch (error) {
    console.error('Team availability check error:', error)
    return NextResponse.json({ error: 'Failed to check availability' }, { status: 500 })
  }
}
