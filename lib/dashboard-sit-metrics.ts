import type { SupabaseClient } from '@supabase/supabase-js'
import {
  mapLatestInspectionByLeadId,
  mapLatestInspectionByOpportunityId,
  mergeEffectiveInspectionFields,
  type InspectionStatusRowLike,
  type OpportunityRowForInspectionMerge,
} from '@/lib/effective-inspection-state'
import { normalizeInspectionOutcomeId } from '@/lib/inspection-outcomes'
import { fetchSupabaseAllPages } from '@/lib/supabase-fetch-all-pages'

export type OpportunityRowForSitMetrics = OpportunityRowForInspectionMerge & {
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
 * Earliest status-update (or opportunity fallback) whose outcome counts as a sit —
 * skips non-sit attempts (e.g. not_home, rescheduled) and re-sits after the first
 * qualifying visit. Used for payroll so a re-attempted inspection doesn't shift or
 * duplicate which pay period a rep's sit lands in.
 *
 * The lead_id fallback only matches status rows with no opportunity_id of their own
 * (legacy/orphaned rows) — a row already tied to a different opportunity on the same
 * lead (e.g. a re-knocked lead with an older, unrelated opportunity) must never be
 * treated as this opportunity's first sit.
 *
 * `ambiguousLeadIds` disables that fallback entirely for a lead with MORE THAN ONE
 * opportunity in the current batch — an orphaned row can't be attributed to a
 * specific one of them without risking the same physical sit being matched (and
 * paid) to two opportunities at once. Safer to miss the legacy-row fallback in that
 * rare case than to double-pay.
 *
 * The opportunity's own inspection_outcome column is only used as a candidate when
 * inspection_outcome_at is present — updated_at/created_at don't prove when the
 * inspection happened and can fabricate the payroll month from an unrelated edit.
 *
 * Equal timestamps break ties by id (status-row id, or the opportunity's own id for
 * the column-fallback candidate) so the same row wins on every run regardless of
 * input array order.
 */
export function pickFirstQualifyingInspection(
  opp: OpportunityRowForSitMetrics,
  statusRows: InspectionStatusRowLike[],
  sitOutcomeIdSet: Set<string>,
  ambiguousLeadIds: Set<string> = new Set()
): { outcome: string; outcome_at: string } | null {
  const candidates = statusRows
    .filter(
      (r) =>
        r.opportunity_id === opp.id ||
        (!r.opportunity_id &&
          opp.lead_id &&
          r.lead_id === opp.lead_id &&
          !ambiguousLeadIds.has(opp.lead_id))
    )
    .filter((r): r is typeof r & { outcome: string } => Boolean(r.outcome))
    .map((r) => ({ outcome: r.outcome, created_at: r.created_at, id: r.id ?? '' }))

  if (opp.inspection_outcome && opp.inspection_outcome_at) {
    candidates.push({
      outcome: opp.inspection_outcome,
      created_at: opp.inspection_outcome_at,
      id: opp.id,
    })
  }

  const ts = (iso: string) => {
    const n = new Date(iso).getTime()
    return Number.isFinite(n) ? n : null
  }

  const timestamped = candidates
    .map((c) => ({ ...c, t: ts(c.created_at) }))
    .filter((c): c is typeof c & { t: number } => c.t !== null)
    .sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  for (const c of timestamped) {
    if (countsAsSit(c.outcome, sitOutcomeIdSet)) {
      return { outcome: c.outcome, outcome_at: c.created_at }
    }
  }
  return null
}

/** True when an opportunity's own qualifying outcome was dropped only because it has
 * no usable inspection_outcome_at (missing or unparseable) and no qualifying status
 * row backs it up — i.e. payroll would otherwise have had to guess a date from an
 * unrelated timestamp. */
function isSkippedForMissingTimestamp(
  opp: OpportunityRowForSitMetrics,
  picked: { outcome: string; outcome_at: string } | null,
  sitOutcomeIdSet: Set<string>
): boolean {
  const hasUsableTimestamp =
    Boolean(opp.inspection_outcome_at) &&
    Number.isFinite(new Date(opp.inspection_outcome_at as string).getTime())
  return (
    !picked &&
    Boolean(opp.inspection_outcome) &&
    !hasUsableTimestamp &&
    countsAsSit(opp.inspection_outcome, sitOutcomeIdSet)
  )
}

/**
 * Opportunities with effective inspection outcomes in [start, end), merging
 * inspection_status_updates with opportunities columns (same as opportunities list).
 *
 * eligibilityMode 'latest' (default) mirrors the opportunities list / dashboards.
 * 'first_qualifying' (payroll) uses the earliest outcome that counts as a sit, so a
 * later re-attempt at the same opportunity doesn't move or duplicate the pay period.
 */
export async function fetchEffectiveSitOpportunitiesInPeriod(
  supabase: SupabaseClient,
  opts: {
    orgId: string
    startIso: string
    endIso: string
    sitOutcomeIdSet: Set<string>
    eligibilityMode?: 'latest' | 'first_qualifying'
    /** first_qualifying only: fired for each opportunity whose own inspection_outcome
     * would count as a sit but was dropped for lack of a trustworthy timestamp. */
    onSkippedForMissingTimestamp?: (opportunityId: string) => void
  }
): Promise<EffectiveSitOpportunity[]> {
  const { orgId, startIso, endIso, sitOutcomeIdSet, eligibilityMode = 'latest' } = opts
  if (sitOutcomeIdSet.size === 0) return []

  const OPP_COLUMNS =
    'id, lead_id, setter_user_id, owner_user_id, inspection_outcome, inspection_outcome_at, inspection_notes, updated_at, created_at'
  const STATUS_COLUMNS = 'id, opportunity_id, lead_id, outcome, notes, created_at'

  const updatesInPeriod = await fetchSupabaseAllPages<{
    opportunity_id: string | null
    lead_id: string | null
    outcome: string | null
    notes: string | null
    created_at: string
  }>(async (from, to) =>
    supabase
      .from('inspection_status_updates')
      .select('opportunity_id, lead_id, outcome, notes, created_at')
      .eq('org_id', orgId)
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  )

  const oppIdSet = new Set<string>()
  const leadIdSet = new Set<string>()
  const leadIdsWithSelectedOpportunity = new Set<string>()

  for (const row of updatesInPeriod) {
    if (row.opportunity_id) oppIdSet.add(String(row.opportunity_id))
    if (row.lead_id) leadIdSet.add(String(row.lead_id))
    if (row.opportunity_id && row.lead_id) leadIdsWithSelectedOpportunity.add(String(row.lead_id))
  }

  const oppsByOutcomeAt = await fetchSupabaseAllPages<OpportunityRowForSitMetrics>(async (from, to) =>
    supabase
      .from('opportunities')
      .select(OPP_COLUMNS)
      .eq('org_id', orgId)
      .not('inspection_outcome_at', 'is', null)
      .gte('inspection_outcome_at', startIso)
      .lt('inspection_outcome_at', endIso)
      .order('inspection_outcome_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  )

  for (const row of oppsByOutcomeAt) {
    oppIdSet.add(String(row.id))
    if (row.lead_id) {
      leadIdSet.add(String(row.lead_id))
      leadIdsWithSelectedOpportunity.add(String(row.lead_id))
    }
  }

  if (leadIdSet.size > 0) {
    const oppsByLead = await fetchSupabaseAllPages<OpportunityRowForSitMetrics>(async (from, to) =>
      supabase
        .from('opportunities')
        .select(OPP_COLUMNS)
        .eq('org_id', orgId)
        .in('lead_id', Array.from(leadIdSet))
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to)
    )
    for (const row of oppsByLead) {
      if (row.lead_id && leadIdsWithSelectedOpportunity.has(String(row.lead_id))) continue
      oppIdSet.add(String(row.id))
      if (!row.lead_id) continue
      leadIdSet.add(String(row.lead_id))
      // 'latest' mode (dashboard/goals/team-stats/personal-stats/morning-update) has
      // no ambiguity guard — mergeEffectiveInspectionFields matches a lead_id status
      // row to whichever opportunity asks, with no awareness of sibling opportunities
      // on the same lead. Pulling in every sibling here (like first_qualifying mode
      // needs) would let that one row double-count across all of them. So for
      // 'latest' mode, preserve the original one-opportunity-per-lead cap (newest
      // first, hence the descending order above) by marking the lead "selected"
      // after its first row, same as the pre-existing direct-match branches above.
      //
      // 'first_qualifying' mode (payroll) is the one that needs every opportunity
      // pulled in — pickFirstQualifyingInspection's ambiguousLeadIds guard (below)
      // depends on oppRows containing the true count per lead to disable the
      // orphaned-row fallback when there's more than one.
      if (eligibilityMode !== 'first_qualifying') {
        leadIdsWithSelectedOpportunity.add(String(row.lead_id))
      }
    }
  }

  if (oppIdSet.size === 0) return []

  const opportunities = await fetchSupabaseAllPages<OpportunityRowForSitMetrics>(async (from, to) =>
    supabase
      .from('opportunities')
      .select(OPP_COLUMNS)
      .eq('org_id', orgId)
      .in('id', Array.from(oppIdSet))
      .order('id', { ascending: true })
      .range(from, to)
  )

  const oppRows = opportunities as OpportunityRowForSitMetrics[]
  const allLeadIds = Array.from(
    new Set(oppRows.map((o) => o.lead_id).filter(Boolean) as string[])
  )

  let statusRows: InspectionStatusRowLike[] = []

  if (oppIdSet.size > 0) {
    statusRows = await fetchSupabaseAllPages<InspectionStatusRowLike & Record<string, unknown>>(
      async (from, to) =>
        supabase
          .from('inspection_status_updates')
          .select(STATUS_COLUMNS)
          .eq('org_id', orgId)
          .in('opportunity_id', Array.from(oppIdSet))
          .order('id', { ascending: true })
          .range(from, to)
    )
  }

  if (allLeadIds.length > 0) {
    const byLead = await fetchSupabaseAllPages<InspectionStatusRowLike & Record<string, unknown>>(
      async (from, to) =>
        supabase
          .from('inspection_status_updates')
          .select(STATUS_COLUMNS)
          .eq('org_id', orgId)
          .in('lead_id', allLeadIds)
          .order('id', { ascending: true })
          .range(from, to)
    )
    statusRows = [...statusRows, ...byLead]
  }
  statusRows.sort((a, b) => {
    const bt = new Date(b.created_at).getTime()
    const at = new Date(a.created_at).getTime()
    return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0)
  })

  const inspectionByOpportunityId =
    eligibilityMode === 'first_qualifying' ? null : mapLatestInspectionByOpportunityId(statusRows)
  const inspectionByLeadId =
    eligibilityMode === 'first_qualifying' ? null : mapLatestInspectionByLeadId(statusRows)

  // Leads with more than one opportunity in this batch (e.g. a re-knocked lead) —
  // an orphaned/legacy status row can't be safely attributed to one of them via
  // lead_id alone, so pickFirstQualifyingInspection disables that fallback for these.
  const leadIdCounts = new Map<string, number>()
  for (const opp of oppRows) {
    if (!opp.lead_id) continue
    leadIdCounts.set(opp.lead_id, (leadIdCounts.get(opp.lead_id) ?? 0) + 1)
  }
  const ambiguousLeadIds = new Set(
    Array.from(leadIdCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([leadId]) => leadId)
  )

  const results: EffectiveSitOpportunity[] = []

  for (const opp of oppRows) {
    let inspectionOutcome: string | null
    let inspectionOutcomeAt: string | null

    if (eligibilityMode === 'first_qualifying') {
      const first = pickFirstQualifyingInspection(opp, statusRows, sitOutcomeIdSet, ambiguousLeadIds)
      inspectionOutcome = first?.outcome ?? null
      inspectionOutcomeAt = first?.outcome_at ?? null
      if (opts.onSkippedForMissingTimestamp && isSkippedForMissingTimestamp(opp, first, sitOutcomeIdSet)) {
        opts.onSkippedForMissingTimestamp(String(opp.id))
      }
    } else {
      const merged = mergeEffectiveInspectionFields(opp, inspectionByOpportunityId!, inspectionByLeadId!)
      inspectionOutcome = merged.inspection_outcome
      inspectionOutcomeAt = merged.inspection_outcome_at
    }

    if (
      !inspectionOutcome ||
      !inspectionOutcomeAt ||
      !isInPeriod(inspectionOutcomeAt, startIso, endIso) ||
      !countsAsSit(inspectionOutcome, sitOutcomeIdSet)
    ) {
      continue
    }

    results.push({
      id: String(opp.id),
      lead_id: opp.lead_id ? String(opp.lead_id) : null,
      setter_user_id: opp.setter_user_id ? String(opp.setter_user_id) : null,
      owner_user_id: opp.owner_user_id ? String(opp.owner_user_id) : null,
      inspection_outcome: inspectionOutcome,
      inspection_outcome_at: inspectionOutcomeAt,
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
