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
      .select('org_id, full_name')
      .eq('id', user.id)
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

    // Get original appointment
    const { data: originalAppointment, error: appointmentError } = await supabase
      .from('scheduled_appointments')
      .select('*')
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

    // Create new appointment with same setter
    const { data: newAppointment, error: createError } = await supabase
      .from('scheduled_appointments')
      .insert({
        org_id: profile.org_id,
        lead_id: originalAppointment.lead_id,
        opportunity_id: originalAppointment.opportunity_id,
        closer_user_id: originalAppointment.closer_user_id, // Keep same closer
        canvasser_user_id: originalAppointment.canvasser_user_id, // Keep same setter!
        scheduled_for: new Date(new_scheduled_for).toISOString(),
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
    if (originalAppointment.canvasser_user_id) {
      await supabase
        .from('notifications')
        .insert({
          org_id: profile.org_id,
          user_id: originalAppointment.canvasser_user_id,
          type: 'reschedule',
          title: 'Appointment Rescheduled',
          body: `Your appointment has been rescheduled to ${new Date(new_scheduled_for).toLocaleDateString()} at ${new Date(new_scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
          data: {
            original_appointment_id,
            new_appointment_id: newAppointment.id,
            lead_id: originalAppointment.lead_id,
            opportunity_id: originalAppointment.opportunity_id,
          },
        })
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
