import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import { createCalendarEvent, refreshAccessToken, type CalendarEvent } from '@/lib/google-calendar'
import { computeInspectionFeedbackPromptAt } from '@/lib/scheduling-prompt'
import { sendSetterEmail } from '@/lib/setter-email'
import {
  fetchOrgAppointmentTypesFromTable,
  getCloseSlotBufferAfterFromTable,
  getCloseSlotDurationFromTable,
} from '@/lib/org-appointment-types'
import { materializeSaleFromInspectionOutcome } from '@/lib/opportunity-sale-pipeline'

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function getValidAccessToken(adminClient: ReturnType<typeof getAdminClient>, userId: string): Promise<string | null> {
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

async function getTimezoneForUser(adminClient: ReturnType<typeof getAdminClient>, userId: string): Promise<string> {
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
  } catch {
    /* use default */
  }
  return 'America/New_York'
}

/** Parse client follow-up datetime (YYYY-MM-DDTHH:MM or with seconds) for Google Calendar local dateTime. */
function localDateTimeFromFollowUpInput(followUp: string): string | null {
  const s = String(followUp).trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{2})(?::\d{2})?/)
  if (!m) return null
  const hh = m[2].padStart(2, '0')
  const mm = m[3].padStart(2, '0')
  return `${m[1]}T${hh}:${mm}`
}

async function upsertPendingInspectionPrompt(
  supabase: ReturnType<typeof getAdminClient>,
  params: {
    orgId: string
    appointmentId: string
    closerUserId: string
    scheduledForIso: string
    durationMinutes: number
    bufferAfterMinutes?: number
    orgFeedbackBufferMinutes: number
  }
) {
  const promptAt = computeInspectionFeedbackPromptAt(
    params.scheduledForIso,
    params.durationMinutes,
    params.bufferAfterMinutes ?? 0,
    params.orgFeedbackBufferMinutes
  )
  const { error } = await supabase.from('pending_status_prompts').upsert(
    {
      org_id: params.orgId,
      appointment_id: params.appointmentId,
      closer_user_id: params.closerUserId,
      prompt_at: promptAt,
      completed: false,
      dismissed: false,
    },
    { onConflict: 'appointment_id' }
  )
  if (error) {
    console.error('upsertPendingInspectionPrompt:', error)
  }
}

function getMailTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })
}

function getSessionFromRequest(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
  const cookieName = `sb-${projectRef}-auth-token`
  
  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      const decoded = decodeURIComponent(singleCookie.value)
      return JSON.parse(decoded)
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
      const decoded = decodeURIComponent(chunks.join(''))
      return JSON.parse(decoded)
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
      outcome: string
      notes?: string
      setter_feedback?: string
      schedule_follow_up?: boolean
      follow_up_date?: string
    }

    let { data: profile } = await supabase
      .from('users')
      .select('org_id, full_name')
      .eq('id', user.id)
      .single()

    // Self-heal environments where auth user exists but public.users row is missing.
    if (!profile?.org_id) {
      let derivedOrgId: string | null = null

      if (appointment_id) {
        const { data: apptOrg } = await supabase
          .from('scheduled_appointments')
          .select('org_id')
          .eq('id', appointment_id)
          .maybeSingle()
        derivedOrgId = apptOrg?.org_id || null
      }

      if (!derivedOrgId && directLeadId) {
        const { data: leadOrg } = await supabase
          .from('leads')
          .select('org_id')
          .eq('id', directLeadId)
          .maybeSingle()
        derivedOrgId = leadOrg?.org_id || null
      }

      if (!derivedOrgId) {
        console.log('=== AUTH FAILED: No profile and unable to derive org ===')
        return NextResponse.json({ error: 'Profile not found' }, { status: 400 })
      }

      const fallbackName =
        (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()) ||
        user.email ||
        'User'

      const { data: recoveredProfile } = await supabase
        .from('users')
        .upsert(
          {
            id: user.id,
            org_id: derivedOrgId,
            role: 'rep',
            full_name: fallbackName,
            email: user.email || null,
            active: true,
          },
          { onConflict: 'id' }
        )
        .select('org_id, full_name')
        .single()

      profile = recoveredProfile || { org_id: derivedOrgId, full_name: fallbackName }
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

    if (outcome === 'insurance_follow_up') {
      if (!schedule_follow_up || !follow_up_date) {
        return NextResponse.json(
          { error: 'Insurance follow-up requires a scheduled date and time' },
          { status: 400 }
        )
      }
    }

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

    // Fetch org settings + scheduling columns (feedback buffer, default gap)
    const { data: orgData } = await supabase
      .from('orgs')
      .select('settings, inspection_feedback_buffer_minutes, default_scheduling_gap_minutes')
      .eq('id', profile.org_id)
      .single()

    const orgScheduling = {
      inspection_feedback_buffer_minutes: orgData?.inspection_feedback_buffer_minutes ?? 0,
      default_scheduling_gap_minutes: orgData?.default_scheduling_gap_minutes ?? 15,
    }
    
    // Default inspection outcomes used only when org settings are missing.
    // Match requested baseline: sale, moving_to_close, insurance_follow_up.
    const defaultInspectionOutcomes = [
      { id: 'sale', converts_to_opportunity: true },
      { id: 'moving_to_close', converts_to_opportunity: true },
      { id: 'insurance_follow_up', converts_to_opportunity: true },
      { id: 'said_no', converts_to_opportunity: false },
      { id: 'not_home', converts_to_opportunity: false },
      { id: 'no_problems_found', converts_to_opportunity: false },
      { id: 'needs_repair', converts_to_opportunity: false },
      { id: 'rescheduled', converts_to_opportunity: false },
    ]
    
    // Use org settings when present so admins fully control opportunity creation behavior.
    const hasConfiguredOutcomes = (orgData?.settings?.inspection_outcomes?.length ?? 0) > 0
    const inspectionOutcomes = hasConfiguredOutcomes
      ? orgData!.settings.inspection_outcomes 
      : defaultInspectionOutcomes
    const outcomeConfig = inspectionOutcomes.find(
      (o: any) => String(o.id || '').toLowerCase() === String(outcome || '').toLowerCase()
    )
    const shouldCreateOpportunity = Boolean(outcomeConfig?.converts_to_opportunity)

    const staticOutcomeLabels: Record<string, string> = {
      sale: 'Sale!',
      said_no: 'Said No',
      not_home: 'Not Home',
      needs_repair: 'Needs Repair',
      rescheduled: 'Rescheduled',
      no_problems_found: 'No Problems Found',
      moving_to_close: 'Moving to Close',
      insurance_follow_up: 'Insurance Follow Up',
    }
    const outcomeDisplayLabel =
      typeof outcomeConfig?.label === 'string' && outcomeConfig.label.trim()
        ? outcomeConfig.label.trim()
        : staticOutcomeLabels[String(outcome)] ?? String(outcome).replace(/_/g, ' ')
    
    console.log('Outcome config:', outcomeConfig)
    console.log('Should create opportunity:', shouldCreateOpportunity)
    console.log('Using default outcomes:', !hasConfiguredOutcomes)

    const leadId = appointment?.lead_id || directLeadId || lead?.id || null
    let opportunityId = appointment?.opportunity_id || opportunity?.id || null
    let createdOpportunity = null
    
    console.log('=== OPPORTUNITY LOOKUP ===')
    console.log('appointment?.opportunity_id:', appointment?.opportunity_id)
    console.log('opportunity?.id:', opportunity?.id)
    console.log('Final opportunityId:', opportunityId)
    console.log('leadId:', leadId)

    // Resolve stale/deleted opportunity references before create/update decisions.
    if (opportunityId) {
      const { data: existingOpportunity } = await supabase
        .from('opportunities')
        .select('id')
        .eq('id', opportunityId)
        .eq('org_id', profile.org_id)
        .maybeSingle()

      if (!existingOpportunity) {
        opportunityId = null
      }
    }

    // Create opportunity only for approved trigger outcomes and only when no opportunity exists.
    if (shouldCreateOpportunity && !opportunityId && leadId) {
      console.log('Creating opportunity from inspection outcome...')
      
      // Determine status based on outcome
      // Valid opportunity statuses: 'open', 'in_progress', 'won', 'lost'
      let newStatus: 'open' | 'in_progress' | 'won' | 'lost' = 'open'
      if (outcome === 'sale') {
        newStatus = 'won'
      } else if (outcome === 'said_no' || outcome === 'no_problems_found') {
        newStatus = 'lost'
      } else if (outcome === 'moving_to_close' || outcome === 'insurance_follow_up') {
        newStatus = 'in_progress'
      }
      
      const { data: newOpportunity, error: oppError } = await supabase
        .from('opportunities')
        .insert({
          org_id: profile.org_id,
          lead_id: leadId,
          customer_id: lead?.customer_id || null,
          owner_user_id: user.id,
          status: newStatus,
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

    // Update inspection appointment: status + opportunity so downstream schedule-close keeps
    // lead/opportunity/close linked (close_appointments + new scheduled_appointments rows use these ids).
    if (appointment_id) {
      const appointmentUpdate: Record<string, unknown> = {
        status:
          outcome === 'sale' ? 'completed' : outcome === 'not_home' ? 'no_show' : 'completed',
      }
      if (opportunityId) {
        appointmentUpdate.opportunity_id = opportunityId
      }
      await supabase.from('scheduled_appointments').update(appointmentUpdate).eq('id', appointment_id)
    }

    // Update existing opportunity with outcome (if it existed before or wasn't just created)
    if (opportunityId && !createdOpportunity) {
      const opportunityUpdate: Record<string, any> = {
        inspection_outcome: outcome,
        inspection_outcome_at: new Date().toISOString(),
        inspection_notes: notes || null,
      }

      // Update status based on outcome
      // Valid opportunity statuses: 'open', 'in_progress', 'won', 'lost'
      if (outcome === 'sale') {
        opportunityUpdate.status = 'won'
      } else if (outcome === 'said_no' || outcome === 'no_problems_found') {
        opportunityUpdate.status = 'lost'
      } else if (outcome === 'moving_to_close' || outcome === 'insurance_follow_up') {
        opportunityUpdate.status = 'in_progress' // Active opportunities being worked
      }
      // 'not_home' and 'rescheduled' keep status as 'open'

      console.log('=== UPDATING EXISTING OPPORTUNITY ===')
      console.log('opportunityId:', opportunityId)
      console.log('Update data:', opportunityUpdate)
      
      const { error: oppUpdateError } = await supabase
        .from('opportunities')
        .update(opportunityUpdate)
        .eq('id', opportunityId)
      
      if (oppUpdateError) {
        console.error('Failed to update opportunity:', oppUpdateError)
      } else {
        console.log('Successfully updated opportunity')
      }
    } else {
      console.log('=== SKIPPING OPPORTUNITY UPDATE ===')
      console.log('opportunityId:', opportunityId)
      console.log('createdOpportunity:', !!createdOpportunity)
    }

    /** Won sale → customer + project(opportunity_id) + production_jobs (idempotent). */
    let salePipeline: {
      customer_id: string | null
      project_id: string | null
      production_job_id: string | null
    } | null = null
    if (leadId && lead) {
      salePipeline = await materializeSaleFromInspectionOutcome(supabase, profile.org_id, user.id, {
        outcome,
        outcomeConfig,
        opportunityId,
        leadId,
        lead: {
          id: lead.id,
          homeowner_name: lead.homeowner_name,
          phone: lead.phone,
          email: lead.email,
          address_text: lead.address_text,
          customer_id: lead.customer_id,
        },
      })
    }

    // Mark pending prompt as completed (if we have an appointment)
    if (appointment_id) {
      await supabase
        .from('pending_status_prompts')
        .update({ completed: true })
        .eq('appointment_id', appointment_id)
    }

    // Create notifications for setter, setter's manager, and closer's manager
    const customerName = lead?.homeowner_name || 'Customer'
    const customerAddress = lead?.address_text || appointment?.address_text || ''
    
    // Build comprehensive notification body with all notes for setter
    const notificationParts: string[] = []
    notificationParts.push(`Customer: ${customerName}`)
    if (customerAddress) {
      notificationParts.push(`Address: ${customerAddress}`)
    }
    notificationParts.push(`Outcome: ${outcomeDisplayLabel}`)
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
    console.log('=== SETTER NOTIFICATION DEBUG ===')
    console.log('appointment?.canvasser_user_id:', appointment?.canvasser_user_id)
    console.log('lead?.owner_user_id:', lead?.owner_user_id)
    console.log('setterUserId:', setterUserId)
    console.log('current user.id:', user.id)
    console.log('Will create notification:', setterUserId && setterUserId !== user.id)
    
    if (setterUserId && setterUserId !== user.id) {
      console.log('Creating notification for setter:', setterUserId)
      console.log('Notification data:', {
        org_id: profile.org_id,
        recipient_user_id: setterUserId,
        actor_user_id: user.id,
        type: 'inspection_outcome',
        title: `Inspection Result: ${outcomeDisplayLabel} - ${customerName}`,
      })
      
      const { error: notificationError } = await supabase
        .from('notifications')
        .insert({
          org_id: profile.org_id,
          recipient_user_id: setterUserId,
          actor_user_id: user.id,
          type: 'inspection_outcome',
          title: `Inspection Result: ${outcomeDisplayLabel} - ${customerName}`,
          body: notificationBody,
          data: notificationData,
        })
      
      if (notificationError) {
        console.error('Failed to create setter notification:', notificationError)
      } else {
        console.log('Setter notification created successfully')
      }

      // Also email the setter with full inspection results/notes.
      try {
        const { data: setterUser } = await supabase
          .from('users')
          .select('email, full_name')
          .eq('id', setterUserId)
          .single()

        if (setterUser?.email) {
          const transporter = getMailTransport()
          const setterName = setterUser.full_name || 'Setter'
          const submittedAt = new Date().toLocaleString('en-US', {
            dateStyle: 'full',
            timeStyle: 'short',
            timeZone: 'America/New_York',
          })

          await transporter.sendMail({
            from: 'info@arxroofing.com',
            to: setterUser.email,
            subject: `Inspection update: ${outcomeDisplayLabel} - ${customerName}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #111827; margin-bottom: 16px;">Inspection Status Update</h2>
                <p style="color: #374151;">Hi ${setterName},</p>
                <p style="color: #374151;">A closer has submitted an inspection update for your appointment.</p>
                <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                  <tr><td style="padding: 8px 0; color: #6B7280; width: 180px;">Customer:</td><td style="padding: 8px 0; color: #111827;">${customerName}</td></tr>
                  <tr><td style="padding: 8px 0; color: #6B7280;">Address:</td><td style="padding: 8px 0; color: #111827;">${customerAddress || 'N/A'}</td></tr>
                  <tr><td style="padding: 8px 0; color: #6B7280;">Outcome:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${outcomeDisplayLabel}</td></tr>
                  <tr><td style="padding: 8px 0; color: #6B7280;">Closer:</td><td style="padding: 8px 0; color: #111827;">${profile.full_name || 'Rep'}</td></tr>
                  <tr><td style="padding: 8px 0; color: #6B7280;">Submitted:</td><td style="padding: 8px 0; color: #111827;">${submittedAt} ET</td></tr>
                </table>
                ${setter_feedback ? `
                  <div style="margin: 12px 0;">
                    <p style="color: #374151; font-weight: 600; margin-bottom: 6px;">Feedback for Setter:</p>
                    <div style="background: #F3F4F6; border-radius: 8px; padding: 12px; color: #111827;">${setter_feedback}</div>
                  </div>
                ` : ''}
                ${notes && notes !== setter_feedback ? `
                  <div style="margin: 12px 0;">
                    <p style="color: #374151; font-weight: 600; margin-bottom: 6px;">Internal Notes:</p>
                    <div style="background: #F9FAFB; border-radius: 8px; padding: 12px; color: #111827;">${notes}</div>
                  </div>
                ` : ''}
                <p style="color: #6B7280; font-size: 12px; margin-top: 16px;">This is an automated update from ARX CRM.</p>
              </div>
            `,
          })
        }
      } catch (emailErr) {
        // Do not fail status update if email delivery fails.
        console.error('Failed to send setter inspection email:', emailErr)
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
            title: `Team Inspection Result: ${outcomeDisplayLabel}`,
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
          title: `Team Inspection Result: ${outcomeDisplayLabel}`,
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
      
      const followUpType =
        outcome === 'insurance_follow_up' ? 'insurance_follow_up' : 'follow_up'

      const tableAptTypes = await fetchOrgAppointmentTypesFromTable(supabase, profile.org_id)
      const followSlotKind =
        followUpType === 'insurance_follow_up' ? 'insurance_follow_up' : 'follow_up'
      const bufferAfter = getCloseSlotBufferAfterFromTable(
        tableAptTypes,
        followSlotKind,
        orgScheduling.default_scheduling_gap_minutes
      )
      const followDurationMinutes = getCloseSlotDurationFromTable(
        tableAptTypes,
        followSlotKind,
        appointment?.duration_minutes ?? 60
      )

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
          duration_minutes: followDurationMinutes,
          buffer_after_minutes: bufferAfter,
          address_text: appointment?.address_text || lead?.address_text || null,
          status: 'scheduled',
          notes: `Follow-up from ${outcome}: ${notes || 'No notes'}`,
          appointment_type: followUpType,
        })
        .select()
        .single()

      if (followUpError) {
        console.error('Failed to create follow-up appointment:', followUpError)
      } else if (newAppointment) {
        followUpAppointment = newAppointment
        console.log('Created follow-up appointment:', newAppointment.id)
        const dur = newAppointment.duration_minutes || 60
        await upsertPendingInspectionPrompt(supabase, {
          orgId: profile.org_id,
          appointmentId: newAppointment.id,
          closerUserId: newAppointment.closer_user_id || user.id,
          scheduledForIso: newAppointment.scheduled_for,
          durationMinutes: dur,
          bufferAfterMinutes: bufferAfter,
          orgFeedbackBufferMinutes: orgScheduling.inspection_feedback_buffer_minutes,
        })

        // Push follow-up to the submitting closer's Google Calendar (same closer as closer_user_id).
        const closerCalendarId = user.id
        const accessToken = await getValidAccessToken(supabase, closerCalendarId)
        if (accessToken) {
          const localDateTimeStr = localDateTimeFromFollowUpInput(follow_up_date)
          if (localDateTimeStr) {
            try {
              const timezone = await getTimezoneForUser(supabase, closerCalendarId)
              const startDateTime = `${localDateTimeStr}:00`
              const [datePart, timePart] = localDateTimeStr.split('T')
              const timeOnly = timePart?.split(':') || ['00', '00']
              let endHour = parseInt(timeOnly[0], 10)
              let endMin = parseInt(timeOnly[1], 10) + dur
              while (endMin >= 60) {
                endMin -= 60
                endHour += 1
              }
              const endDateTime = `${datePart}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00`

              let setterInviteEmail: string | null = null
              const setterForCalendar = newAppointment.canvasser_user_id
              if (setterForCalendar && setterForCalendar !== closerCalendarId) {
                const { data: setterRow } = await supabase
                  .from('users')
                  .select('email')
                  .eq('id', setterForCalendar)
                  .maybeSingle()
                if (setterRow?.email && String(setterRow.email).includes('@')) {
                  setterInviteEmail = setterRow.email
                }
              }

              const summaryPrefix =
                followUpType === 'insurance_follow_up' ? 'Insurance follow-up' : 'Follow-up'
              const event: CalendarEvent = {
                summary: `${summaryPrefix}: ${customerName}`,
                description: [
                  `Customer: ${customerName}`,
                  lead?.phone ? `Phone: ${lead.phone}` : '',
                  customerAddress ? `Address: ${customerAddress}` : '',
                  '',
                  lead?.canvass_notes ? `Canvass notes:\n${lead.canvass_notes}` : '',
                  notes ? `Inspection notes:\n${notes}` : '',
                ]
                  .filter((line) => line !== undefined && line !== '')
                  .join('\n')
                  .trim(),
                location: customerAddress || undefined,
                start: { dateTime: startDateTime, timeZone: timezone },
                end: { dateTime: endDateTime, timeZone: timezone },
                attendees: setterInviteEmail ? [{ email: setterInviteEmail }] : undefined,
              }

              const createdEvent = await createCalendarEvent(
                accessToken,
                event,
                'primary',
                setterInviteEmail ? 'all' : 'none'
              )
              const googleEventId = createdEvent.id || null
              if (googleEventId) {
                await supabase
                  .from('scheduled_appointments')
                  .update({ google_event_id: googleEventId })
                  .eq('id', newAppointment.id)
                followUpAppointment = { ...newAppointment, google_event_id: googleEventId }
              }
            } catch (calendarErr) {
              console.error('Follow-up Google Calendar sync error:', calendarErr)
            }
          }
        }

        const setterUid = appointment?.canvasser_user_id || lead?.owner_user_id
        if (setterUid && setterUid !== user.id) {
          try {
            const { data: setterUser } = await supabase
              .from('users')
              .select('email, full_name')
              .eq('id', setterUid)
              .single()
            if (setterUser?.email) {
              const whenLabel = new Date(newAppointment.scheduled_for).toLocaleString('en-US', {
                timeZone: 'America/New_York',
                dateStyle: 'full',
                timeStyle: 'short',
              })
              await sendSetterEmail({
                to: setterUser.email,
                setterName: setterUser.full_name,
                subject: `Follow-up scheduled: ${customerName}`,
                introHtml: `<p style="color: #374151;">${profile.full_name || 'A closer'} scheduled a follow-up appointment for your lead.</p>`,
                rows: [
                  { label: 'Customer', value: customerName },
                  { label: 'Address', value: customerAddress || 'N/A' },
                  { label: 'Type', value: followUpType === 'insurance_follow_up' ? 'Insurance follow-up' : 'Follow-up' },
                  { label: 'Scheduled', value: `${whenLabel} ET` },
                ],
              })
            }
          } catch (e) {
            console.error('Follow-up setter email failed:', e)
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      status_update: statusUpdate,
      follow_up_appointment: followUpAppointment,
      /** Lets clients confirm linkage before calling schedule-close */
      opportunity_id: opportunityId || null,
      lead_id: leadId || null,
      /** Present when outcome was Sale: customer / project / production job ensured */
      sale_pipeline: salePipeline,
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

    // Get pending prompts that are due
    // Only show prompts where the current user is the CLOSER (not setter)
    // This is the closer feedback prompt - setters get their own notification via SetterFeedbackPrompt
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
      .eq('closer_user_id', user.id) // Always filter by closer - this is the closer's feedback prompt
      .lte('prompt_at', new Date().toISOString())
      .order('prompt_at', { ascending: true })

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
