import { requireAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { assignNextAvailableCloser, getDefaultTeam } from '@/lib/round-robin'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function POST(request: Request) {
  const { profile } = await requireAuth()
  const supabase = getAdminClient()
  const body = await request.json().catch(() => ({}))

  const leadId = String(body.lead_id || '')
  let closerUserId = body.closer_user_id ? String(body.closer_user_id) : null
  const scheduleInspection = Boolean(body.schedule_inspection)
  const inspectionScheduledFor = body.inspection_scheduled_for
    ? new Date(body.inspection_scheduled_for).toISOString()
    : null
  const useRoundRobin = body.use_round_robin !== false && !closerUserId && scheduleInspection

  const leadPayload: Record<string, any> = {
    homeowner_name: body.homeowner_name || null,
    phone: body.phone || null,
    email: body.email || null,
    address_text: body.address_text || null,
    lat: body.lat ?? null,
    lng: body.lng ?? null,
    notes: body.notes || null,
    canvass_disposition: body.canvass_disposition || null,
    canvass_notes: body.canvass_notes || null,
    closer_user_id: closerUserId,
    inspection_scheduled_for: inspectionScheduledFor,
  }

  if (Object.prototype.hasOwnProperty.call(body, 'source')) {
    leadPayload.source = body.source || null
  }

  if (scheduleInspection) {
    leadPayload.status = 'inspection'
    leadPayload.inspection_scheduled_at = new Date().toISOString()
    if (closerUserId) {
      leadPayload.owner_user_id = closerUserId
    }
  }

  let leadRow: any = null

  if (leadId) {
    const { data: updatedLead } = await supabase
      .from('leads')
      .update(leadPayload)
      .eq('id', leadId)
      .eq('org_id', profile.org_id)
      .select('*')
      .single()

    leadRow = updatedLead
  } else {
    const { data: createdLead } = await supabase
      .from('leads')
      .insert({
        org_id: profile.org_id,
        owner_user_id: scheduleInspection && closerUserId ? closerUserId : profile.id,
        status: scheduleInspection ? 'inspection' : 'new',
        source: body.source || 'door_to_door',
        ...leadPayload,
      })
      .select('*')
      .single()

    leadRow = createdLead
  }

  if (!leadRow) {
    return NextResponse.json({ error: 'Unable to save lead' }, { status: 400 })
  }

  let opportunityId: string | null = null
  let assignedCloserName: string | null = null
  let appointmentId: string | null = null

  // Round-robin assignment if no closer specified
  if (useRoundRobin && inspectionScheduledFor) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (supabaseUrl && supabaseServiceKey) {
      const serviceClient = createServiceClient(supabaseUrl, supabaseServiceKey)
      
      // Get user's team or default team
      const teamId = profile.team_id || await getDefaultTeam(serviceClient, profile.org_id)

      if (teamId) {
        const assignment = await assignNextAvailableCloser(
          supabaseUrl,
          supabaseServiceKey,
          teamId,
          new Date(inspectionScheduledFor),
          60, // duration
          leadRow.id,
          undefined, // opportunity_id - will be created below
          leadRow.address_text,
          profile.id, // canvasser
          profile.org_id
        )

        if (assignment.success && assignment.closerId) {
          closerUserId = assignment.closerId
          assignedCloserName = assignment.closerName || null
          appointmentId = assignment.appointmentId || null

          // Update lead with assigned closer
          await supabase
            .from('leads')
            .update({ 
              closer_user_id: closerUserId,
              owner_user_id: closerUserId 
            })
            .eq('id', leadRow.id)
        }
      }
    }
  }

  if (scheduleInspection) {
    const { data: existingOpportunity } = await supabase
      .from('opportunities')
      .select('id')
      .eq('lead_id', leadRow.id)
      .maybeSingle()

    if (existingOpportunity?.id) {
      opportunityId = existingOpportunity.id
    } else {
      const { data: createdOpportunity, error: oppError } = await supabase
        .from('opportunities')
        .insert({
          org_id: profile.org_id,
          lead_id: leadRow.id,
          owner_user_id: closerUserId || leadRow.owner_user_id || profile.id,
          status: 'open',
          project_type: 'roofing',
          address_text: leadRow.address_text,
          lat: leadRow.lat,
          lng: leadRow.lng,
          notes: leadRow.notes,
        })
        .select('id')
        .single()

      if (oppError) {
        console.error('Opportunity creation error:', oppError)
      }
      opportunityId = createdOpportunity?.id ?? null

      // Update appointment with opportunity_id
      if (appointmentId && opportunityId) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (supabaseUrl && supabaseServiceKey) {
          const serviceClient = createServiceClient(supabaseUrl, supabaseServiceKey)
          await serviceClient
            .from('scheduled_appointments')
            .update({ opportunity_id: opportunityId })
            .eq('id', appointmentId)
        }
      }
    }
  }

  if (scheduleInspection) {
    const activityBody = assignedCloserName 
      ? `Inspection scheduled from canvassing. Assigned to ${assignedCloserName} via round-robin.`
      : 'Inspection scheduled from canvassing.'
    
    await supabase.from('activities').insert({
      org_id: profile.org_id,
      lead_id: leadRow.id,
      user_id: profile.id,
      type: 'status_change',
      body: activityBody,
    })
  }

  if (opportunityId) {
    await supabase.from('activities').insert({
      org_id: profile.org_id,
      opportunity_id: opportunityId,
      user_id: profile.id,
      type: 'status_change',
      body: 'Opportunity created from canvassing inspection.',
    })
  }

  return NextResponse.json({
    lead_id: leadRow.id,
    opportunity_id: opportunityId,
    assigned_closer: assignedCloserName,
    appointment_id: appointmentId,
  })
}
