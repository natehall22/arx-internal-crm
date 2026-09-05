import type { SupabaseClient } from '@supabase/supabase-js'
import { buildMaterialsExtras } from '@/lib/materials-order-extras'
import {
  enrichOpsJobsWithMeasureSoldSquaresFallback,
  enrichOpsJobsWithSoldSquares,
} from '@/lib/ops-board-sold-squares'
import {
  resolveProposalMeasuredSquares,
  resolveProposalSoldRoofSquares,
  resolveProposalWastePercent,
} from '@/lib/sold-roof-squares'

export type JobSoldScopeLineItem = {
  id: string
  name: string
  description: string | null
  category: string
  quantity: number
  unit: string
  unit_price: number
  line_total: number
  is_adder: boolean
}

export type JobSoldScopeRoofMeasureLf = {
  source: string | null
  ridges_lf: number | null
  valleys_lf: number | null
  hips_lf: number | null
  eaves_lf: number | null
  rakes_lf: number | null
  flashing_lf: number | null
  step_flashing_lf: number | null
  wall_flashing_lf: number | null
  drip_edge_lf?: number | null
}

/** Extra measurement-derived inputs for the ops materials order list (all optional/additive). */
export type JobSoldScopeMaterialsExtras = {
  ridge_segment_count: number | null
  low_slope_area_sqft: number | null
  low_slope_facet_count: number | null
  penetration_count: number | null
}

export type JobSoldScope = {
  total_squares: number | null
  /** Proposal-derived total includes waste factor; legacy project field does not claim that. */
  total_squares_source: 'proposal_enriched' | 'project_legacy' | 'roof_measure_total' | null
  measured_squares: number | null
  waste_percent: number | null
  /** When proposal has no waste %, ARX / roof_measurements.suggested_waste_percent (estimate only). */
  measure_suggested_waste_percent: number | null
  source: 'proposal' | 'project_legacy' | null
  proposal_id: string | null
  proposal_number: string | null
  line_items: JobSoldScopeLineItem[]
  /** Ridge / valley / flashing LF from roof_measurements linked to the proposal (or opp/project fallback). */
  roof_measurement_linear: JobSoldScopeRoofMeasureLf | null
  materials_extras?: JobSoldScopeMaterialsExtras | null
}

/** Roof measurement columns the sold scope needs. Shared so every consumer asks for the same shape. */
export const JOB_ROOF_MEASUREMENT_COLUMNS =
  'ridges_lf, valleys_lf, hips_lf, eaves_lf, rakes_lf, flashing_lf, step_flashing_lf, drip_edge_lf, penetration_count, source, raw_data, suggested_waste_percent'

export type JobRoofMeasurementRow = {
  penetration_count?: number | null
  raw_data?: unknown
  ridges_lf?: number | null
  valleys_lf?: number | null
  hips_lf?: number | null
  eaves_lf?: number | null
  rakes_lf?: number | null
  flashing_lf?: number | null
  step_flashing_lf?: number | null
  drip_edge_lf?: number | null
  source?: string | null
  suggested_waste_percent?: number | null
}

export function positiveLinearFt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n) || n <= 0) return null
  return Math.round(n * 10) / 10
}

export function positiveWastePercent(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n) || n <= 0) return null
  return Math.round(n * 10) / 10
}

export function buildRoofMeasurementLinear(
  row: JobRoofMeasurementRow | null
): JobSoldScopeRoofMeasureLf | null {
  if (!row) return null
  const raw =
    row.raw_data && typeof row.raw_data === 'object' && !Array.isArray(row.raw_data)
      ? (row.raw_data as Record<string, unknown>)
      : null

  /**
   * Column first, then `raw_data` — some measurement rows only ever landed the LF in raw_data
   * (older imports). `lib/job-run-sheet.ts` has always read them that way, so the order sheet has
   * to as well: when only the run sheet fell back, it printed a starter bundle count the supplier
   * order sheet omitted entirely, and starter never got ordered.
   */
  const lf = (key: keyof JobSoldScopeRoofMeasureLf): number | null =>
    positiveLinearFt((row as Record<string, unknown>)[key]) ??
    (raw ? positiveLinearFt(raw[key]) : null)

  const out: JobSoldScopeRoofMeasureLf = {
    source: row.source ?? null,
    ridges_lf: lf('ridges_lf'),
    valleys_lf: lf('valleys_lf'),
    hips_lf: lf('hips_lf'),
    eaves_lf: lf('eaves_lf'),
    rakes_lf: lf('rakes_lf'),
    flashing_lf: lf('flashing_lf'),
    step_flashing_lf: lf('step_flashing_lf'),
    wall_flashing_lf: raw ? positiveLinearFt(raw.wall_flashing_lf) : null,
    drip_edge_lf: lf('drip_edge_lf'),
  }

  const hasNumeric =
    out.ridges_lf != null ||
    out.valleys_lf != null ||
    out.hips_lf != null ||
    out.eaves_lf != null ||
    out.rakes_lf != null ||
    out.flashing_lf != null ||
    out.step_flashing_lf != null ||
    out.wall_flashing_lf != null

  return hasNumeric ? out : null
}

/**
 * Resolves the proposal backing this job: explicit link → accepted proposal →
 * most recently accepted proposal on the project.
 */
export async function resolveJobProposalId(
  admin: SupabaseClient,
  orgId: string,
  job: {
    linked_proposal_id?: string | null
    accepted_proposal_id?: string | null
    project_id?: string | null
  }
): Promise<string | null> {
  const explicit = job.linked_proposal_id || job.accepted_proposal_id
  if (explicit) return explicit
  if (!job.project_id) return null

  const { data } = await admin
    .from('proposals')
    .select('id')
    .eq('org_id', orgId)
    .eq('project_id', job.project_id)
    .not('accepted_at', 'is', null)
    .order('accepted_at', { ascending: false })
    .limit(1)

  return data?.[0]?.id ?? null
}

/**
 * Opportunity behind a job: the proposal's, else the project's, else an address match.
 *
 * The address leg is the last resort and only ever runs when the first two came up empty, so it
 * can add a measurement but never change one. It exists because `/ops/jobs/[id]` resolves the
 * opportunity from the signed contract / address before the project, and without it the supplier
 * order sheet resolved a *different* opportunity than the card ops read on screen — printing a
 * blank sheet for a job whose measurement is linked by `opportunity_id` only.
 */
export async function resolveJobOpportunityId(
  admin: SupabaseClient,
  orgId: string,
  proposalId: string | null,
  projectId: string | null,
  addressText?: string | null
): Promise<string | null> {
  if (proposalId) {
    const { data } = await admin
      .from('proposals')
      .select('opportunity_id')
      .eq('id', proposalId)
      // Org filter is defence-in-depth: the id already came off an org-scoped row, but every
      // service-role read here stays scoped (0 cross-org job→proposal links exist today).
      .eq('org_id', orgId)
      .maybeSingle()
    if (data?.opportunity_id) return data.opportunity_id
  }
  if (projectId) {
    const { data } = await admin
      .from('projects')
      .select('opportunity_id')
      .eq('id', projectId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (data?.opportunity_id) return data.opportunity_id
  }
  const address = typeof addressText === 'string' ? addressText.trim() : ''
  if (address) {
    const { data } = await admin
      .from('opportunities')
      .select('id')
      .eq('org_id', orgId)
      .eq('address_text', address)
      .limit(1)
    if (data?.[0]?.id) return data[0].id
  }
  return null
}

/**
 * Newest roof_measurements row for a job, tried proposal → opportunity → project.
 *
 * The opportunity leg is not optional — in practice essentially every roof_measurements row is
 * linked by `opportunity_id` only, so skipping it means no consumer sees a single LF figure.
 */
export async function findJobRoofMeasurementRow<T = JobRoofMeasurementRow>(
  admin: SupabaseClient,
  orgId: string,
  ids: { proposalId?: string | null; opportunityId?: string | null; projectId?: string | null },
  columns: string = JOB_ROOF_MEASUREMENT_COLUMNS
): Promise<T | null> {
  const attempts: [string, string][] = []
  if (ids.proposalId) attempts.push(['proposal_id', ids.proposalId])
  if (ids.opportunityId) attempts.push(['opportunity_id', ids.opportunityId])
  if (ids.projectId) attempts.push(['project_id', ids.projectId])

  for (const [column, value] of attempts) {
    const { data } = await admin
      .from('roof_measurements')
      .select(columns)
      .eq('org_id', orgId)
      .eq(column, value)
      .order('updated_at', { ascending: false })
      .limit(1)
    const row = (data?.[0] ?? null) as T | null
    if (row) return row
  }
  return null
}

type SoldScopeJobRow = {
  linked_proposal_id?: string | null
  accepted_proposal_id?: string | null
  project_id?: string | null
  job_type?: string | null
  /** Last-resort opportunity match, mirroring how `/ops/jobs/[id]` finds one. */
  address_text?: string | null
  project?: unknown
}

function unwrapProject(job: SoldScopeJobRow): Record<string, unknown> | null {
  const p = job.project
  if (p == null) return null
  const row = Array.isArray(p) ? p[0] : p
  if (!row || typeof row !== 'object') return null
  return row as Record<string, unknown>
}

/**
 * The single source of truth for "what was sold on this job" — squares (incl. waste), the sold
 * line items, and the roof-measure linear footages the materials order list is computed from.
 *
 * Used by `/ops/jobs/[id]` (feeds `JobSoldScopeSummary` + `MaterialsOrderCard`) and by the
 * printable materials order sheet, so the screen and the paper can never disagree.
 */
export async function buildJobSoldScope(input: {
  admin: SupabaseClient
  orgId: string
  job: SoldScopeJobRow & Record<string, unknown>
  /**
   * Opportunity id when the caller already resolved one a better way — the job page derives it from
   * the signed contract, then an address match, then `project.opportunity_id`.
   *
   * Supplying the key at all (even as `null`) is authoritative: a caller that did its own richer
   * lookup and came up empty must not be silently second-guessed here. Omit the key entirely to
   * use the default proposal → project chain.
   */
  opportunityId?: string | null
}): Promise<JobSoldScope | null> {
  const { admin, orgId, job } = input

  const projectRow = unwrapProject(job)
  const projectLegacySq =
    projectRow && projectRow.sold_roof_squares != null ? Number(projectRow.sold_roof_squares) : null
  const legacyPositive =
    projectLegacySq != null && !Number.isNaN(projectLegacySq) && projectLegacySq > 0

  // Board-card enrichment: fills sold/measured squares from accepted proposals, then from the
  // latest roof measurement. Only consulted when no proposal backs the job.
  const jobRowForSquares: Record<string, unknown> = { ...job }
  await enrichOpsJobsWithSoldSquares(admin, orgId, [jobRowForSquares])
  await enrichOpsJobsWithMeasureSoldSquaresFallback(admin, orgId, [jobRowForSquares])

  const enrichedSoldSquares = jobRowForSquares.sold_squares
  const enrichedMeasuredSquares = jobRowForSquares.measured_squares
  const enrichedWastePercent = jobRowForSquares.sold_waste_percent

  const proposalId = await resolveJobProposalId(admin, orgId, job)

  let proposal_number: string | null = null
  let proposalSquares: {
    sold_squares?: number | null
    measured_squares?: number | null
    sold_waste_percent?: number | null
  } | null = null
  let line_items: JobSoldScopeLineItem[] = []

  if (proposalId) {
    const { data: propMeta } = await admin
      .from('proposals')
      .select('id, proposal_number, sold_squares, measured_squares, sold_waste_percent')
      .eq('org_id', orgId)
      .eq('id', proposalId)
      .maybeSingle()
    proposal_number = propMeta?.proposal_number ?? null
    proposalSquares = propMeta

    const { data: li } = await admin
      .from('proposal_line_items')
      .select(
        'id, name, description, category, unit, quantity, unit_price, line_total, is_adder, sort_order'
      )
      .eq('proposal_id', proposalId)
      .order('sort_order', { ascending: true })

    line_items = (li || []).map((row) => ({
      id: row.id,
      name: row.name || 'Line item',
      description: row.description ?? null,
      category: row.category || 'general',
      quantity: Number(row.quantity) || 0,
      unit: row.unit || '',
      unit_price: Number(row.unit_price) || 0,
      line_total: Number(row.line_total) || 0,
      is_adder: Boolean(row.is_adder),
    }))
  }

  const proposalResolvedTotalSquares = proposalSquares
    ? resolveProposalSoldRoofSquares(proposalSquares, line_items)
    : null
  const proposalResolvedMeasuredSquares = proposalSquares
    ? resolveProposalMeasuredSquares(proposalSquares, line_items)
    : null
  const proposalResolvedWastePercent = proposalSquares
    ? resolveProposalWastePercent(proposalSquares, line_items)
    : null

  const soldSqPositive =
    proposalId != null
      ? proposalResolvedTotalSquares
      : typeof enrichedSoldSquares === 'number' && enrichedSoldSquares > 0
        ? Number(enrichedSoldSquares)
        : null
  const soldSquaresFromMeasureRow =
    proposalId == null && jobRowForSquares.sold_squares_from_measure === true

  const totalSquares =
    soldSqPositive ?? (proposalId == null && legacyPositive ? projectLegacySq : null)
  const totalSquaresSource: JobSoldScope['total_squares_source'] =
    soldSqPositive != null && soldSquaresFromMeasureRow
      ? 'roof_measure_total'
      : soldSqPositive != null
        ? 'proposal_enriched'
        : proposalId == null && legacyPositive && projectLegacySq != null
          ? 'project_legacy'
          : null

  const opportunityId =
    'opportunityId' in input
      ? input.opportunityId ?? null
      : await resolveJobOpportunityId(
          admin,
          orgId,
          proposalId,
          job.project_id ?? null,
          typeof job.address_text === 'string' ? job.address_text : null
        )

  const measurementRow = await findJobRoofMeasurementRow(admin, orgId, {
    proposalId,
    opportunityId,
    projectId: job.project_id ?? null,
  })

  const roofMeasurementLinear = buildRoofMeasurementLinear(measurementRow)
  const proposalHasWaste =
    proposalId != null
      ? proposalResolvedWastePercent != null && proposalResolvedWastePercent > 0
      : typeof enrichedWastePercent === 'number' && Number(enrichedWastePercent) > 0

  let measureSuggestedWasteOnly: number | null = null
  if (measurementRow && !proposalHasWaste) {
    measureSuggestedWasteOnly = positiveWastePercent(measurementRow.suggested_waste_percent)
    if (
      measureSuggestedWasteOnly == null &&
      measurementRow.raw_data &&
      typeof measurementRow.raw_data === 'object'
    ) {
      const raw = measurementRow.raw_data as Record<string, unknown>
      measureSuggestedWasteOnly = positiveWastePercent(raw.suggested_waste)
    }
  }

  const fromProposal = proposalId != null || line_items.length > 0

  const source: 'proposal' | 'project_legacy' | null = fromProposal
    ? 'proposal'
    : legacyPositive
      ? 'project_legacy'
      : null

  const hasMeasurementsOnly =
    (proposalId != null &&
      proposalResolvedMeasuredSquares != null &&
      proposalResolvedMeasuredSquares > 0) ||
    (proposalId != null && proposalResolvedWastePercent != null && proposalResolvedWastePercent > 0) ||
    (proposalId == null &&
      ((typeof enrichedMeasuredSquares === 'number' && enrichedMeasuredSquares > 0) ||
        (typeof enrichedWastePercent === 'number' && enrichedWastePercent > 0)))

  if (
    totalSquares == null &&
    line_items.length === 0 &&
    !hasMeasurementsOnly &&
    !roofMeasurementLinear &&
    measureSuggestedWasteOnly == null
  ) {
    return null
  }

  return {
    total_squares: totalSquares,
    total_squares_source: totalSquaresSource,
    measured_squares:
      proposalId != null
        ? proposalResolvedMeasuredSquares
        : typeof enrichedMeasuredSquares === 'number' && enrichedMeasuredSquares > 0
          ? enrichedMeasuredSquares
          : null,
    waste_percent:
      proposalId != null
        ? proposalResolvedWastePercent
        : typeof enrichedWastePercent === 'number' && enrichedWastePercent > 0
          ? enrichedWastePercent
          : null,
    measure_suggested_waste_percent: measureSuggestedWasteOnly,
    source,
    proposal_id: proposalId,
    proposal_number,
    line_items,
    roof_measurement_linear: roofMeasurementLinear,
    materials_extras: buildMaterialsExtras(measurementRow),
  }
}
