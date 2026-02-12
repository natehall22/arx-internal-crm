import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createCalendarEvent, refreshAccessToken, CalendarEvent } from '@/lib/google-calendar'

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Helper to get valid access token
async function getValidAccessToken(adminClient: any, userId: string): Promise<string | null> {
  const { data: tokenData } = await adminClient
    .from('user_google_tokens')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (!tokenData) return null

  const expiresAt = new Date(tokenData.expires_at)
  const now = new Date()

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
    } catch {
      return null
    }
  }

  return tokenData.access_token
}

// Helper to get timezone for user
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
      
      if (team?.timezone) return team.timezone
    }
  } catch {}
  return 'America/New_York'
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getAdminClient()
    
    // Get auth from cookie
    const cookieHeader = request.headers.get('cookie') || ''
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
    const cookieName = `sb-${projectRef}-auth-token`
    
    // Parse session from cookie
    let userId: string | null = null
    const cookieMatch = cookieHeader.match(new RegExp(`${cookieName}=([^;]+)`))
    if (cookieMatch) {
      try {
        const sessionData = JSON.parse(decodeURIComponent(cookieMatch[1]))
        const anonClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
          auth: { autoRefreshToken: false, persistSession: false },
          global: { headers: { Authorization: `Bearer ${sessionData.access_token}` } },
        })
        const { data: { user } } = await anonClient.auth.getUser(sessionData.access_token)
        userId = user?.id || null
      } catch {}
    }
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('users')
      .select('org_id, full_name')
      .eq('id', userId)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 400 })
    }

    const body = await request.json()
    const { 
      original_appointment_id,
      new_scheduled_for,
      notes,
    } = body

    if (!original_appointment_id || !new_scheduled_for) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Get original appointment with lead info
    const { data: originalAppointment, error: appointmentError } = await supabase
      .from('scheduled_appointments')
      .select('*, leads(homeowner_name, phone, address_text)')
      .eq('id', original_appointment_id)
      .single()

    if (appointmentError || !originalAppointment) {
      return NextResponse.json({ error: 'Original appointment not found' }, { status: 404 })
    }

    // Mark original appointment as cancelled/rescheduled
    await supabase
      .from('scheduled_appointments')
      .update({ 
        status: 'cancelled',
        notes: (originalAppointment.notes || '') + '\nRescheduled to new appointment.'
      })
      .eq('id', original_appointment_id)

    const newScheduledDate = new Date(new_scheduled_for)

    // Create new appointment with same setter
    const { data: newAppointment, error: createError } = await supabase
      .from('scheduled_appointments')
      .insert({
        org_id: profile.org_id,
        lead_id: originalAppointment.lead_id,
        opportunity_id: originalAppointment.opportunity_id,
        closer_user_id: originalAppointment.closer_user_id,
        canvasser_user_id: originalAppointment.canvasser_user_id,
        scheduled_for: newScheduledDate.toISOString(),
        duration_minutes: originalAppointment.duration_minutes,
        status: 'scheduled',
        address_text: originalAppointment.address_text,
        notes: notes || `Rescheduled from ${new Date(originalAppointment.scheduled_for).toLocaleDateString()}`,
      })
      .select()
      .single()

    if (createError) {
      console.error('Create appointment error:', createError)
      return NextResponse.json({ error: 'Failed to create new appointment' }, { status: 500 })
    }

    // Sync to closer's Google Calendar
    let calendarSynced = false
    let googleEventId: string | null = null
    
    if (originalAppointment.closer_user_id) {
      const accessToken = await getValidAccessToken(supabase, originalAppointment.closer_user_id)
      
      if (accessToken) {
        try {
          const timezone = await getTimezoneForUser(supabase, originalAppointment.closer_user_id)
          const endTime = new Date(newScheduledDate.getTime() + originalAppointment.duration_minutes * 60 * 1000)
          
          const event: CalendarEvent = {
            summary: `Inspection: ${originalAppointment.leads?.homeowner_name || 'Customer'} (Rescheduled)`,
            description: [
              notes || 'Rescheduled appointment',
              originalAppointment.leads?.phone ? `Phone: ${originalAppointment.leads.phone}` : '',
            ].filter(Boolean).join('\n'),
            location: originalAppointment.leads?.address_text || originalAppointment.address_text || undefined,
            start: {
              dateTime: newScheduledDate.toISOString(),
              timeZone: timezone,
            },
            end: {
              dateTime: endTime.toISOString(),
              timeZone: timezone,
            },
          }
          
          const createdEvent = await createCalendarEvent(accessToken, event)
          googleEventId = createdEvent.id
          calendarSynced = true
          
          // Update appointment with Google event ID
          await supabase
            .from('scheduled_appointments')
            .update({ google_event_id: googleEventId })
            .eq('id', newAppointment.id)
        } catch (calendarError) {
          console.error('Calendar sync error:', calendarError)
        }
      }
    }

    // Create status update for original appointment
    await supabase
      .from('inspection_status_updates')
      .insert({
        org_id: profile.org_id,
        appointment_id: original_appointment_id,
        opportunity_id: originalAppointment.opportunity_id,
        lead_id: originalAppointment.lead_id,
        closer_user_id: user.id,
        setter_user_id: originalAppointment.canvasser_user_id,
        outcome: 'rescheduled',
        notes: `Rescheduled to ${new Date(new_scheduled_for).toLocaleDateString()}`,
      })

    // Mark pending prompt as completed
    await supabase
      .from('pending_status_prompts')
      .update({ completed: true })
      .eq('appointment_id', original_appointment_id)

    // Notify setter about reschedule
    const notificationData = {
      original_appointment_id,
      new_appointment_id: newAppointment.id,
      lead_id: originalAppointment.lead_id,
      opportunity_id: originalAppointment.opportunity_id,
    }
    
    const rescheduleMessage = `Appointment with ${originalAppointment.leads?.homeowner_name || 'customer'} has been rescheduled to ${newScheduledDate.toLocaleDateString()} at ${newScheduledDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    
    if (originalAppointment.canvasser_user_id) {
      await supabase
        .from('notifications')
        .insert({
          org_id: profile.org_id,
          user_id: originalAppointment.canvasser_user_id,
          type: 'reschedule',
          title: 'Appointment Rescheduled',
          body: rescheduleMessage,
          data: notificationData,
        })
      
      // Get setter's manager and notify them
      const { data: setter } = await supabase
        .from('users')
        .select('team_id')
        .eq('id', originalAppointment.canvasser_user_id)
        .single()
      
      if (setter?.team_id) {
        // Find team manager
        const { data: teamManagers } = await supabase
          .from('users')
          .select('id')
          .eq('team_id', setter.team_id)
          .in('role', ['sales_manager', 'regional_manager', 'admin'])
          .neq('id', userId)
        
        for (const manager of teamManagers || []) {
          await supabase.from('notifications').insert({
            org_id: profile.org_id,
            user_id: manager.id,
            type: 'reschedule',
            title: 'Team Appointment Rescheduled',
            body: rescheduleMessage,
            data: notificationData,
          })
        }
      }
    }
    
    // Notify closer's manager if different from setter's manager
    if (originalAppointment.closer_user_id) {
      const { data: closer } = await supabase
        .from('users')
        .select('team_id')
        .eq('id', originalAppointment.closer_user_id)
        .single()
      
      if (closer?.team_id) {
        const { data: closerManagers } = await supabase
          .from('users')
          .select('id')
          .eq('team_id', closer.team_id)
          .in('role', ['sales_manager', 'regional_manager', 'admin'])
          .neq('id', userId)
        
        for (const manager of closerManagers || []) {
          await supabase.from('notifications').insert({
            org_id: profile.org_id,
            user_id: manager.id,
            type: 'reschedule',
            title: 'Team Appointment Rescheduled',
            body: rescheduleMessage,
            data: notificationData,
          })
        }
      }
    }

    // Create activity
    await supabase
      .from('activities')
      .insert({
        org_id: profile.org_id,
        opportunity_id: originalAppointment.opportunity_id,
        lead_id: originalAppointment.lead_id,
        user_id: user.id,
        type: 'status_change',
        body: `Appointment rescheduled to ${new Date(new_scheduled_for).toLocaleDateString()}`,
      })

    return NextResponse.json({ 
      success: true, 
      new_appointment: newAppointment,
    })

  } catch (error) {
    console.error('Reschedule error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
