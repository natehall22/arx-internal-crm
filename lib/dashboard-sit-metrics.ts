import type { SupabaseClient } from '@supabase/supabase-js'
import {
  mapLatestInspectionByLeadId,
  mapLatestInspectionByOpportunityId,
  mergeEffectiveInspectionFields,
  type OpportunityRowForInspectionMerge,
} from '@/lib/effective-inspection-state'
import { normalizeInspectionOutcomeId } from '@/lib/inspection-outcomes'

type OpportunityRowForSitMetrics = OpportunityRowForInspectionMerge & {
  setter_user_id?: string | null
  owner_user_id?: string | null
}

export type EffectiveSitOpportunity = {
  id: string
  lead_id: string | null
  setter_user_id: string | null
  owner_user_id: string | null
  inspection_outcome: string
  inspection_outcome_at: string
}

function isInPeriod(iso: string, startIso: string, endIso: string): boolean {
  const t = new Date(iso).getTime()
  const s = new Date(startIso).getTime()
  const e = new Date(endIso).getTime()
  return Number.isFinite(t) && t >= s && t < e
}

function countsAsSit(outcome: string | null | undefined, sitOutcomeIdSet: Set<string>): boolean {
  if (!outcome) return false
  return sitOutcomeIdSet.has(normalizeInspectionOutcomeId(outcome))
}

/**
 * Opportunities with effective inspection outcomes in [start, end), merging
 * inspection_status_updates with opportunities columns (same as opportunities list).
 */
export async function fetchEffectiveSitOpportunitiesInPeriod(
  supabase: SupabaseClient,
  opts: {
    orgId: string
    startIso: string
    endIso: string
    sitOutcomeIdSet: Set<string>
  }
): Promise<EffectiveSitOpportunity[]> {
  const { orgId, startIso, endIso, sitOutcomeIdSet } = opts
  if (sitOutcomeIdSet.size === 0) return []

  const { data: updatesInPeriod, error: updatesErr } = await supabase
    .from('inspection_status_updates')
    .select('opportunity_id, lead_id, outcome, notes, created_at')
    .eq('org_id', orgId)
    .gte('created_at', startIso)
    .lt('created_at', endIso)

  if (updatesErr) throw updatesErr

  const oppIdSet = new Set<string>()
  const leadIdSet = new Set<string>()
  const leadIdsWithSelectedOpportunity = new Set<string>()

  for (const row of updatesInPeriod || []) {
    if (row.opportunity_id) oppIdSet.add(String(row.opportunity_id))
    if (row.lead_id) leadIdSet.add(String(row.lead_id))
    if (row.opportunity_id && row.lead_id) leadIdsWithSelectedOpportunity.add(String(row.lead_id))
  }

  const { data: oppsByOutcomeAt, error: oppsErr } = await supabase
    .from('opportunities')
    .select(
      'id, lead_id, setter_user_id, owner_user_id, inspection_outcome, inspection_outcome_at, inspection_notes, updated_at, created_at'
    )
    .eq('org_id', orgId)
    .not('inspection_outcome_at', 'is', null)
    .gte('inspection_outcome_at', startIso)
    .lt('inspection_outcome_at', endIso)

  if (oppsErr) throw oppsErr

  for (const row of oppsByOutcomeAt || []) {
    oppIdSet.add(String(row.id))
    if (row.lead_id) {
      leadIdSet.add(String(row.lead_id))
      leadIdsWithSelectedOpportunity.add(String(row.lead_id))
    }
  }

  if (leadIdSet.size > 0) {
    const { data: oppsByLead, error: leadOppErr } = await supabase
      .from('opportunities')
      .select(
        'id, lead_id, setter_user_id, owner_user_id, inspection_outcome, inspection_outcome_at, inspection_notes, updated_at, created_at'
      )
      .eq('org_id', orgId)
      .in('lead_id', Array.from(leadIdSet))
      .order('created_at', { ascending: false })

    if (leadOppErr) throw leadOppErr
    for (const row of oppsByLead || []) {
      if (row.lead_id && leadIdsWithSelectedOpportunity.has(String(row.lead_id))) continue
      oppIdSet.add(String(row.id))
      if (row.lead_id) {
        leadIdSet.add(String(row.lead_id))
        leadIdsWithSelectedOpportunity.add(String(row.lead_id))
      }
    }
  }

  if (oppIdSet.size === 0) return []

  const { data: opportunities, error: fetchOppErr } = await supabase
    .from('opportunities')
    .select(
      'id, lead_id, setter_user_id, owner_user_id, inspection_outcome, inspection_outcome_at, inspection_notes, updated_at, created_at'
    )
    .eq('org_id', orgId)
    .in('id', Array.from(oppIdSet))

  if (fetchOppErr) throw fetchOppErr

  const oppRows = (opportunities || []) as OpportunityRowForSitMetrics[]
  const allLeadIds = Array.from(
    new Set(oppRows.map((o) => o.lead_id).filter(Boolean) as string[])
  )

  let statusRows: {
    opportunity_id?: string | null
    lead_id?: string | null
    outcome?: string | null
    notes?: string | null
    created_at: string
  }[] = []

  if (oppIdSet.size > 0) {
    const { data: byOpp, error: statusOppErr } = await supabase
      .from('inspection_status_updates')
      .select('opportunity_id, lead_id, outcome, notes, created_at')
      .eq('org_id', orgId)
      .in('opportunity_id', Array.from(oppIdSet))
      .order('created_at', { ascending: false })

    if (statusOppErr) throw statusOppErr
    statusRows = byOpp || []
  }

  if (allLeadIds.length > 0) {
    const { data: byLead, error: statusLeadErr } = await supabase
      .from('inspection_status_updates')
      .select('opportunity_id, lead_id, outcome, notes, created_at')
      .eq('org_id', orgId)
      .in('lead_id', allLeadIds)
      .order('created_at', { ascending: false })

    if (statusLeadErr) throw statusLeadErr
    statusRows = [...statusRows, ...(byLead || [])]
  }
  statusRows.sort((a, b) => {
    const bt = new Date(b.created_at).getTime()
    const at = new Date(a.created_at).getTime()
    return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0)
  })

  const inspectionByOpportunityId = mapLatestInspectionByOpportunityId(statusRows)
  const inspectionByLeadId = mapLatestInspectionByLeadId(statusRows)

  const results: EffectiveSitOpportunity[] = []

  for (const opp of oppRows) {
    const merged = mergeEffectiveInspectionFields(
      opp,
      inspectionByOpportunityId,
      inspectionByLeadId
    )
    if (
      !merged.inspection_outcome ||
      !merged.inspection_outcome_at ||
      !isInPeriod(merged.inspection_outcome_at, startIso, endIso) ||
      !countsAsSit(merged.inspection_outcome, sitOutcomeIdSet)
    ) {
      continue
    }

    results.push({
      id: String(opp.id),
      lead_id: opp.lead_id ? String(opp.lead_id) : null,
      setter_user_id: opp.setter_user_id ? String(opp.setter_user_id) : null,
      owner_user_id: opp.owner_user_id ? String(opp.owner_user_id) : null,
      inspection_outcome: merged.inspection_outcome,
      inspection_outcome_at: merged.inspection_outcome_at,
    })
  }

  return results
}

export function countSitsBySetter(
  sitOpportunities: EffectiveSitOpportunity[],
  memberIds: string[]
): Map<string, number> {
  const memberSet = new Set(memberIds)
  const counts = new Map<string, number>()
  for (const opp of sitOpportunities) {
    const setterId = opp.setter_user_id
    if (!setterId || !memberSet.has(setterId)) continue
    counts.set(setterId, (counts.get(setterId) || 0) + 1)
  }
  return counts
}

export function countSitsByOwner(
  sitOpportunities: EffectiveSitOpportunity[],
  memberIds: string[]
): Map<string, number> {
  const memberSet = new Set(memberIds)
  const counts = new Map<string, number>()
  for (const opp of sitOpportunities) {
    const ownerId = opp.owner_user_id
    if (!ownerId || !memberSet.has(ownerId)) continue
    counts.set(ownerId, (counts.get(ownerId) || 0) + 1)
  }
  return counts
}

export function countSitsScoped(
  sitOpportunities: EffectiveSitOpportunity[],
  scopeUserIds: string[],
  attributeBySetter: boolean
): number {
  if (scopeUserIds.length === 0) {
    return sitOpportunities.length
  }
  const scope = new Set(scopeUserIds)
  return sitOpportunities.filter((opp) => {
    if (attributeBySetter) {
      return Boolean(opp.setter_user_id && scope.has(opp.setter_user_id))
    }
    return Boolean(opp.owner_user_id && scope.has(opp.owner_user_id))
  }).length
}
