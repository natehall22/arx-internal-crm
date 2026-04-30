import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  getInsideSalesCallability,
  getInsideSalesFollowUpKind,
  HANDOFF_INSIDE_SALES_PIPELINE_PREFIX,
  isInsideSalesRoleLike,
} from '@/lib/inside-sales-follow-up'
import {
  getInspectionOutcomeConfig,
  mergeOrgInspectionOutcomesWithDefaults,
  normalizeInspectionOutcomeId,
} from '@/lib/inspection-outcomes'
import {
  mapLatestInspectionByLeadId,
  mapLatestInspectionByOpportunityId,
  withEffectiveInspectionFields,
} from '@/lib/effective-inspection-state'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.error('CRON_SECRET env var not set — promote-insurance-follow-ups will not run')
    return NextResponse.json({ error: 'Cron endpoint not configured' }, { status: 503 })
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createServiceClient()
  const nowIso = new Date().toISOString()
  const orgSettingsByOrgId = new Map<string, any>()
  const insideSalesUsersByOrgId = new Map<string, any[]>()

  try {
    const { data: candidates, error: fetchError } = await admin
      .from('opportunities')
      .select('id, org_id, lead_id, status, assigned_user_id, follow_up_at, inspection_outcome, inspection_outcome_at, pipeline_stage, leads(homeowner_name, phone, address_text)')
      .neq('status', 'won')
      .neq('status', 'lost')
      .limit(8000)

    if (fetchError) {
      console.error('promote-insurance-follow-ups: fetch error', fetchError)
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    const rawCandidates = candidates || []
    const opportunityIds = rawCandidates.map((opportunity: any) => opportunity.id)
    const leadIds = rawCandidates.map((opportunity: any) => opportunity.lead_id).filter(Boolean)

    let inspectionByOpportunityId = new Map<string, { outcome: string; notes: string | null; created_at: string }>()
    if (opportunityIds.length > 0) {
      const { data: opportunityInspectionRows } = await admin
        .from('inspection_status_updates')
        .select('opportunity_id, lead_id, outcome, notes, created_at')
        .in('opportunity_id', opportunityIds)
        .order('created_at', { ascending: false })
      inspectionByOpportunityId = mapLatestInspectionByOpportunityId(opportunityInspectionRows || [])
    }

    let inspectionByLeadId = new Map<string, { outcome: string; notes: string | null; created_at: string }>()
    if (leadIds.length > 0) {
      const { data: leadInspectionRows } = await admin
        .from('inspection_status_updates')
        .select('opportunity_id, lead_id, outcome, notes, created_at')
        .in('lead_id', leadIds)
        .order('created_at', { ascending: false })
      inspectionByLeadId = mapLatestInspectionByLeadId(leadInspectionRows || [])
    }

    const overdueOpportunities: any[] = []

    for (const rawOpportunity of rawCandidates) {
      const opportunity = withEffectiveInspectionFields(
        rawOpportunity,
        inspectionByOpportunityId,
        inspectionByLeadId
      )
      const outcomeId = normalizeInspectionOutcomeId(opportunity.inspection_outcome)
      if (!outcomeId || outcomeId === 'sale') continue
      let orgSettings = orgSettingsByOrgId.get(opportunity.org_id)
      if (orgSettings === undefined) {
        const { data: orgRow } = await admin
          .from('orgs')
          .select('settings')
          .eq('id', opportunity.org_id)
          .maybeSingle()
        orgSettings = orgRow?.settings ?? null
        orgSettingsByOrgId.set(opportunity.org_id, orgSettings)
      }

      const inspectionOutcomeRows = mergeOrgInspectionOutcomesWithDefaults(
        orgSettings?.inspection_outcomes
      )
      const pipelineStage = String(opportunity.pipeline_stage || '').trim().toLowerCase()
      if (
        pipelineStage === HANDOFF_INSIDE_SALES_PIPELINE_PREFIX ||
        pipelineStage.startsWith(`${HANDOFF_INSIDE_SALES_PIPELINE_PREFIX}_`)
      ) {
        continue
      }

      const followUpKind = getInsideSalesFollowUpKind(opportunity, inspectionOutcomeRows)
      const callability = getInsideSalesCallability(opportunity, inspectionOutcomeRows)
      if (followUpKind !== 'handoff' || !callability?.callableNow) {
        continue
      }

      overdueOpportunities.push({
        ...opportunity,
        handoffDelayDays: callability.adminHandoffDelayDays,
        outcomeLabel:
          getInspectionOutcomeConfig(inspectionOutcomeRows, opportunity.inspection_outcome)?.label ||
          String(opportunity.inspection_outcome).replace(/_/g, ' '),
      })
    }

    if (overdueOpportunities.length === 0) {
      return NextResponse.json({ promoted: 0, message: 'Nothing to promote' })
    }

    let promoted = 0

    for (const opportunity of overdueOpportunities) {
      const { data: newerInspectionAppointment } = await admin
        .from('scheduled_appointments')
        .select('id')
        .eq('org_id', opportunity.org_id)
        .eq('appointment_type', 'inspection')
        .neq('status', 'cancelled')
        .eq('opportunity_id', opportunity.id)
        .gt('scheduled_for', opportunity.inspection_outcome_at || '1970-01-01T00:00:00.000Z')
        .limit(1)
        .maybeSingle()

      if (newerInspectionAppointment?.id) {
        continue
      }

      const { data: updatedOpportunity, error: updateError } = await admin
        .from('opportunities')
        .update({
          pipeline_stage: HANDOFF_INSIDE_SALES_PIPELINE_PREFIX,
          assigned_user_id: null,
          follow_up_at: nowIso,
        })
        .eq('id', opportunity.id)
        .eq('org_id', opportunity.org_id)
        .select('id')
        .maybeSingle()

      if (updateError) {
        console.error('promote-insurance-follow-ups: update error', opportunity.id, updateError)
        continue
      }

      if (!updatedOpportunity) {
        continue
      }

      promoted += 1

      await admin.from('activities').insert({
        org_id: opportunity.org_id,
        opportunity_id: opportunity.id,
        lead_id: opportunity.lead_id,
        user_id: null,
        type: 'status_change',
        body: `${opportunity.outcomeLabel} automatically moved to inside sales after ${opportunity.handoffDelayDays} days.`,
      })

      let insideSalesUsers = insideSalesUsersByOrgId.get(opportunity.org_id)
      if (insideSalesUsers === undefined) {
        const { data: fetchedInsideSalesUsers } = await admin
          .from('users')
          .select('id, role, active, custom_roles(name, display_name)')
          .eq('org_id', opportunity.org_id)
          .eq('active', true)
        insideSalesUsers = fetchedInsideSalesUsers || []
        insideSalesUsersByOrgId.set(opportunity.org_id, insideSalesUsers)
      }

      const customer = Array.isArray(opportunity.leads) ? opportunity.leads[0] : opportunity.leads
      const customerName = customer?.homeowner_name || 'Customer'
      const customerAddress = customer?.address_text || ''
      const customerPhone = customer?.phone || ''

      const insideSalesRecipients = (insideSalesUsers || []).filter((candidate: any) => {
        const customRole = Array.isArray(candidate.custom_roles)
          ? candidate.custom_roles[0]
          : candidate.custom_roles

        return isInsideSalesRoleLike({
          role: candidate.role,
          customRoleName: customRole?.name || null,
          customRoleDisplayName: customRole?.display_name || null,
        })
      })

      if (insideSalesRecipients.length > 0) {
        await admin.from('notifications').insert(
          insideSalesRecipients.map((recipient: any) => ({
            org_id: opportunity.org_id,
            recipient_user_id: recipient.id,
            actor_user_id: null,
            type: 'inside_sales_follow_up',
            title: `Inside Sales Follow-Up: ${customerName}`,
            body: [
              `Customer: ${customerName}`,
              customerAddress ? `Address: ${customerAddress}` : null,
              customerPhone ? `Phone: ${customerPhone}` : null,
              `Reason: ${opportunity.outcomeLabel} aged into inside sales after ${opportunity.handoffDelayDays} days`,
            ]
              .filter(Boolean)
              .join('\n'),
            data: {
              opportunity_id: opportunity.id,
              lead_id: opportunity.lead_id,
              queue_type: normalizeInspectionOutcomeId(opportunity.inspection_outcome) || 'inspection_follow_up',
              pipeline_stage: HANDOFF_INSIDE_SALES_PIPELINE_PREFIX,
              automated: true,
            },
          }))
        )
      }
    }

    console.log(`promote-insurance-follow-ups: promoted ${promoted} opportunities`)
    return NextResponse.json({ promoted })
  } catch (err) {
    console.error('promote-insurance-follow-ups: unexpected error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
