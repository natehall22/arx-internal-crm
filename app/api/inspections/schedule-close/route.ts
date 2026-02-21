import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('users')
      .select('org_id, full_name, google_calendar_id, google_refresh_token')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 400 })
    }

    const body = await request.json()
    const { 
      original_appointment_id, 
      scheduled_for, 
      notes 
    } = body as {
      original_appointment_id: string
      scheduled_for: string
      notes?: string
    }

    if (!original_appointment_id || !scheduled_for) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Get original appointment details
    const { data: originalAppointment, error: appointmentError } = await supabase
      .from('scheduled_appointments')
      .select('*, leads(*)')
      .eq('id', original_appointment_id)
      .single()

    if (appointmentError || !originalAppointment) {
      return NextResponse.json({ error: 'Original appointment not found' }, { status: 404 })
    }

    // Parse the scheduled_for - it's a local time string like "YYYY-MM-DDTHH:MM"
    let scheduledForISO: string
    let localDateTimeStr: string
    
    if (scheduled_for.includes('Z') || scheduled_for.includes('+')) {
      scheduledForISO = scheduled_for
      localDateTimeStr = scheduled_for.slice(0, 16)
    } else {
      localDateTimeStr = scheduled_for.length === 16 ? scheduled_for : scheduled_for.slice(0, 16)
      const [datePart, timePart] = localDateTimeStr.split('T')
      const [year, month, day] = datePart.split('-').map(Number)
      const [hour, minute] = timePart.split(':').map(Number)
      const localDate = new Date(year, month - 1, day, hour, minute)
      scheduledForISO = localDate.toISOString()
    }

    // Create the close appointment
    const { data: closeAppointment, error: createError } = await supabase
      .from('scheduled_appointments')
      .insert({
        org_id: profile.org_id,
        lead_id: originalAppointment.lead_id,
        opportunity_id: originalAppointment.opportunity_id,
        closer_user_id: user.id,
        canvasser_user_id: originalAppointment.canvasser_user_id,
        scheduled_for: scheduledForISO,
        duration_minutes: originalAppointment.duration_minutes || 60,
        status: 'scheduled',
        address_text: originalAppointment.address_text,
        notes: notes || `Close appointment - follow up from inspection on ${new Date(originalAppointment.scheduled_for).toLocaleDateString()}`,
        appointment_type: 'close',
      })
      .select()
      .single()

    if (createError) {
      console.error('Create close appointment error:', createError)
      return NextResponse.json({ error: 'Failed to create close appointment' }, { status: 500 })
    }

    // Create Google Calendar event if user has calendar connected
    if (profile.google_refresh_token && profile.google_calendar_id) {
      try {
        const { createCalendarEvent } = await import('@/lib/google-calendar')
        
        const timezone = 'America/New_York'
        const startDateTime = `${localDateTimeStr}:00`
        const durationMinutes = originalAppointment.duration_minutes || 60
        
        const [datePart, timePart] = localDateTimeStr.split('T')
        const timeOnly = timePart?.split(':') || ['00', '00']
        let endHour = parseInt(timeOnly[0], 10)
        let endMin = parseInt(timeOnly[1], 10) + durationMinutes
        
        while (endMin >= 60) {
          endMin -= 60
          endHour += 1
        }
        
        const endDateTime = `${datePart}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00`

        const customerName = originalAppointment.leads?.homeowner_name || 'Customer'
        const address = originalAppointment.address_text || originalAppointment.leads?.address_text || ''

        const event = await createCalendarEvent(profile.google_refresh_token, {
          summary: `Close Appointment - ${customerName}`,
          description: `Close appointment with ${customerName}\n\nAddress: ${address}\n\nNotes: ${notes || 'Follow up from inspection'}`,
          location: address,
          start: {
            dateTime: startDateTime,
            timeZone: timezone,
          },
          end: {
            dateTime: endDateTime,
            timeZone: timezone,
          },
        }, profile.google_calendar_id)

        if (event?.id) {
          await supabase
            .from('scheduled_appointments')
            .update({ google_event_id: event.id })
            .eq('id', closeAppointment.id)
        }
      } catch (calendarError) {
        console.error('Calendar event creation error:', calendarError)
      }
    }

    // Notify the setter about the close appointment
    if (originalAppointment.canvasser_user_id && originalAppointment.canvasser_user_id !== user.id) {
      const customerName = originalAppointment.leads?.homeowner_name || 'Customer'
      const customerAddress = originalAppointment.leads?.address_text || originalAppointment.address_text || ''
      
      await supabase
        .from('notifications')
        .insert({
          org_id: profile.org_id,
          recipient_user_id: originalAppointment.canvasser_user_id,
          actor_user_id: user.id,
          type: 'inspection_outcome',
          title: `Close Appointment Scheduled - ${customerName}`,
          body: `Great news! ${profile.full_name || 'Closer'} has scheduled a close appointment.\n\nCustomer: ${customerName}\nAddress: ${customerAddress}\nScheduled: ${new Date(scheduledForISO).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}\n\n${notes ? `Notes: ${notes}` : ''}`,
          data: {
            appointment_id: closeAppointment.id,
            original_appointment_id,
            opportunity_id: originalAppointment.opportunity_id,
            lead_id: originalAppointment.lead_id,
            closer_name: profile.full_name,
          },
        })
    }

    // Create activity record
    await supabase
      .from('activities')
      .insert({
        org_id: profile.org_id,
        opportunity_id: originalAppointment.opportunity_id,
        lead_id: originalAppointment.lead_id,
        user_id: user.id,
        type: 'appointment_scheduled',
        body: `Close appointment scheduled for ${new Date(scheduledForISO).toLocaleString()}${notes ? ` - ${notes}` : ''}`,
      })

    return NextResponse.json({ 
      success: true, 
      appointment: closeAppointment,
    })

  } catch (error) {
    console.error('Schedule close error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
