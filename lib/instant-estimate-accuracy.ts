/**
 * Instant Estimate accuracy loop. Every real job is a test case: for each property where ARX has TRUSTED squares,
 * run the public Instant Estimate for that address in shadow mode (no satellite still, no lead) and store what it
 * said next to the truth in `instant_estimate_checks`. The nightly cron is app/api/cron/instant-estimate-accuracy;
 * the report is /reports/explore → "Instant Estimate accuracy"; calibration is lib/instant-estimate-calibration.ts.
 * Docs: docs/measure-tool/instant-estimate-accuracy.md
 *
 * Truth (base squares, no waste) is a roof_measurements row, best first:
 *   carrier_report    EagleView / Roofr / Hover / … report                     (independent of our estimator)
 *   manual            measurement typed in by hand
 *   in_house_manual   in-house measure, saved quote-ready, with hand-drawn/corrected sections
 *   lidar_reviewed    in-house measure, saved quote-ready, every section an unedited lidar plane
 *   in_house_reviewed in-house measure, saved quote-ready, Solar-seeded outline a rep only reviewed
 * The last one shares the estimator's own Solar error, so it is recorded but never calibrates
 * (CALIBRATION_TRUTH_SOURCES, mirrored in the instant_estimate_calibration view).
 * Sold squares (waste included) come from the job's sold scope (lib/job-sold-scope.ts); ordered squares from an ops
 * override of the field-shingle order line. data/measure-tool-memory/installs.csv is manual-only and not read here.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { buildJobSoldScope } from '@/lib/job-sold-scope'
import { CANCELLED_JOB_STATUS } from '@/lib/job-status'
import {
  INSTANT_ESTIMATE_VERSION,
  measurePublicRoofEstimate,
  type MeasurePublicRoofEstimateOptions,
} from '@/lib/public-roof-estimate'
import { isManuallyDrawnFacet } from '@/lib/roof-measure-solar-overlap'
import { BUNDLES_PER_SQUARE } from '@/lib/roof-shingle-constants'
import { parseOrderQuantity } from '@/lib/suppliers/abc/quantity'

export const TRUTH_SOURCES = ['carrier_report', 'manual', 'in_house_manual', 'lidar_reviewed', 'in_house_reviewed'] as const
export type TruthSource = (typeof TRUTH_SOURCES)[number]
/** Truth sources independent enough of the estimator to calibrate it. Keep in sync with the SQL view. */
export const CALIBRATION_TRUTH_SOURCES: readonly TruthSource[] = ['carrier_report', 'manual', 'in_house_manual', 'lidar_reviewed']
/** roof_measurements.source values that are third-party/carrier measurement reports. */
export const CARRIER_REPORT_SOURCES = new Set(['eagleview', 'roofr', 'hover', 'solo', 'aurora', 'gaf', 'quickmeasure', 'carrier'])

export const DEFAULT_ACCURACY_CHECK_LIMIT = 15
const MAX_ACCURACY_CHECK_LIMIT = 50
const MEASUREMENT_SCAN_LIMIT = 500

/** The estimator, injectable for tests. */
export type ShadowMeasureFn = (
  address: string,
  opts?: MeasurePublicRoofEstimateOptions
) => ReturnType<typeof measurePublicRoofEstimate>

// ---------------------------------------------------------------------------------------------------------------
// Truth selection (pure)
// ---------------------------------------------------------------------------------------------------------------
export type MeasurementTruthRow = {
  id: string
  opportunity_id: string | null
  project_id?: string | null
  proposal_id?: string | null
  address_text: string | null
  lat: number | string | null
  lng: number | string | null
  source: string | null
  status: string | null
  total_squares: number | string | null
  raw_data?: unknown
  updated_at: string | null
}

const positive = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function facetsOf(raw: unknown): { origin?: string | null; geometry_source?: string | null }[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const f = (raw as { facets?: unknown }).facets
  return Array.isArray(f) ? f.filter((x): x is Record<string, string | null> => !!x && typeof x === 'object') : []
}

/** Which kind of truth a measurement row is, or null when it is not trusted (draft, needs review, no squares). */
export function classifyTruthSource(row: Pick<MeasurementTruthRow, 'source' | 'status' | 'total_squares' | 'raw_data'>): TruthSource | null {
  if (row.status !== 'completed' || positive(row.total_squares) == null) return null
  const source = (row.source ?? '').trim().toLowerCase()
  if (CARRIER_REPORT_SOURCES.has(source)) return 'carrier_report'
  if (source === 'manual') return 'manual'
  if (source !== 'in_house') return null
  // in_house rows are only 'completed' when saved quote-ready (every section reviewed, pitch confirmed).
  const facets = facetsOf(row.raw_data)
  if (facets.length === 0) return null
  if (facets.some((f) => isManuallyDrawnFacet(f))) return 'in_house_manual'
  if (facets.every((f) => f.geometry_source === 'lidar_plane')) return 'lidar_reviewed'
  return 'in_house_reviewed'
}

export function truthRank(source: TruthSource): number {
  return TRUTH_SOURCES.indexOf(source)
}

/** Best truth row: highest-priority source, then the newest. */
export function pickTruthRow<T extends MeasurementTruthRow>(rows: T[]): { row: T; truthSource: TruthSource } | null {
  let best: { row: T; truthSource: TruthSource } | null = null
  for (const row of rows) {
    const truthSource = classifyTruthSource(row)
    if (!truthSource) continue
    if (!best) {
      best = { row, truthSource }
      continue
    }
    const r = truthRank(truthSource) - truthRank(best.truthSource)
    if (r < 0 || (r === 0 && (row.updated_at ?? '') > (best.row.updated_at ?? ''))) best = { row, truthSource }
  }
  return best
}

/** Ops' field-shingle order quantity in squares ("30 sq · 90 bundles" or "90 bundles"), or null. */
export function orderedSquaresFromQtyText(qtyText: string | null | undefined): number | null {
  const sq = parseOrderQuantity(qtyText, 'sq')
  if (sq != null) return sq
  const bundles = parseOrderQuantity(qtyText, 'bundles')
  return bundles != null ? Math.round((bundles / BUNDLES_PER_SQUARE) * 100) / 100 : null
}

// ---------------------------------------------------------------------------------------------------------------
// Candidates (DB)
// ---------------------------------------------------------------------------------------------------------------
export type TruthCandidate = {
  opportunity_id: string
  production_job_id: string | null
  lead_id: string | null
  address: string
  lat: number | null
  lng: number | null
  truth_source: TruthSource
  truth_base_squares: number
  truth_squares_with_waste: number | null
  ordered_squares: number | null
  measurement_id: string
}

type JobRow = {
  id: string
  status: string | null
  project_id: string | null
  linked_proposal_id: string | null
  accepted_proposal_id: string | null
  job_type: string | null
  address_text: string | null
}

const JOB_COLUMNS = 'id, status, project_id, linked_proposal_id, accepted_proposal_id, job_type, address_text'

/** Jobs per opportunity (project leg + proposal leg). */
async function jobsByOpportunity(admin: SupabaseClient, orgId: string, oppIds: string[]): Promise<Map<string, JobRow[]>> {
  const out = new Map<string, JobRow[]>()
  if (!oppIds.length) return out
  const add = (opp: string | null | undefined, job: JobRow) => {
    if (!opp) return
    const list = out.get(opp) ?? []
    if (!list.some((j) => j.id === job.id)) list.push(job)
    out.set(opp, list)
  }

  const { data: projects } = await admin.from('projects').select('id, opportunity_id').eq('org_id', orgId).in('opportunity_id', oppIds)
  const projectOpp = new Map((projects ?? []).map((p: { id: string; opportunity_id: string | null }) => [p.id, p.opportunity_id]))
  if (projectOpp.size) {
    const { data: jobs } = await admin.from('production_jobs').select(JOB_COLUMNS).eq('org_id', orgId).in('project_id', Array.from(projectOpp.keys()))
    for (const j of (jobs ?? []) as JobRow[]) add(j.project_id ? projectOpp.get(j.project_id) : null, j)
  }

  const { data: proposals } = await admin.from('proposals').select('id, opportunity_id').eq('org_id', orgId).in('opportunity_id', oppIds)
  const proposalOpp = new Map((proposals ?? []).map((p: { id: string; opportunity_id: string | null }) => [p.id, p.opportunity_id]))
  // Chunked: an .or() over hundreds of uuids would blow the request URL limit.
  const proposalIds = Array.from(proposalOpp.keys())
  for (let i = 0; i < proposalIds.length; i += 40) {
    const ids = proposalIds.slice(i, i + 40).join(',')
    const { data: jobs } = await admin
      .from('production_jobs')
      .select(JOB_COLUMNS)
      .eq('org_id', orgId)
      .or(`linked_proposal_id.in.(${ids}),accepted_proposal_id.in.(${ids})`)
    for (const j of (jobs ?? []) as JobRow[]) {
      add(proposalOpp.get(j.linked_proposal_id ?? '') ?? proposalOpp.get(j.accepted_proposal_id ?? ''), j)
    }
  }
  return out
}

/** A usable coordinate (0 / blank / junk → null, so the estimator geocodes the address instead). */
const coord = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n !== 0 ? n : null
}

/** Opportunity ids already checked for this estimate version. */
async function checkedOpportunityIds(admin: SupabaseClient, orgId: string, estimateVersion: string): Promise<Set<string>> {
  const { data } = await admin
    .from('instant_estimate_checks')
    .select('opportunity_id')
    .eq('org_id', orgId)
    .eq('estimate_version', estimateVersion)
    .not('opportunity_id', 'is', null)
    .limit(10000)
  return new Set((data ?? []).map((r: { opportunity_id: string }) => r.opportunity_id))
}

/** Sold squares (waste included) from the job's sold scope — only when a proposal backs it. */
async function soldSquaresWithWaste(admin: SupabaseClient, orgId: string, job: JobRow, opportunityId: string): Promise<number | null> {
  try {
    const scope = await buildJobSoldScope({ admin, orgId, job: { ...job }, opportunityId })
    return scope?.total_squares_source === 'proposal_enriched' ? positive(scope.total_squares) : null
  } catch {
    return null
  }
}

async function orderedSquaresForJob(admin: SupabaseClient, orgId: string, jobId: string): Promise<number | null> {
  const { data } = await admin
    .from('job_material_order_overrides')
    .select('qty_text, excluded')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .eq('item_key', 'field_shingles')
    .maybeSingle()
  if (!data || data.excluded) return null
  return orderedSquaresFromQtyText(data.qty_text)
}

/**
 * Properties with trusted squares not yet checked for `estimateVersion` (when given), best truth first.
 * Opportunities whose only job is cancelled are excluded. Measurement rows must be linked to an opportunity.
 */
export async function findTruthCandidates(
  admin: SupabaseClient,
  orgId: string,
  limit: number,
  opts: { estimateVersion?: string | null } = {}
): Promise<TruthCandidate[]> {
  const want = Math.max(0, Math.min(Math.floor(limit) || 0, 200))
  if (!want) return []

  const { data: rows, error } = await admin
    .from('roof_measurements')
    .select('id, opportunity_id, project_id, proposal_id, address_text, lat, lng, source, status, total_squares, raw_data, updated_at')
    .eq('org_id', orgId)
    .eq('status', 'completed')
    .gt('total_squares', 0)
    .not('opportunity_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(MEASUREMENT_SCAN_LIMIT)
  if (error) throw new Error(`roof_measurements: ${error.message}`)

  const byOpp = new Map<string, MeasurementTruthRow[]>()
  for (const r of (rows ?? []) as MeasurementTruthRow[]) {
    if (!r.opportunity_id) continue
    byOpp.set(r.opportunity_id, [...(byOpp.get(r.opportunity_id) ?? []), r])
  }

  const done = opts.estimateVersion ? await checkedOpportunityIds(admin, orgId, opts.estimateVersion) : new Set<string>()
  const picked = Array.from(byOpp.entries())
    .filter(([opp]) => !done.has(opp))
    .map(([opp, list]) => ({ opp, pick: pickTruthRow(list) }))
    .filter((x): x is { opp: string; pick: { row: MeasurementTruthRow; truthSource: TruthSource } } => x.pick != null)
    .sort(
      (a, b) =>
        truthRank(a.pick.truthSource) - truthRank(b.pick.truthSource) ||
        (b.pick.row.updated_at ?? '').localeCompare(a.pick.row.updated_at ?? '')
    )
    .slice(0, Math.min(want * 3, 150)) // over-fetch: some drop out as cancelled

  const oppIds = picked.map((p) => p.opp)
  const jobs = await jobsByOpportunity(admin, orgId, oppIds)
  const { data: opps } = oppIds.length
    ? await admin.from('opportunities').select('id, lead_id, address_text').eq('org_id', orgId).in('id', oppIds)
    : { data: [] }
  const oppRow = new Map((opps ?? []).map((o: { id: string; lead_id: string | null; address_text: string | null }) => [o.id, o]))

  const out: TruthCandidate[] = []
  for (const { opp, pick } of picked) {
    if (out.length >= want) break
    const oppJobs = jobs.get(opp) ?? []
    const live = oppJobs.filter((j) => j.status !== CANCELLED_JOB_STATUS)
    if (oppJobs.length > 0 && live.length === 0) continue // sold but cancelled — not a test case
    const address = (pick.row.address_text ?? oppRow.get(opp)?.address_text ?? '').trim()
    if (!address) continue
    const job = live[0] ?? null
    out.push({
      opportunity_id: opp,
      production_job_id: job?.id ?? null,
      lead_id: oppRow.get(opp)?.lead_id ?? null,
      address,
      lat: coord(pick.row.lat),
      lng: coord(pick.row.lng),
      truth_source: pick.truthSource,
      truth_base_squares: Math.round(Number(pick.row.total_squares) * 100) / 100,
      truth_squares_with_waste: job ? await soldSquaresWithWaste(admin, orgId, job, opp) : null,
      ordered_squares: job ? await orderedSquaresForJob(admin, orgId, job.id) : null,
      measurement_id: pick.row.id,
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// Run (DB + estimator)
// ---------------------------------------------------------------------------------------------------------------
export type AccuracyRunResult = {
  estimateVersion: string | null
  candidates: number
  checked: number
  failed: number
  skipped: number
  errors: string[]
}

const finite = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

async function saveCheck(admin: SupabaseClient, orgId: string, row: Record<string, unknown> & { opportunity_id: string; estimate_version: string }) {
  const { data: existing } = await admin
    .from('instant_estimate_checks')
    .select('id')
    .eq('org_id', orgId)
    .eq('opportunity_id', row.opportunity_id)
    .eq('estimate_version', row.estimate_version)
    .maybeSingle()
  const { error } = existing?.id
    ? await admin.from('instant_estimate_checks').update(row).eq('id', existing.id).eq('org_id', orgId)
    : await admin.from('instant_estimate_checks').insert({ ...row, org_id: orgId })
  if (error) throw new Error(error.message)
}

/**
 * Score up to `limit` (default 15, max 50) properties against the Instant Estimate in shadow mode, one at a time —
 * each check costs Google Solar calls, so the cap is the cost cap.
 */
export async function runAccuracyChecks(
  admin: SupabaseClient,
  orgId: string,
  opts: { limit?: number; estimateVersion?: string | null; measure?: ShadowMeasureFn } = {}
): Promise<AccuracyRunResult> {
  const limit = Math.max(1, Math.min(Math.floor(opts.limit ?? DEFAULT_ACCURACY_CHECK_LIMIT) || DEFAULT_ACCURACY_CHECK_LIMIT, MAX_ACCURACY_CHECK_LIMIT))
  const measure = opts.measure ?? measurePublicRoofEstimate

  // The estimator's version constant; if a result ever reports a different one (deploy mid-run), switch to it and
  // skip properties already checked under it.
  let version: string = opts.estimateVersion ?? INSTANT_ESTIMATE_VERSION

  const candidates = await findTruthCandidates(admin, orgId, limit * 2, { estimateVersion: version })
  const result: AccuracyRunResult = { estimateVersion: version, candidates: candidates.length, checked: 0, failed: 0, skipped: 0, errors: [] }
  let checkedUnderVersion: Set<string> | null = null
  let calls = 0

  for (const c of candidates) {
    if (calls >= limit) break
    if (checkedUnderVersion?.has(c.opportunity_id)) {
      result.skipped++
      continue
    }
    calls++
    let res: Awaited<ReturnType<ShadowMeasureFn>>
    try {
      res = await measure(c.address, {
        shadow: true,
        orgId,
        // Geocode the address text exactly like the website does, so the check scores what a
        // homeowner would actually get. Saved coordinates are only a fallback when there's no address.
        ...(!c.address?.trim() && c.lat != null && c.lng != null && Number.isFinite(c.lat) && Number.isFinite(c.lng)
          ? { lat: c.lat, lng: c.lng }
          : {}),
      })
    } catch (e) {
      result.failed++
      result.errors.push(`${c.opportunity_id}: ${e instanceof Error ? e.message : String(e)}`)
      continue
    }

    const base = {
      opportunity_id: c.opportunity_id,
      production_job_id: c.production_job_id,
      lead_id: c.lead_id,
      truth_source: c.truth_source,
      truth_base_squares: c.truth_base_squares,
      truth_squares_with_waste: c.truth_squares_with_waste,
      ordered_squares: c.ordered_squares,
    }

    if (!res.ok) {
      result.failed++
      if (res.reason === 'missing_api_key') {
        result.errors.push('missing_api_key — run stopped')
        break
      }
      // Record a deterministic failure under the known version so the same address isn't re-billed nightly.
      // A transient 'measure_failed' is retried on the next run.
      if (res.reason !== 'measure_failed') {
        try {
          await saveCheck(admin, orgId, {
            ...base,
            address: c.address,
            lat: c.lat,
            lng: c.lng,
            estimate_version: version,
            measure_source: `error:${res.reason}`,
            notes: `measurement ${c.measurement_id}`,
          })
        } catch (e) {
          result.errors.push(`${c.opportunity_id}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      continue
    }

    const r = res.result
    if (r.estimate_version && r.estimate_version !== version) {
      version = r.estimate_version
      result.estimateVersion = version
      checkedUnderVersion = await checkedOpportunityIds(admin, orgId, version)
      if (checkedUnderVersion.has(c.opportunity_id)) {
        result.skipped++
        continue
      }
    }
    if (!r.estimate_version) {
      result.failed++
      result.errors.push(`${c.opportunity_id}: estimate returned no estimate_version`)
      continue
    }
    try {
      await saveCheck(admin, orgId, {
        ...base,
        address: c.address,
        lat: finite(r.lat) ?? c.lat,
        lng: finite(r.lng) ?? c.lng,
        estimate_version: r.estimate_version,
        measure_source: r.measure_source ?? null,
        confidence: r.confidence ?? null,
        flags: Array.isArray(r.flags) ? r.flags : [],
        est_base_squares: finite(r.base_squares),
        est_waste_percent: finite(r.waste_percent),
        est_squares_with_waste: finite(r.squares_mid),
        calibration_factor: finite(r.calibration_factor) ?? 1,
        notes: `measurement ${c.measurement_id}${r.requires_manual_measure ? '; estimate asked for manual measure' : ''}`,
      })
      result.checked++
      checkedUnderVersion?.add(c.opportunity_id)
    } catch (e) {
      result.failed++
      result.errors.push(`${c.opportunity_id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return result
}

// ---------------------------------------------------------------------------------------------------------------
// Summary (pure)
// ---------------------------------------------------------------------------------------------------------------
export type AccuracyRow = {
  measure_source: string | null
  est_base_squares: number | string | null
  truth_base_squares: number | string | null
}

export type AccuracySummary = {
  measure_source: string
  n: number
  /** Median of (estimate − truth) / truth, in %. Positive = estimate reads high. */
  median_signed_error_pct: number | null
  median_abs_error_pct: number | null
  /** Share of checks within ±5% / ±10% (0–1). */
  within_5_pct: number | null
  within_10_pct: number | null
}

function medianOf(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10)
const round3 = (n: number | null) => (n == null ? null : Math.round(n * 1000) / 1000)

/** Per measure_source plus an 'all' row (first). Rows without both squares > 0 are ignored. */
export function summarizeAccuracy(rows: AccuracyRow[]): AccuracySummary[] {
  const groups = new Map<string, number[]>()
  const all: number[] = []
  for (const row of rows) {
    const est = positive(row.est_base_squares)
    const truth = positive(row.truth_base_squares)
    if (est == null || truth == null) continue
    const err = ((est - truth) / truth) * 100
    const key = row.measure_source || 'none'
    groups.set(key, [...(groups.get(key) ?? []), err])
    all.push(err)
  }
  const summarize = (measure_source: string, errs: number[]): AccuracySummary => {
    const abs = errs.map(Math.abs)
    return {
      measure_source,
      n: errs.length,
      median_signed_error_pct: round1(medianOf(errs)),
      median_abs_error_pct: round1(medianOf(abs)),
      within_5_pct: errs.length ? round3(abs.filter((e) => e <= 5).length / errs.length) : null,
      within_10_pct: errs.length ? round3(abs.filter((e) => e <= 10).length / errs.length) : null,
    }
  }
  return [
    summarize('all', all),
    ...Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => summarize(k, v)),
  ]
}
