import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  DIDNT_SIT_PIPELINE_PREFIX,
  getInsideSalesCallability,
  getInsideSalesFollowUpKind,
  HANDOFF_INSIDE_SALES_PIPELINE_PREFIX,
  hasActiveInsideSalesFollowUp,
  isActiveInsideSalesQueueStage,
  isInsideSalesRoleLike,
  KNOCKBACK_PIPELINE_PREFIX,
  STORM_PIPELINE_PREFIX,
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
import { verifyCronSecret } from '@/lib/cron-auth'
import { loadCronOrgs } from '@/lib/cron-orgs'

/**
 * One company's pass. Every read and write stays inside `orgId`: the candidate list is fetched per company
 * (one company's 8,000-row cap can no longer crowd another company out), and every follow-on query is keyed
 * by ids from that list or by `org_id`.
 */
async function promoteForOrg(
  admin: ReturnType<typeof createServiceClient>,
  orgId: string,
  orgSettings: any,
  nowIso: string
): Promise<{ promoted: number; retired: number }> {
  let promoted = 0
  let retired = 0
  let insideSalesUsers: any[] | undefined
  const { data: candidates, error: fetchError } = await admin
    .from('opportunities')
    .select('id, org_id, lead_id, status, assigned_user_id, follow_up_at, inspection_outcome, inspection_outcome_at, pipeline_stage, leads(homeowner_name, phone, address_text)')
    .eq('org_id', orgId)
    .neq('status', 'won')
    .neq('status', 'lost')
    .limit(8000)

  if (fetchError) throw new Error(`fetch error: ${fetchError.message}`)

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
    const inspectionOutcomeRows = mergeOrgInspectionOutcomesWithDefaults(
      orgSettings?.inspection_outcomes
    )
    const pipelineStage = String(opportunity.pipeline_stage || '').trim().toLowerCase()
    const alreadyInInsideSalesQueue = isActiveInsideSalesQueueStage(pipelineStage)

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

  const promotedIds = new Set<string>()

  for (const opportunity of overdueOpportunities) {
    const { data: newerInspectionAppointment } = await admin
      .from('scheduled_appointments')
      .select('id')
      .eq('org_id', orgId)
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
      .eq('org_id', orgId)
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
      org_id: orgId,
      opportunity_id: opportunity.id,
      lead_id: opportunity.lead_id,
      user_id: null,
      type: 'status_change',
      body: `${opportunity.outcomeLabel} automatically moved to inside sales after ${opportunity.handoffDelayDays} days.`,
    })

    if (insideSalesUsers === undefined) {
      const { data: fetchedInsideSalesUsers } = await admin
        .from('users')
        .select('id, role, active, custom_roles(name, display_name)')
        .eq('org_id', orgId)
        .eq('active', true)
      insideSalesUsers = fetchedInsideSalesUsers || []
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
          org_id: orgId,
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
  if (retireCandidates.length > 0) {
    const retireIds = retireCandidates.map((opportunity: any) => opportunity.id)
    const attemptsByOpportunityId = new Map<string, { count: number; lastAt: string | null }>()
    const { data: attemptRows } = await admin
      .from('activities')
      .select('opportunity_id, type, created_at')
      .in('opportunity_id', retireIds)
      .in('type', ['call', 'text'])
      // Deleted rows aren't attempts, and a logged contact where we got through (lib/customer-contact.ts) means the
      // customer is not unresponsive. Needs activities.contact_outcome (migration 202611100030).
      .is('deleted_at', null)
      .or('contact_outcome.is.null,contact_outcome.not.in.(reached,replied)')
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
      storm: `${STORM_PIPELINE_PREFIX}_unresponsive`,
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
        .eq('org_id', orgId)

      if (retireError) {
        console.error('promote-insurance-follow-ups: retire error', opportunity.id, retireError)
        continue
      }

      retired += 1
      await admin.from('activities').insert({
        org_id: orgId,
        opportunity_id: opportunity.id,
        lead_id: opportunity.lead_id,
        user_id: null,
        type: 'status_change',
        body: `Auto-marked unresponsive: ${attempts.count} contact attempts with no response, none in the last ${RETIRE_QUIET_DAYS} days (threshold ${RETIRE_MIN_ATTEMPTS}).`,
      })
    }
  }

  return { promoted, retired }
}

export async function GET(request: NextRequest) {
  const authFailure = verifyCronSecret(request, 'promote-insurance-follow-ups')
  if (authFailure) return authFailure

  const admin = createServiceClient()
  const nowIso = new Date().toISOString()

  try {
    // Only companies a background job may run for (lib/cron-orgs: active users, inside the deployment fence).
    const orgs = await loadCronOrgs(admin)
    let promoted = 0
    let retired = 0
    const failedOrgs: string[] = []
    for (const org of orgs) {
      try {
        const result = await promoteForOrg(admin, org.id, org.settings, nowIso)
        promoted += result.promoted
        retired += result.retired
      } catch (err) {
        // One company's failure must not stop the others.
        failedOrgs.push(org.id)
        console.error('promote-insurance-follow-ups: org failed', org.id, err)
      }
    }

    console.log(`promote-insurance-follow-ups: promoted ${promoted}, retired ${retired}`)
    return NextResponse.json({ orgs: orgs.length, promoted, retired, failedOrgs }, { status: failedOrgs.length ? 500 : 200 })
  } catch (err) {
    console.error('promote-insurance-follow-ups: unexpected error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
