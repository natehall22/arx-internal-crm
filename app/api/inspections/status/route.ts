import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import { createCalendarEvent, refreshAccessToken, type CalendarEvent } from '@/lib/google-calendar'
import { computeInspectionFeedbackPromptAt } from '@/lib/scheduling-prompt'
import { sendSetterEmail } from '@/lib/setter-email'
import { isUserActiveForTransactionalEmail } from '@/lib/user-email-eligibility'
import {
  fetchOrgAppointmentTypesFromTable,
  getCloseSlotBufferAfterFromTable,
  getCloseSlotDurationFromTable,
} from '@/lib/org-appointment-types'
import { materializeSaleFromInspectionOutcome } from '@/lib/opportunity-sale-pipeline'
import { getAccessTokenFromApiRequest } from '@/lib/supabase-api-request-auth'
import {
  DEFAULT_INSPECTION_OUTCOMES,
  getInspectionOutcomeConfig,
  getInspectionOutcomeInsideSalesHandoff,
  inspectionOutcomeRoutesToInsideSalesDidntSit,
  normalizeInspectionOutcomeId,
  normalizeInspectionOutcomeRows,
} from '@/lib/inspection-outcomes'
import {
  DIDNT_SIT_PIPELINE_PREFIX,
  HANDOFF_INSIDE_SALES_PIPELINE_PREFIX,
  REP_WORKING_HANDOFF_PIPELINE_PREFIX,
} from '@/lib/inside-sales-follow-up'

/** Supabase may return embedded FK rows as object or single-element array. */
function firstEmbeddedRow<T extends { id?: string }>(row: T | T[] | null | undefined): T | null {
  if (row == null) return null
  return Array.isArray(row) ? row[0] ?? null : row
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function followUpAtFromDelayDays(delayDays: number): string {
  return new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000).toISOString()
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

export async function POST(request: NextRequest) {
  try {
    const accessToken = getAccessTokenFromApiRequest(request)

    if (!accessToken) {
      console.log('=== AUTH FAILED: No session data ===')
      return NextResponse.json({ error: 'Unauthorized - no session' }, { status: 401 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const authClient = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    })

    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
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
          return NextResponse.json(
            {
              error:
                'Appointment not found. Pass lead_id in the request body to record inspection feedback for the lead.',
            },
            { status: 400 }
          )
        }
      } else {
        appointment = appointmentData
        lead = firstEmbeddedRow(appointmentData.leads)
        opportunity = firstEmbeddedRow(appointmentData.opportunities)
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
    
    const hasConfiguredOutcomes = (orgData?.settings?.inspection_outcomes?.length ?? 0) > 0
    const inspectionOutcomes = normalizeInspectionOutcomeRows(
      hasConfiguredOutcomes ? orgData?.settings?.inspection_outcomes : DEFAULT_INSPECTION_OUTCOMES
    )
    const outcomeConfig = getInspectionOutcomeConfig(inspectionOutcomes, outcome)
    const insideSalesHandoffConfig = getInspectionOutcomeInsideSalesHandoff(inspectionOutcomes, outcome)
    const isInsuranceOutcome = normalizeInspectionOutcomeId(outcome) === 'insurance_follow_up'
    const delayedInsideSalesHandoffEnabled =
      insideSalesHandoffConfig.enabled && insideSalesHandoffConfig.delayDays !== null
    const routesToDidntSitQueue = inspectionOutcomeRoutesToInsideSalesDidntSit(inspectionOutcomes, outcome)
    const shouldCreateOpportunity =
      Boolean(outcomeConfig?.converts_to_opportunity) || delayedInsideSalesHandoffEnabled || routesToDidntSitQueue

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

    let leadId = appointment?.lead_id || directLeadId || lead?.id || null
    if (!leadId && appointment_id && !appointment) {
      const { data: apptOnly } = await supabase
        .from('scheduled_appointments')
        .select('lead_id')
        .eq('id', appointment_id)
        .maybeSingle()
      leadId = apptOnly?.lead_id ?? null
    }
    if (!leadId) {
      return NextResponse.json(
        {
          error:
            'Cannot record inspection feedback without a linked lead. Ensure the appointment has lead_id or pass lead_id.',
        },
        { status: 400 }
      )
    }

    const assignedCloserId = appointment?.closer_user_id || user.id
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
      } else if (outcome === 'moving_to_close' || delayedInsideSalesHandoffEnabled) {
        newStatus = 'in_progress'
      }
      
      // owner = assigned closer on the appointment; fall back to current user only if unknown
      const closerForOpp = assignedCloserId
      // setter = canvasser who set the appointment; fall back to lead owner
      const setterForOpp = appointment?.canvasser_user_id || lead?.owner_user_id || null

      const { data: newOpportunity, error: oppError } = await supabase
        .from('opportunities')
        .insert({
          org_id: profile.org_id,
          lead_id: leadId,
          customer_id: lead?.customer_id || null,
          owner_user_id: closerForOpp,
          setter_user_id: setterForOpp,
          status: newStatus,
          source: lead?.source || 'inspection',
          project_type: 'roofing',
          inspection_outcome: outcome,
          inspection_outcome_at: new Date().toISOString(),
          inspection_notes: notes || null,
          job_source: isInsuranceOutcome ? 'insurance' : 'retail',
          insurance_stage: isInsuranceOutcome ? 'contingency_signed' : null,
          pipeline_stage: delayedInsideSalesHandoffEnabled
            ? (insideSalesHandoffConfig.delayDays || 0) > 0
              ? REP_WORKING_HANDOFF_PIPELINE_PREFIX
              : HANDOFF_INSIDE_SALES_PIPELINE_PREFIX
            : routesToDidntSitQueue
              ? DIDNT_SIT_PIPELINE_PREFIX
              : null,
          follow_up_at: delayedInsideSalesHandoffEnabled
            ? followUpAtFromDelayDays(insideSalesHandoffConfig.delayDays || 0)
            : null,
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

    // Create status update record (closer = assigned rep on the appointment, not necessarily submitter)
    const { data: statusUpdate, error: statusError } = await supabase
      .from('inspection_status_updates')
      .insert({
        org_id: profile.org_id,
        appointment_id: appointment_id || null,
        opportunity_id: opportunityId || null,
        lead_id: leadId,
        closer_user_id: assignedCloserId,
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
        closer_user_id: assignedCloserId,
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
          outcome === 'sale'
            ? 'completed'
            : inspectionOutcomeRoutesToInsideSalesDidntSit(inspectionOutcomes, outcome)
              ? 'no_show'
              : 'completed',
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
      } else if (outcome === 'moving_to_close' || delayedInsideSalesHandoffEnabled) {
        opportunityUpdate.status = 'in_progress' // Active opportunities being worked
      }
      if (delayedInsideSalesHandoffEnabled) {
        const delayDays = insideSalesHandoffConfig.delayDays || 0
        opportunityUpdate.pipeline_stage =
          delayDays > 0 ? REP_WORKING_HANDOFF_PIPELINE_PREFIX : HANDOFF_INSIDE_SALES_PIPELINE_PREFIX
        opportunityUpdate.follow_up_at = followUpAtFromDelayDays(delayDays)
        if (isInsuranceOutcome) {
          opportunityUpdate.job_source = 'insurance'
          opportunityUpdate.insurance_stage = 'contingency_signed'
        }
      } else if (routesToDidntSitQueue) {
        opportunityUpdate.pipeline_stage = DIDNT_SIT_PIPELINE_PREFIX
        opportunityUpdate.follow_up_at = null
      } else {
        opportunityUpdate.pipeline_stage = null
        opportunityUpdate.follow_up_at = null
      }
      // 'not_home' and 'rescheduled' keep status as 'open'

      // Align attribution with the scheduled appointment (manager submitter ≠ assigned closer)
      if (appointment?.closer_user_id) {
        opportunityUpdate.owner_user_id = appointment.closer_user_id
      }
      const setterFromAppt =
        appointment?.canvasser_user_id || lead?.owner_user_id || null
      if (setterFromAppt) {
        opportunityUpdate.setter_user_id = setterFromAppt
      }

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

        if (
          setterUser?.email &&
          (await isUserActiveForTransactionalEmail(getAdminClient(), setterUserId))
        ) {
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
                recipientUserId: setterUid,
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
    const accessToken = getAccessTokenFromApiRequest(request)

    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const authClient = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    })

    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
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
