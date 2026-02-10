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
      setter_feedback 
    } = body as {
      appointment_id: string
      outcome: InspectionOutcome
      notes?: string
      setter_feedback?: string
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
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
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
      return NextResponse.json({ error: 'Failed to create status update' }, { status: 500 })
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
      } else if (outcome === 'said_no' || outcome === 'failed_credit') {
        opportunityUpdate.status = 'lost'
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

    // Create notification for setter if there's feedback
    if (appointment.canvasser_user_id && (setter_feedback || outcome)) {
      const outcomeLabels: Record<InspectionOutcome, string> = {
        sale: 'Sale!',
        said_no: 'Said No',
        not_home: 'Not Home',
        failed_credit: 'Failed Credit',
        rescheduled: 'Rescheduled',
      }

      const customerName = appointment.leads?.homeowner_name || 'Customer'
      
      await supabase
        .from('notifications')
        .insert({
          org_id: profile.org_id,
          user_id: appointment.canvasser_user_id,
          type: 'inspection_outcome',
          title: `Inspection Result: ${outcomeLabels[outcome]}`,
          body: setter_feedback 
            ? `${customerName} - ${profile.full_name || 'Rep'} says: "${setter_feedback}"`
            : `${customerName} - Appointment completed by ${profile.full_name || 'Rep'}`,
          data: {
            appointment_id,
            opportunity_id: appointment.opportunity_id,
            lead_id: appointment.lead_id,
            outcome,
            closer_name: profile.full_name,
          },
        })
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

    return NextResponse.json({ 
      success: true, 
      status_update: statusUpdate,
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

    // Get pending prompts that are due
    const { data: prompts, error } = await supabase
      .from('pending_status_prompts')
      .select(`
        *,
        scheduled_appointments(
          *,
          leads(homeowner_name, address_text),
          opportunities(id)
        )
      `)
      .eq('closer_user_id', user.id)
      .eq('completed', false)
      .eq('dismissed', false)
      .lte('prompt_at', new Date().toISOString())
      .order('prompt_at', { ascending: true })

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
