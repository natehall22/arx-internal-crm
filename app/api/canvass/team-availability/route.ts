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

    if (queueError || !queueClosers || queueClosers.length === 0) {
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

    // Filter to only closers with calendars
    const closersWithCalendars = queueClosers.filter((c: any) => 
      tokens?.some(t => t.user_id === c.user_id)
    )

    if (closersWithCalendars.length === 0) {
      return NextResponse.json({ 
        error: 'No closers in queue have Google Calendar connected',
        slots: [],
        hasCalendar: false,
        timezone,
      })
    }

    console.log(`Team availability: ${closersWithCalendars.length} closers with calendars in team ${teamId}`)

    // Default working hours: 8 AM - 6 PM
    const workingHoursStart = '08:00'
    const workingHoursEnd = '18:00'
    const bufferMinutes = 30

    // Create day bounds
    const dayStartStr = `${dateStr}T${workingHoursStart}:00`
    const dayEndStr = `${dateStr}T${workingHoursEnd}:00`
    const dayStart = new Date(dayStartStr)
    const dayEnd = new Date(dayEndStr)

    // Get busy slots for ALL closers with calendars
    const allCloserBusySlots: Map<string, { start: string; end: string }[]> = new Map()

    for (const closer of closersWithCalendars) {
      const tokenData = tokens?.find(t => t.user_id === closer.user_id)
      const accessToken = await getValidAccessToken(adminClient, closer.user_id, tokenData)
      
      if (accessToken) {
        try {
          const busySlots = await getFreeBusy(accessToken, dayStart, dayEnd)
          allCloserBusySlots.set(closer.user_id, busySlots)
          console.log(`Team availability: ${closer.user?.full_name} has ${busySlots.length} busy slots`)
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
    
    let currentSlot = new Date(dayStart)
    const now = new Date()
    
    while (currentSlot.getTime() + durationMinutes * 60 * 1000 <= dayEnd.getTime()) {
      const slotEnd = new Date(currentSlot.getTime() + durationMinutes * 60 * 1000)
      
      // Skip slots in the past
      if (currentSlot <= now) {
        currentSlot = new Date(currentSlot.getTime() + slotInterval)
        continue
      }
      
      // Check how many closers are available at this slot
      const bufferedStart = new Date(currentSlot.getTime() - bufferMinutes * 60 * 1000)
      const bufferedEnd = new Date(slotEnd.getTime() + bufferMinutes * 60 * 1000)
      
      let availableCloserCount = 0
      
      for (const closer of closersWithCalendars) {
        const busySlots = allCloserBusySlots.get(closer.user_id) || []
        
        const hasConflict = busySlots.some(busy => {
          const busyStart = new Date(busy.start)
          const busyEnd = new Date(busy.end)
          return bufferedStart < busyEnd && bufferedEnd > busyStart
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

    return NextResponse.json({
      slots,
      hasCalendar: true,
      timezone,
      workingHours: {
        start: workingHoursStart,
        end: workingHoursEnd,
      },
      closersInQueue: closersWithCalendars.length,
    })

  } catch (error) {
    console.error('Team availability check error:', error)
    return NextResponse.json({ error: 'Failed to check availability' }, { status: 500 })
  }
}
