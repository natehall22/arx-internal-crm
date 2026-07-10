import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  DIDNT_SIT_PIPELINE_PREFIX,
  getInsideSalesCallability,
  getInsideSalesFollowUpKind,
  HANDOFF_INSIDE_SALES_PIPELINE_PREFIX,
  hasActiveInsideSalesFollowUp,
  isInsideSalesRoleLike,
  KNOCKBACK_PIPELINE_PREFIX,
} from '@/lib/inside-sales-follow-up'
import {
  RETIRE_MIN_ATTEMPTS,
  RETIRE_QUIET_DAYS,
  shouldAutoRetire,
} from '@/lib/inside-sales-priority'
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
    const retireCandidates: any[] = []

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
      const alreadyInInsideSalesQueue =
        pipelineStage === HANDOFF_INSIDE_SALES_PIPELINE_PREFIX ||
        pipelineStage.startsWith(`${HANDOFF_INSIDE_SALES_PIPELINE_PREFIX}_`) ||
        pipelineStage === DIDNT_SIT_PIPELINE_PREFIX ||
        pipelineStage.startsWith(`${DIDNT_SIT_PIPELINE_PREFIX}_`) ||
        pipelineStage === KNOCKBACK_PIPELINE_PREFIX ||
        pipelineStage.startsWith(`${KNOCKBACK_PIPELINE_PREFIX}_`)

      const followUpKind = getInsideSalesFollowUpKind(opportunity, inspectionOutcomeRows)
      const callability = getInsideSalesCallability(opportunity, inspectionOutcomeRows)

      // Only retire leads already in the inside-sales queue — not rep-working rows due for promotion.
      if (
        followUpKind &&
        callability?.callableNow &&
        hasActiveInsideSalesFollowUp(opportunity, inspectionOutcomeRows) &&
        alreadyInInsideSalesQueue
      ) {
        retireCandidates.push({ ...opportunity, followUpKind })
      }

      if (alreadyInInsideSalesQueue) {
        continue
      }

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

    let promoted = 0
    const promotedIds = new Set<string>()

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
      promotedIds.add(opportunity.id)

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

    // Auto-retire: 6+ logged attempts, quiet for 7+ days, no future follow-up → unresponsive.
    // Never touches never-attempted leads.
    let retired = 0
    if (retireCandidates.length > 0) {
      const retireIds = retireCandidates.map((opportunity: any) => opportunity.id)
      const attemptsByOpportunityId = new Map<string, { count: number; lastAt: string | null }>()
      const { data: attemptRows } = await admin
        .from('activities')
        .select('opportunity_id, type, created_at')
        .in('opportunity_id', retireIds)
        .in('type', ['call', 'text'])
        .order('created_at', { ascending: false })

      for (const row of attemptRows || []) {
        if (!row.opportunity_id) continue
        const current = attemptsByOpportunityId.get(row.opportunity_id)
        if (current) {
          current.count += 1
        } else {
          attemptsByOpportunityId.set(row.opportunity_id, { count: 1, lastAt: row.created_at })
        }
      }

      const RETIRED_STAGE_BY_KIND: Record<string, string> = {
        didnt_sit: `${DIDNT_SIT_PIPELINE_PREFIX}_unresponsive`,
        handoff: `${HANDOFF_INSIDE_SALES_PIPELINE_PREFIX}_unresponsive`,
        knockback: `${KNOCKBACK_PIPELINE_PREFIX}_unresponsive`,
      }

      for (const opportunity of retireCandidates) {
        if (promotedIds.has(opportunity.id)) continue

        const attempts = attemptsByOpportunityId.get(opportunity.id)
        if (
          !attempts ||
          !shouldAutoRetire({
            attemptCount: attempts.count,
            lastAttemptAt: attempts.lastAt,
            followUpAt: opportunity.follow_up_at ?? null,
          })
        ) {
          continue
        }

        const retiredStage = RETIRED_STAGE_BY_KIND[opportunity.followUpKind]
        if (!retiredStage) continue

        const { error: retireError } = await admin
          .from('opportunities')
          .update({ pipeline_stage: retiredStage, follow_up_at: null })
          .eq('id', opportunity.id)
          .eq('org_id', opportunity.org_id)

        if (retireError) {
          console.error('promote-insurance-follow-ups: retire error', opportunity.id, retireError)
          continue
        }

        retired += 1
        await admin.from('activities').insert({
          org_id: opportunity.org_id,
          opportunity_id: opportunity.id,
          lead_id: opportunity.lead_id,
          user_id: null,
          type: 'status_change',
          body: `Auto-marked unresponsive: ${attempts.count} contact attempts with no response, none in the last ${RETIRE_QUIET_DAYS} days (threshold ${RETIRE_MIN_ATTEMPTS}).`,
        })
      }
    }

    console.log(`promote-insurance-follow-ups: promoted ${promoted}, retired ${retired}`)
    return NextResponse.json({ promoted, retired })
  } catch (err) {
    console.error('promote-insurance-follow-ups: unexpected error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
