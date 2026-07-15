/**
 * Derives the same effective inspection outcome / notes / timestamp used across
 * opportunities list (full), inside sales queue, and opportunity detail — merging
 * latest inspection_status_updates by opportunity_id and lead_id with fallback
 * to columns on opportunities.
 */

export type EffectiveInspectionFields = {
  inspection_outcome: string | null
  inspection_notes: string | null
  inspection_outcome_at: string | null
}

export type InspectionStatusRowLike = {
  id?: string
  opportunity_id?: string | null
  lead_id?: string | null
  outcome?: string | null
  notes?: string | null
  created_at: string
}

type InspectionCandidate = {
  outcome: string
  notes: string | null
  created_at: string
}

export type OpportunityRowForInspectionMerge = {
  id: string
  lead_id?: string | null
  inspection_outcome?: string | null
  inspection_notes?: string | null
  inspection_outcome_at?: string | null
  updated_at?: string | null
  created_at?: string | null
}

/** Rows must be ordered by created_at descending (newest first). Keeps first row per key. */
export function mapLatestInspectionByOpportunityId(
  rows: InspectionStatusRowLike[]
): Map<string, InspectionCandidate> {
  const map = new Map<string, InspectionCandidate>()
  for (const row of rows) {
    const id = row.opportunity_id
    if (!id || map.has(id)) continue
    const outcome = row.outcome
    if (!outcome) continue
    map.set(id, {
      outcome,
      notes: row.notes ?? null,
      created_at: row.created_at,
    })
  }
  return map
}

/** Rows must be ordered by created_at descending (newest first). Keeps first row per key. */
export function mapLatestInspectionByLeadId(
  rows: InspectionStatusRowLike[]
): Map<string, InspectionCandidate> {
  const map = new Map<string, InspectionCandidate>()
  for (const row of rows) {
    const id = row.lead_id
    if (!id || map.has(id)) continue
    const outcome = row.outcome
    if (!outcome) continue
    map.set(id, {
      outcome,
      notes: row.notes ?? null,
      created_at: row.created_at,
    })
  }
  return map
}

export function mergeEffectiveInspectionFields(
  opportunity: OpportunityRowForInspectionMerge,
  inspectionByOpportunityId: Map<string, InspectionCandidate>,
  inspectionByLeadId: Map<string, InspectionCandidate>
): EffectiveInspectionFields {
  const candidates: InspectionCandidate[] = []

  const byOpportunity = inspectionByOpportunityId.get(opportunity.id)
  if (byOpportunity?.outcome) candidates.push(byOpportunity)

  if (opportunity.lead_id) {
    const byLead = inspectionByLeadId.get(opportunity.lead_id)
    if (byLead?.outcome) candidates.push(byLead)
  }

  if (opportunity.inspection_outcome) {
    const created_at =
      opportunity.inspection_outcome_at ||
      opportunity.updated_at ||
      opportunity.created_at ||
      ''
    candidates.push({
      outcome: opportunity.inspection_outcome,
      notes: opportunity.inspection_notes ?? null,
      created_at,
    })
  }

  if (candidates.length === 0) {
    return {
      inspection_outcome: null,
      inspection_notes: opportunity.inspection_notes ?? null,
      inspection_outcome_at: opportunity.inspection_outcome_at ?? null,
    }
  }

  const ts = (iso: string) => {
    const n = new Date(iso).getTime()
    return Number.isFinite(n) ? n : 0
  }
  candidates.sort((a, b) => ts(b.created_at) - ts(a.created_at))
  const best = candidates[0]
  let inspectionOutcomeAt: string | null = best.created_at
  const parsed = Number.isFinite(new Date(inspectionOutcomeAt).getTime())
    ? new Date(inspectionOutcomeAt).getTime()
    : NaN
  if (!inspectionOutcomeAt || !String(inspectionOutcomeAt).trim() || !Number.isFinite(parsed)) {
    inspectionOutcomeAt =
      opportunity.inspection_outcome_at ||
      opportunity.updated_at ||
      opportunity.created_at ||
      best.created_at ||
      null
  }
  return {
    inspection_outcome: best.outcome,
    inspection_notes: best.notes,
    inspection_outcome_at: inspectionOutcomeAt,
  }
}

/** Apply merged inspection columns for display / inside-sales logic; keeps pipeline_stage and other columns from the row. */
export function withEffectiveInspectionFields<T extends OpportunityRowForInspectionMerge>(
  opportunity: T,
  inspectionByOpportunityId: Map<string, InspectionCandidate>,
  inspectionByLeadId: Map<string, InspectionCandidate>
): T & EffectiveInspectionFields {
  const merged = mergeEffectiveInspectionFields(opportunity, inspectionByOpportunityId, inspectionByLeadId)
  return { ...opportunity, ...merged }
}
