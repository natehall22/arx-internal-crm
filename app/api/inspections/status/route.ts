import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { InspectionOutcome } from '@/lib/types/database'

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function getSessionFromRequest(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
  const cookieName = `sb-${projectRef}-auth-token`
  
  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      return JSON.parse(singleCookie.value)
    } catch {
      return null
    }
  }
  
  const chunks: string[] = []
  let i = 0
  while (true) {
    const chunk = req.cookies.get(`${cookieName}.${i}`)
    if (!chunk?.value) break
    chunks.push(chunk.value)
    i++
  }
  
  if (chunks.length > 0) {
    try {
      return JSON.parse(chunks.join(''))
    } catch {
      return null
    }
  }
  
  return null
}

export async function POST(request: NextRequest) {
  try {
    const sessionData = getSessionFromRequest(request)
    
    if (!sessionData?.access_token) {
      console.log('=== AUTH FAILED: No session data ===')
      return NextResponse.json({ error: 'Unauthorized - no session' }, { status: 401 })
    }
    
    // Verify the token
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const authClient = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${sessionData.access_token}` } },
    })
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(sessionData.access_token)
    if (userError || !user) {
      console.log('=== AUTH FAILED: Invalid token ===', userError)
      return NextResponse.json({ error: 'Unauthorized - invalid token' }, { status: 401 })
    }

    const supabase = getAdminClient()

    const { data: profile } = await supabase
      .from('users')
      .select('org_id, full_name')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      console.log('=== AUTH FAILED: No profile ===')
      return NextResponse.json({ error: 'Profile not found' }, { status: 400 })
    }

    const body = await request.json()
    const { 
      appointment_id, 
      lead_id: directLeadId,
      outcome, 
      notes, 
      setter_feedback,
      schedule_follow_up,
      follow_up_date,
    } = body as {
      appointment_id?: string
      lead_id?: string
      outcome: InspectionOutcome
      notes?: string
      setter_feedback?: string
      schedule_follow_up?: boolean
      follow_up_date?: string
    }

    if ((!appointment_id && !directLeadId) || !outcome) {
      return NextResponse.json({ error: 'Missing required fields (need appointment_id or lead_id, and outcome)' }, { status: 400 })
    }

    console.log('=== INSPECTION STATUS UPDATE ===')
    console.log('Appointment ID:', appointment_id)
    console.log('Direct Lead ID:', directLeadId)
    console.log('Outcome:', outcome)
    console.log('Notes:', notes)
    console.log('Setter Feedback:', setter_feedback)

    let appointment: any = null
    let lead: any = null
    let opportunity: any = null

    if (appointment_id) {
      // Get appointment details
      const { data: appointmentData, error: appointmentError } = await supabase
        .from('scheduled_appointments')
        .select('*, leads(*), opportunities(*)')
        .eq('id', appointment_id)
        .single()

      if (appointmentError || !appointmentData) {
        // Appointment was deleted - mark the prompt as completed so it doesn't keep showing
        console.log(`Appointment ${appointment_id} not found - marking prompt as completed`)
        await supabase
          .from('pending_status_prompts')
          .update({ completed: true })
          .eq('appointment_id', appointment_id)
        
        // If we have a lead_id fallback, use that instead of returning early
        if (directLeadId) {
          console.log(`Falling back to lead_id: ${directLeadId}`)
          const { data: leadData, error: leadError } = await supabase
            .from('leads')
            .select('*')
            .eq('id', directLeadId)
            .eq('org_id', profile.org_id)
            .single()

          if (leadError || !leadData) {
            console.log(`Lead ${directLeadId} not found either`)
            return NextResponse.json({ error: 'Neither appointment nor lead found' }, { status: 404 })
          }
          
          lead = leadData

          // Try to find associated opportunity
          const { data: opportunityData } = await supabase
            .from('opportunities')
            .select('*')
            .eq('lead_id', directLeadId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          
          opportunity = opportunityData
        } else {
          // No lead_id fallback - return success so the UI can move on
          return NextResponse.json({ 
            success: true, 
            message: 'Appointment no longer exists - prompt dismissed',
            skipped: true 
          })
        }
      } else {
        appointment = appointmentData
        lead = appointmentData.leads
        opportunity = appointmentData.opportunities
      }
    } else if (directLeadId) {
      // Direct lead update without appointment - fetch lead and opportunity
      const { data: leadData, error: leadError } = await supabase
        .from('leads')
        .select('*')
        .eq('id', directLeadId)
        .eq('org_id', profile.org_id)
        .single()

      if (leadError || !leadData) {
        console.log(`Lead ${directLeadId} not found`)
        return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
      }
      
      lead = leadData

      // Try to find associated opportunity
      const { data: opportunityData } = await supabase
        .from('opportunities')
        .select('*')
        .eq('lead_id', directLeadId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      
      opportunity = opportunityData
    }

    // Fetch org settings to check if this outcome should create an opportunity
    const { data: orgData } = await supabase
      .from('orgs')
      .select('settings')
      .eq('id', profile.org_id)
      .single()
    
    const inspectionOutcomes = orgData?.settings?.inspection_outcomes || []
    const outcomeConfig = inspectionOutcomes.find((o: any) => o.id === outcome)
    const shouldCreateOpportunity = outcomeConfig?.converts_to_opportunity ?? false
    
    console.log('Outcome config:', outcomeConfig)
    console.log('Should create opportunity:', shouldCreateOpportunity)

    const leadId = appointment?.lead_id || directLeadId
    let opportunityId = appointment?.opportunity_id || opportunity?.id
    let createdOpportunity = null

    // Create opportunity if outcome is configured to do so and no opportunity exists
    if (shouldCreateOpportunity && !opportunityId && leadId) {
      console.log('Creating opportunity from inspection outcome...')
      
      const { data: newOpportunity, error: oppError } = await supabase
        .from('opportunities')
        .insert({
          org_id: profile.org_id,
          lead_id: leadId,
          customer_id: lead?.customer_id || null,
          owner_user_id: user.id,
          status: outcome === 'sale' ? 'won' : outcome === 'moving_to_close' ? 'negotiation' : 'open',
          source: lead?.source || 'inspection',
          project_type: 'roofing',
          inspection_outcome: outcome,
          inspection_outcome_at: new Date().toISOString(),
          inspection_notes: notes || null,
        })
        .select()
        .single()

      if (oppError) {
        console.error('Failed to create opportunity:', oppError)
      } else {
        opportunityId = newOpportunity.id
        createdOpportunity = newOpportunity
        console.log('Created opportunity:', newOpportunity.id)
        
        // Update the lead to link to the new opportunity
        await supabase
          .from('leads')
          .update({ status: 'won' })
          .eq('id', leadId)
      }
    }

    // Create status update record
    const { data: statusUpdate, error: statusError } = await supabase
      .from('inspection_status_updates')
      .insert({
        org_id: profile.org_id,
        appointment_id: appointment_id || null,
        opportunity_id: opportunityId || null,
        lead_id: leadId,
        closer_user_id: user.id,
        setter_user_id: appointment?.canvasser_user_id || lead?.owner_user_id || null,
        outcome,
        notes: notes || null,
        setter_feedback: setter_feedback || null,
        prompted_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (statusError) {
      console.error('=== STATUS UPDATE INSERT FAILED ===')
      console.error('Error:', statusError)
      console.error('Insert data:', {
        org_id: profile.org_id,
        appointment_id: appointment_id || null,
        opportunity_id: opportunityId || null,
        lead_id: leadId,
        closer_user_id: user.id,
        setter_user_id: appointment?.canvasser_user_id || lead?.owner_user_id || null,
        outcome,
        notes: notes || null,
        setter_feedback: setter_feedback || null,
      })
      return NextResponse.json({ error: `Failed to create status update: ${statusError.message}` }, { status: 500 })
    }
    
    console.log('=== STATUS UPDATE CREATED ===')
    console.log('Status Update ID:', statusUpdate?.id)
    console.log('Saved outcome:', statusUpdate?.outcome)
    console.log('Saved notes:', statusUpdate?.notes)

    // Update appointment status if we have one
    if (appointment_id) {
      await supabase
        .from('scheduled_appointments')
        .update({ 
          status: outcome === 'sale' ? 'completed' : outcome === 'not_home' ? 'no_show' : 'completed'
        })
        .eq('id', appointment_id)
    }

    // Update existing opportunity with outcome (if it existed before or wasn't just created)
    if (opportunityId && !createdOpportunity) {
      const opportunityUpdate: Record<string, any> = {
        inspection_outcome: outcome,
        inspection_outcome_at: new Date().toISOString(),
        inspection_notes: notes || null,
      }

      // Update status based on outcome
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
        .eq('id', opportunityId)
    }

    // Mark pending prompt as completed (if we have an appointment)
    if (appointment_id) {
      await supabase
        .from('pending_status_prompts')
        .update({ completed: true })
        .eq('appointment_id', appointment_id)
    }

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

    const customerName = lead?.homeowner_name || 'Customer'
    const customerAddress = lead?.address_text || appointment?.address_text || ''
    
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
      appointment_id: appointment_id || null,
      opportunity_id: opportunityId || null,
      lead_id: leadId,
      outcome,
      closer_name: profile.full_name,
      notes: notes || null,
      setter_feedback: setter_feedback || null,
    }

    // Notify setter - always notify when feedback is submitted (unless closer is the setter)
    const setterUserId = appointment?.canvasser_user_id || lead?.owner_user_id
    if (setterUserId && setterUserId !== user.id) {
      console.log('Creating notification for setter:', setterUserId)
      console.log('Notification data:', {
        org_id: profile.org_id,
        recipient_user_id: setterUserId,
        actor_user_id: user.id,
        type: 'inspection_outcome',
        title: `Inspection Result: ${outcomeLabels[outcome]} - ${customerName}`,
      })
      
      const { error: notificationError } = await supabase
        .from('notifications')
        .insert({
          org_id: profile.org_id,
          recipient_user_id: setterUserId,
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
      const { data: setterProfile } = await supabase
        .from('users')
        .select('team_id')
        .eq('id', setterUserId)
        .single()
      
      if (setterProfile?.team_id) {
        const { data: setterManagers } = await supabase
          .from('users')
          .select('id')
          .eq('team_id', setterProfile.team_id)
          .in('role', ['sales_manager', 'regional_manager', 'admin'])
          .neq('id', user.id)
        
        for (const manager of setterManagers || []) {
          await supabase.from('notifications').insert({
            org_id: profile.org_id,
            recipient_user_id: manager.id,
            actor_user_id: user.id,
            type: 'inspection_outcome',
            title: `Team Inspection Result: ${outcomeLabels[outcome]}`,
            body: `${customerName} - Setter: ${setterUserId ? 'Team member' : 'N/A'}, Closer: ${profile.full_name || 'Rep'}`,
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
        opportunity_id: opportunityId || null,
        lead_id: leadId,
        user_id: user.id,
        type: 'status_change',
        body: `Inspection completed: ${outcome}${notes ? ` - ${notes}` : ''}`,
      })

    // Mark the pending status prompt as completed (if we have an appointment)
    if (appointment_id) {
      await supabase
        .from('pending_status_prompts')
        .update({ completed: true })
        .eq('appointment_id', appointment_id)
    }

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
          lead_id: leadId,
          opportunity_id: opportunityId || null,
          closer_user_id: user.id,
          canvasser_user_id: appointment?.canvasser_user_id || lead?.owner_user_id || null,
          scheduled_for: followUpDateTime.toISOString(),
          duration_minutes: appointment?.duration_minutes || 60,
          address_text: appointment?.address_text || lead?.address_text || null,
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
    const sessionData = getSessionFromRequest(request)
    
    if (!sessionData?.access_token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    // Verify the token
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const authClient = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${sessionData.access_token}` } },
    })
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(sessionData.access_token)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getAdminClient()

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
          leads(id, homeowner_name, address_text)
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
