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
    
    // Create dates using local time components (server local time)
    // These will be used to generate slot display times
    const dayStart = new Date(year, month - 1, day, startHour, startMin, 0)
    const dayEnd = new Date(year, month - 1, day, endHour, endMin, 0)
    
    // For Google Calendar API, we need to convert local time to UTC
    // Eastern Time is UTC-5 (or UTC-4 during DST)
    // To convert 8 AM Eastern to UTC: 8 + 5 = 13:00 UTC
    // TODO: Use proper timezone library for accurate conversion
    const tzOffsetHours = 5 // Eastern is UTC-5, so add 5 to get UTC
    
    // Create UTC times for Google Calendar API query
    const dayStartUTC = new Date(Date.UTC(year, month - 1, day, startHour + tzOffsetHours, startMin, 0))
    const dayEndUTC = new Date(Date.UTC(year, month - 1, day, endHour + tzOffsetHours, endMin, 0))
    
    console.log(`Team availability: Date range - Local: ${dayStart.toISOString()} to ${dayEnd.toISOString()}`)
    console.log(`Team availability: Date range - UTC for API: ${dayStartUTC.toISOString()} to ${dayEndUTC.toISOString()}`)

    // Get busy slots for ALL closers with calendars
    const allCloserBusySlots: Map<string, { start: string; end: string }[]> = new Map()

    for (const closer of closersWithCalendars) {
      const tokenData = tokens?.find(t => t.user_id === closer.user_id)
      const accessToken = await getValidAccessToken(adminClient, closer.user_id, tokenData)
      
      if (accessToken) {
        try {
          // Use UTC times for Google Calendar API
          const busySlots = await getFreeBusy(accessToken, dayStartUTC, dayEndUTC)
          allCloserBusySlots.set(closer.user_id, busySlots)
          console.log(`Team availability: ${closer.user?.full_name} has ${busySlots.length} busy slots:`, JSON.stringify(busySlots))
        } catch (error) {
          console.error(`Failed to get free/busy for ${closer.user?.full_name}:`, error)
          // Mark as fully busy if we can't check
          allCloserBusySlots.set(closer.user_id, [{ start: dayStart.toISOString(), end: dayEnd.toISOString() }])
        }
      }
    }

    // Generate 15-minute time slots
    const slots: { time: string; available: boolean; display: string; availableClosers?: number }[] = []
    const slotInterval = 15 * 60 * 1000 // 15 minutes
    
    // For "now" comparison, we need current time in Eastern
    // Server is UTC, so we subtract 5 hours to get Eastern time
    const nowUTC = new Date()
    const nowEastern = new Date(nowUTC.getTime() - tzOffsetHours * 60 * 60 * 1000)
    
    console.log(`Team availability: Now UTC=${nowUTC.toISOString()}, Now Eastern=${nowEastern.toISOString()}`)
    console.log(`Team availability: Day start=${dayStart.toISOString()}, Day end=${dayEnd.toISOString()}`)
    
    // dayStart/dayEnd are in "fake local" time (8:00 means 8:00 AM Eastern, stored as if UTC)
    // We iterate through these for display purposes
    let currentSlot = new Date(dayStart)
    
    while (currentSlot.getTime() + durationMinutes * 60 * 1000 <= dayEnd.getTime()) {
      const slotEnd = new Date(currentSlot.getTime() + durationMinutes * 60 * 1000)
      
      // Skip slots in the past (compare Eastern times)
      // currentSlot is "fake UTC" representing Eastern time, so compare with nowEastern
      if (currentSlot <= nowEastern) {
        currentSlot = new Date(currentSlot.getTime() + slotInterval)
        continue
      }
      
      // For conflict detection with Google Calendar, convert slot times to real UTC
      // Add tzOffsetHours to convert Eastern to UTC
      const slotStartUTC = new Date(currentSlot.getTime() + tzOffsetHours * 60 * 60 * 1000)
      const slotEndUTC = new Date(slotEnd.getTime() + tzOffsetHours * 60 * 60 * 1000)
      
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
      
      // Format time for display (e.g., "9:00 AM")
      const hours = currentSlot.getHours()
      const minutes = currentSlot.getMinutes()
      const ampm = hours >= 12 ? 'PM' : 'AM'
      const displayHours = hours % 12 || 12
      const displayMinutes = minutes.toString().padStart(2, '0')
      const display = `${displayHours}:${displayMinutes} ${ampm}`
      
      // Format as local time string (YYYY-MM-DDTHH:MM)
      const year = currentSlot.getFullYear()
      const month = String(currentSlot.getMonth() + 1).padStart(2, '0')
      const day = String(currentSlot.getDate()).padStart(2, '0')
      const hourStr = String(hours).padStart(2, '0')
      const minStr = String(minutes).padStart(2, '0')
      const timeValue = `${year}-${month}-${day}T${hourStr}:${minStr}`
      
      slots.push({
        time: timeValue,
        available: availableCloserCount > 0,
        display,
        availableClosers: availableCloserCount,
      })
      
      currentSlot = new Date(currentSlot.getTime() + slotInterval)
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
