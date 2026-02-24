import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import type { InspectionOutcome } from '@/lib/types/database'

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
      appointment_id, 
      outcome, 
      notes, 
      setter_feedback,
      schedule_follow_up,
      follow_up_date,
    } = body as {
      appointment_id: string
      outcome: InspectionOutcome
      notes?: string
      setter_feedback?: string
      schedule_follow_up?: boolean
      follow_up_date?: string
    }

    if (!appointment_id || !outcome) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Get appointment details
    const { data: appointment, error: appointmentError } = await supabase
      .from('scheduled_appointments')
      .select('*, leads(*), opportunities(*)')
      .eq('id', appointment_id)
      .single()

    if (appointmentError || !appointment) {
      // Appointment was deleted - mark the prompt as completed so it doesn't keep showing
      console.log(`Appointment ${appointment_id} not found - marking prompt as completed`)
      await supabase
        .from('pending_status_prompts')
        .update({ completed: true })
        .eq('appointment_id', appointment_id)
      
      // Return success so the UI can move on
      return NextResponse.json({ 
        success: true, 
        message: 'Appointment no longer exists - prompt dismissed',
        skipped: true 
      })
    }

    // Create status update record
    const { data: statusUpdate, error: statusError } = await supabase
      .from('inspection_status_updates')
      .insert({
        org_id: profile.org_id,
        appointment_id,
        opportunity_id: appointment.opportunity_id,
        lead_id: appointment.lead_id,
        closer_user_id: user.id,
        setter_user_id: appointment.canvasser_user_id,
        outcome,
        notes: notes || null,
        setter_feedback: setter_feedback || null,
        prompted_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (statusError) {
      console.error('Status update error:', statusError)
      console.error('Status update details:', {
        org_id: profile.org_id,
        appointment_id,
        opportunity_id: appointment.opportunity_id,
        lead_id: appointment.lead_id,
        closer_user_id: user.id,
        setter_user_id: appointment.canvasser_user_id,
        outcome,
      })
      return NextResponse.json({ error: `Failed to create status update: ${statusError.message}` }, { status: 500 })
    }

    // Update appointment status
    await supabase
      .from('scheduled_appointments')
      .update({ 
        status: outcome === 'sale' ? 'completed' : outcome === 'not_home' ? 'no_show' : 'completed'
      })
      .eq('id', appointment_id)

    // Update opportunity with outcome
    if (appointment.opportunity_id) {
      const opportunityUpdate: Record<string, any> = {
        inspection_outcome: outcome,
        inspection_outcome_at: new Date().toISOString(),
        inspection_notes: notes || null,
      }

      // If sale, update opportunity status to won
      if (outcome === 'sale') {
        opportunityUpdate.status = 'won'
      } else if (outcome === 'said_no' || outcome === 'failed_credit' || outcome === 'no_problems_found') {
        opportunityUpdate.status = 'lost'
      } else if (outcome === 'moving_to_close') {
        opportunityUpdate.status = 'negotiation'
      }

      await supabase
        .from('opportunities')
        .update(opportunityUpdate)
        .eq('id', appointment.opportunity_id)
    }

    // Mark pending prompt as completed
    await supabase
      .from('pending_status_prompts')
      .update({ completed: true })
      .eq('appointment_id', appointment_id)

    // Create notifications for setter, setter's manager, and closer's manager
    const outcomeLabels: Record<InspectionOutcome, string> = {
      sale: 'Sale!',
      said_no: 'Said No',
      not_home: 'Not Home',
      failed_credit: 'Failed Credit',
      rescheduled: 'Rescheduled',
      no_problems_found: 'No Problems Found',
      moving_to_close: 'Moving to Close',
      insurance_follow_up: 'Insurance Follow Up',
    }

    const customerName = appointment.leads?.homeowner_name || 'Customer'
    const customerAddress = appointment.leads?.address_text || appointment.address_text || ''
    
    // Build comprehensive notification body with all notes for setter
    const notificationParts: string[] = []
    notificationParts.push(`Customer: ${customerName}`)
    if (customerAddress) {
      notificationParts.push(`Address: ${customerAddress}`)
    }
    notificationParts.push(`Outcome: ${outcomeLabels[outcome]}`)
    notificationParts.push(`Closer: ${profile.full_name || 'Rep'}`)
    
    // Include all notes from the closer
    if (setter_feedback) {
      notificationParts.push(`\nCloser's Notes: "${setter_feedback}"`)
    }
    if (notes && notes !== setter_feedback) {
      notificationParts.push(`\nAdditional Notes: "${notes}"`)
    }
    
    const notificationBody = notificationParts.join('\n')
    
    const notificationData = {
      appointment_id,
      opportunity_id: appointment.opportunity_id,
      lead_id: appointment.lead_id,
      outcome,
      closer_name: profile.full_name,
      notes: notes || null,
      setter_feedback: setter_feedback || null,
    }

    // Notify setter - always notify when feedback is submitted (unless closer is the setter)
    if (appointment.canvasser_user_id && appointment.canvasser_user_id !== user.id) {
      console.log('Creating notification for setter:', appointment.canvasser_user_id)
      console.log('Notification data:', {
        org_id: profile.org_id,
        recipient_user_id: appointment.canvasser_user_id,
        actor_user_id: user.id,
        type: 'inspection_outcome',
        title: `Inspection Result: ${outcomeLabels[outcome]} - ${customerName}`,
      })
      
      const { error: notificationError } = await supabase
        .from('notifications')
        .insert({
          org_id: profile.org_id,
          recipient_user_id: appointment.canvasser_user_id,
          actor_user_id: user.id,
          type: 'inspection_outcome',
          title: `Inspection Result: ${outcomeLabels[outcome]} - ${customerName}`,
          body: notificationBody,
          data: notificationData,
        })
      
      if (notificationError) {
        console.error('Failed to create setter notification:', notificationError)
      } else {
        console.log('Setter notification created successfully')
      }
      
      // Get setter's manager and notify them
      const { data: setter } = await supabase
        .from('users')
        .select('team_id')
        .eq('id', appointment.canvasser_user_id)
        .single()
      
      if (setter?.team_id) {
        const { data: setterManagers } = await supabase
          .from('users')
          .select('id')
          .eq('team_id', setter.team_id)
          .in('role', ['sales_manager', 'regional_manager', 'admin'])
          .neq('id', user.id)
        
        for (const manager of setterManagers || []) {
          await supabase.from('notifications').insert({
            org_id: profile.org_id,
            recipient_user_id: manager.id,
            actor_user_id: user.id,
            type: 'inspection_outcome',
            title: `Team Inspection Result: ${outcomeLabels[outcome]}`,
            body: `${customerName} - Setter: ${appointment.canvasser_user_id ? 'Team member' : 'N/A'}, Closer: ${profile.full_name || 'Rep'}`,
            data: notificationData,
          })
        }
      }
    }
    
    // Get closer's manager and notify them (if different from setter's manager)
    const { data: closer } = await supabase
      .from('users')
      .select('team_id')
      .eq('id', user.id)
      .single()
    
    if (closer?.team_id) {
      const { data: closerManagers } = await supabase
        .from('users')
        .select('id')
        .eq('team_id', closer.team_id)
        .in('role', ['sales_manager', 'regional_manager', 'admin'])
        .neq('id', user.id)
      
      for (const manager of closerManagers || []) {
        // Check if we already notified this manager (as setter's manager)
        await supabase.from('notifications').insert({
          org_id: profile.org_id,
          recipient_user_id: manager.id,
          actor_user_id: user.id,
          type: 'inspection_outcome',
          title: `Team Inspection Result: ${outcomeLabels[outcome]}`,
          body: `${customerName} - Closer: ${profile.full_name || 'Rep'}`,
          data: notificationData,
        })
      }
    }

    // Create activity record
    await supabase
      .from('activities')
      .insert({
        org_id: profile.org_id,
        opportunity_id: appointment.opportunity_id,
        lead_id: appointment.lead_id,
        user_id: user.id,
        type: 'status_change',
        body: `Inspection completed: ${outcome}${notes ? ` - ${notes}` : ''}`,
      })

    // Mark the pending status prompt as completed
    await supabase
      .from('pending_status_prompts')
      .update({ completed: true })
      .eq('appointment_id', appointment_id)

    // Schedule follow-up if requested
    let followUpAppointment = null
    if (schedule_follow_up && follow_up_date) {
      // Parse the follow-up date/time
      const followUpDateTime = new Date(follow_up_date)
      
      // Create a follow-up appointment
      const { data: newAppointment, error: followUpError } = await supabase
        .from('scheduled_appointments')
        .insert({
          org_id: profile.org_id,
          lead_id: appointment.lead_id,
          opportunity_id: appointment.opportunity_id,
          closer_user_id: user.id,
          canvasser_user_id: appointment.canvasser_user_id,
          scheduled_for: followUpDateTime.toISOString(),
          duration_minutes: appointment.duration_minutes || 60,
          address_text: appointment.address_text,
          status: 'scheduled',
          notes: `Follow-up from ${outcome}: ${notes || 'No notes'}`,
          appointment_type: 'follow_up',
        })
        .select()
        .single()

      if (followUpError) {
        console.error('Failed to create follow-up appointment:', followUpError)
      } else {
        followUpAppointment = newAppointment
        console.log('Created follow-up appointment:', newAppointment.id)
      }
    }

    return NextResponse.json({ 
      success: true, 
      status_update: statusUpdate,
      follow_up_appointment: followUpAppointment,
    })

  } catch (error) {
    console.error('Inspection status error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Get pending status prompts for current user
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user profile to check role
    const { data: profile } = await supabase
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 400 })
    }

    const isAdmin = profile.role === 'admin'

    // Get pending prompts that are due
    // Admins see all prompts in their org, others see only their own
    let query = supabase
      .from('pending_status_prompts')
      .select(`
        *,
        scheduled_appointments(
          *,
          leads(homeowner_name, address_text)
        )
      `)
      .eq('completed', false)
      .eq('dismissed', false)
      .lte('prompt_at', new Date().toISOString())
      .order('prompt_at', { ascending: true })

    if (!isAdmin) {
      query = query.eq('closer_user_id', user.id)
    } else {
      query = query.eq('org_id', profile.org_id)
    }

    const { data: prompts, error } = await query

    if (error) {
      console.error('Prompts fetch error:', error)
      return NextResponse.json({ error: 'Failed to fetch prompts' }, { status: 500 })
    }

    // Also get the setter info for each appointment
    const promptsWithSetters = await Promise.all(
      (prompts || []).map(async (prompt) => {
        if (prompt.scheduled_appointments?.canvasser_user_id) {
          const { data: setter } = await supabase
            .from('users')
            .select('full_name')
            .eq('id', prompt.scheduled_appointments.canvasser_user_id)
            .single()
          
          return {
            ...prompt,
            scheduled_appointments: {
              ...prompt.scheduled_appointments,
              setter,
            }
          }
        }
        return prompt
      })
    )

    return NextResponse.json({ prompts: promptsWithSetters })

  } catch (error) {
    console.error('Get prompts error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
