/**
 * Job Run Sheet — the one-page "everything you need to run this job" hand-off.
 *
 * Audience is whoever is physically running the job (sub crew lead, ops rider-along), so it
 * deliberately carries NO pricing, financing, or commission data. Everything here is either
 * scope, logistics, or a heads-up the crew has to know before they pull the first shingle.
 *
 * Every text section is a {@link RunSheetField}: the CRM computes a value, ops may override it,
 * and the sheet renders `override ?? computed`. Clearing an override falls straight back to the
 * live CRM value, so an edit can never silently freeze stale data onto the sheet.
 *
 * Data is assembled fresh on every request (no caching / no stored PDF) — a run sheet that lags
 * behind an ops edit is worse than no run sheet at all.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  resolveMaterialsCoverageOverrides,
  type MaterialsCoverageOverrides,
  type OrgMaterialsCoverageRow,
} from '@/lib/materials-coverage-overrides'
import {
  findJobRoofMeasurementRow,
  resolveJobOpportunityId,
  resolveJobProposalId,
} from '@/lib/job-sold-scope'
import { MATERIALS_ORDER_STARTER_CUSHION_PERCENT } from '@/lib/materials-order-list'
import { parseProjectReviewStored } from '@/lib/project-review'
import { starterFromLinearFt } from '@/lib/starter-strip'

export const RUN_SHEET_FIELD_KEYS = [
  'schedule_note',
  'scope_of_work',
  'materials_and_products',
  'tear_off_and_decking',
  'accessories',
  'add_ons_sold',
  'heads_up',
] as const

export type RunSheetFieldKey = (typeof RUN_SHEET_FIELD_KEYS)[number]

export const RUN_SHEET_FIELD_LABELS: Record<RunSheetFieldKey, string> = {
  schedule_note: 'Schedule note',
  scope_of_work: 'Scope of work',
  materials_and_products: 'Materials & products',
  tear_off_and_decking: 'Tear-off, layers & decking',
  accessories: 'Accessories',
  add_ons_sold: 'Add-ons sold',
  heads_up: 'Read before you start',
}

/** Where the computed value comes from, shown in the editor so ops knows what it is overriding. */
export const RUN_SHEET_FIELD_SOURCES: Record<RunSheetFieldKey, string> = {
  schedule_note: 'Not auto-filled — add anything about timing or meeting on site',
  scope_of_work: 'Project review → scope, else project scope of work',
  materials_and_products: 'Project review → materials, else project product summary',
  tear_off_and_decking: 'Project review → tear-off, layers & decking',
  accessories: 'Project review → accessories',
  add_ons_sold: 'Accepted proposal → adder line items',
  heads_up: 'Project review (HOA, site, open items), job instructions, crew notes',
}

export type RunSheetField = {
  key: RunSheetFieldKey
  label: string
  source: string
  /** What the CRM derives today. Null when nothing upstream is filled in. */
  computed: string | null
  /** Ops edit. Null means "use computed". */
  override: string | null
  /** What actually prints: `override ?? computed`. */
  value: string | null
  edited: boolean
}

export type RunSheetContact = {
  label: string
  name: string
  phone: string | null
}

export type RunSheetMeasurement = {
  label: string
  value: string
}

export type RunSheetHeadsUpBlock = {
  /** Null when the block is an ops override (their text stands on its own, unlabeled). */
  label: string | null
  body: string
}

export type JobRunSheetData = {
  jobId: string
  orgName: string
  orgPhone: string | null
  jobNumber: string
  jobType: string
  status: string
  address: string
  scheduledDate: string | null
  scheduledTimeStart: string | null
  estimatedDurationHours: number | null
  permitRequired: boolean
  permitNumber: string | null
  proposalNumber: string | null
  homeowner: RunSheetContact
  runningJob: RunSheetContact
  soldBy: RunSheetContact | null
  measurements: RunSheetMeasurement[]
  fields: Record<RunSheetFieldKey, RunSheetField>
  /** Effective heads-up blocks after any override is applied. */
  headsUp: RunSheetHeadsUpBlock[]
  anyEdits: boolean
  overridesUpdatedAt: string | null
  generatedAt: string
}

export type JobRunSheetOverrideRow = {
  [K in RunSheetFieldKey]: string | null
} & { updated_at: string | null }

const ADDER_UNIT_LABELS: Record<string, string> = {
  square: 'sq',
  lf: 'LF',
  per_sqft: 'sq ft',
  each: 'ea',
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function positiveNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function fmtQty(n: number): string {
  return Number.isInteger(n) ? n.toFixed(0) : String(Number(n.toFixed(2)))
}

function fmtLf(n: number): string {
  return `${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1)} LF`
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

/**
 * Sold adders in proposal order. `percent`-unit rows are pricing modifiers, not things anyone
 * installs, so they are dropped — a crew reading "Premier Pricing" on a materials line is noise.
 */
function formatAddOns(
  lineItems: { name: string; quantity: unknown; unit: string | null; is_adder: boolean }[]
): string | null {
  const parts: string[] = []
  for (const item of lineItems) {
    if (!item.is_adder) continue
    const qty = positiveNumber(item.quantity)
    if (qty == null) continue
    const unit = (item.unit || '').toLowerCase()
    if (unit === 'percent') continue
    const unitLabel = ADDER_UNIT_LABELS[unit] ?? item.unit ?? ''
    const name = clean(item.name)
    if (!name) continue
    parts.push(`${name} — ${[fmtQty(qty), unitLabel].filter(Boolean).join(' ')}`)
  }
  return parts.length > 0 ? parts.join('\n') : null
}

function pushHeadsUp(list: RunSheetHeadsUpBlock[], label: string, body: string | null) {
  if (!body) return
  // Ops frequently duplicates the same warning across special_instructions and the project review.
  if (list.some((entry) => entry.body === body)) return
  list.push({ label, body })
}

/** Flattens computed heads-up blocks into editable text that round-trips back through the editor. */
export function headsUpBlocksToText(blocks: RunSheetHeadsUpBlock[]): string | null {
  if (blocks.length === 0) return null
  return blocks
    .map((b) => (b.label ? `${b.label}\n${b.body}` : b.body))
    .join('\n\n')
}

/**
 * Same lookup order as `/ops/jobs/[id]`: proposal → opportunity → project.
 *
 * The opportunity leg is not optional — in practice essentially every roof_measurements row is
 * linked by `opportunity_id` only, so skipping it means the sheet never shows a single LF figure.
 */
async function resolveMeasurements(
  admin: SupabaseClient,
  orgId: string,
  proposalId: string | null,
  opportunityId: string | null,
  projectId: string | null,
  coverage: MaterialsCoverageOverrides
): Promise<RunSheetMeasurement[]> {
  const columns =
    'total_squares, ridges_lf, hips_lf, valleys_lf, eaves_lf, rakes_lf, step_flashing_lf, drip_edge_lf, flashing_lf, predominant_pitch, raw_data'

  const row = await findJobRoofMeasurementRow<Record<string, unknown>>(
    admin,
    orgId,
    { proposalId, opportunityId, projectId },
    columns
  )

  if (!row) return []

  // Some measurement fields only ever landed in raw_data, same as the job page's fallback.
  const raw =
    row.raw_data && typeof row.raw_data === 'object' && !Array.isArray(row.raw_data)
      ? (row.raw_data as Record<string, unknown>)
      : null
  const pick = (key: string): unknown => row![key] ?? raw?.[key]

  const out: RunSheetMeasurement[] = []
  const pitch = clean(row.predominant_pitch)
  if (pitch) out.push({ label: 'Pitch', value: pitch })

  const wallFlashing =
    (positiveNumber(raw?.wall_flashing_lf) ?? 0) + (positiveNumber(pick('flashing_lf')) ?? 0)

  const pushLf = (label: string, value: unknown) => {
    const n = positiveNumber(value)
    if (n != null) out.push({ label, value: fmtLf(n) })
  }

  pushLf('Ridge', pick('ridges_lf'))
  pushLf('Hip', pick('hips_lf'))
  pushLf('Valley', pick('valleys_lf'))
  pushLf('Eave', pick('eaves_lf'))
  pushLf('Rake', pick('rakes_lf'))

  // Starter is a bundle count, not an LF, but the sheet doubles as the supplier order — so it
  // rides here next to the eave/rake it comes from. Same helper + cushion as the materials order
  // list, so the two can never quote the supplier different numbers.
  const starter = starterFromLinearFt({
    eaves_lf: positiveNumber(pick('eaves_lf')),
    rakes_lf: positiveNumber(pick('rakes_lf')),
    lfPerBundle: coverage.starterLfPerBundle,
    cushionPercent: MATERIALS_ORDER_STARTER_CUSHION_PERCENT,
  })
  if (starter) {
    out.push({
      label: 'Starter',
      value: `${starter.bundles} bundle${starter.bundles === 1 ? '' : 's'}`,
    })
  }

  pushLf('Step flash', pick('step_flashing_lf'))
  pushLf('Wall flash', wallFlashing)
  pushLf('Drip edge', pick('drip_edge_lf'))

  return out
}

function makeField(
  key: RunSheetFieldKey,
  computed: string | null,
  override: string | null
): RunSheetField {
  const cleanOverride = clean(override)
  return {
    key,
    label: RUN_SHEET_FIELD_LABELS[key],
    source: RUN_SHEET_FIELD_SOURCES[key],
    computed,
    override: cleanOverride,
    value: cleanOverride ?? computed,
    edited: cleanOverride != null,
  }
}

export async function buildJobRunSheet(
  admin: SupabaseClient,
  orgId: string,
  jobId: string
): Promise<JobRunSheetData | null> {
  const { data: job } = await admin
    .from('production_jobs')
    .select(
      `
      id, job_number, job_type, status, address_text, scheduled_date, scheduled_time_start,
      estimated_duration_hours, special_instructions, materials_notes, permit_required, permit_number,
      project_id, accepted_proposal_id, linked_proposal_id,
      customer:customers(name, phone),
      assigned_crew:crews(name, phone),
      assigned_sub:sub_contractors(company_name, contact_name, phone),
      salesperson:users!production_jobs_salesperson_id_fkey(full_name, phone),
      project:projects(scope_of_work, product_summary, project_review, sold_roof_squares)
    `
    )
    .eq('id', jobId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (!job) return null

  const customer = first(job.customer as any)
  const crew = first(job.assigned_crew as any)
  const sub = first(job.assigned_sub as any)
  const salesperson = first(job.salesperson as any)
  const project = first(job.project as any)

  const [orgRes, proposalId, overrides] = await Promise.all([
    admin
      .from('orgs')
      .select(
        'name, phone, starter_lf_per_bundle, cap_lf_per_bundle, underlayment_sq_per_roll, ridge_vent_lf_per_piece, ridge_vent_end_setback_ft, ice_water_lf_per_roll'
      )
      .eq('id', orgId)
      .maybeSingle(),
    resolveJobProposalId(admin, orgId, {
      linked_proposal_id: job.linked_proposal_id,
      accepted_proposal_id: job.accepted_proposal_id,
      project_id: job.project_id,
    }),
    loadRunSheetOverrides(admin, jobId),
  ])

  let proposalNumber: string | null = null
  let lineItems: { name: string; quantity: unknown; unit: string | null; is_adder: boolean }[] = []
  let proposalSoldSquares: number | null = null

  if (proposalId) {
    const [propRes, itemsRes] = await Promise.all([
      admin.from('proposals').select('proposal_number, sold_squares').eq('id', proposalId).maybeSingle(),
      admin
        .from('proposal_line_items')
        .select('name, quantity, unit, is_adder')
        .eq('proposal_id', proposalId)
        .order('sort_order'),
    ])
    proposalNumber = clean(propRes.data?.proposal_number)
    proposalSoldSquares = positiveNumber(propRes.data?.sold_squares)
    lineItems = itemsRes.data ?? []
  }

  const opportunityId = await resolveJobOpportunityId(admin, orgId, proposalId, job.project_id)

  const [measurements, notesRes] = await Promise.all([
    resolveMeasurements(
      admin,
      orgId,
      proposalId,
      opportunityId,
      job.project_id,
      resolveMaterialsCoverageOverrides(orgRes.data as OrgMaterialsCoverageRow | null)
    ),
    admin
      .from('production_job_notes')
      .select('note')
      .eq('job_id', jobId)
      .eq('share_with_sub', true)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  const review = parseProjectReviewStored(project?.project_review)?.answers ?? null

  // Squares lead the measurement strip — it is the number the crew checks first.
  const squares = proposalSoldSquares ?? positiveNumber(project?.sold_roof_squares)
  if (squares != null) {
    measurements.unshift({ label: 'Squares (w/ waste)', value: `${squares.toFixed(2)} sq` })
  }

  const computedHeadsUp: RunSheetHeadsUpBlock[] = []
  pushHeadsUp(computedHeadsUp, 'Permits & HOA', clean(review?.permitsAndHoa))
  pushHeadsUp(computedHeadsUp, 'Site conditions', clean(review?.siteConditions))
  pushHeadsUp(computedHeadsUp, 'Special instructions', clean(job.special_instructions))
  pushHeadsUp(computedHeadsUp, 'Materials notes', clean(job.materials_notes))
  pushHeadsUp(computedHeadsUp, 'Open items', clean(review?.openItems))
  pushHeadsUp(computedHeadsUp, 'Customer was told', clean(review?.customerExpectations))
  for (const row of notesRes.data ?? []) {
    pushHeadsUp(computedHeadsUp, 'Note for crew', clean(row.note))
  }

  const fields: Record<RunSheetFieldKey, RunSheetField> = {
    schedule_note: makeField('schedule_note', null, overrides?.schedule_note ?? null),
    scope_of_work: makeField(
      'scope_of_work',
      clean(review?.scopeSummary) || clean(project?.scope_of_work),
      overrides?.scope_of_work ?? null
    ),
    materials_and_products: makeField(
      'materials_and_products',
      clean(review?.materialsAndProducts) || clean(project?.product_summary),
      overrides?.materials_and_products ?? null
    ),
    tear_off_and_decking: makeField(
      'tear_off_and_decking',
      clean(review?.tearOffAndDecking),
      overrides?.tear_off_and_decking ?? null
    ),
    accessories: makeField('accessories', clean(review?.accessories), overrides?.accessories ?? null),
    add_ons_sold: makeField('add_ons_sold', formatAddOns(lineItems), overrides?.add_ons_sold ?? null),
    heads_up: makeField('heads_up', headsUpBlocksToText(computedHeadsUp), overrides?.heads_up ?? null),
  }

  const headsUpField = fields.heads_up
  const headsUp: RunSheetHeadsUpBlock[] = headsUpField.override
    ? [{ label: null, body: headsUpField.override }]
    : computedHeadsUp

  const runningName =
    clean(crew?.name) || clean(sub?.company_name) || clean(sub?.contact_name) || 'Unassigned'

  return {
    jobId,
    orgName: clean(orgRes.data?.name) || 'ARX Roofing & Exteriors',
    orgPhone: clean(orgRes.data?.phone),
    jobNumber: job.job_number,
    jobType: job.job_type,
    status: job.status,
    address: job.address_text,
    scheduledDate: job.scheduled_date,
    scheduledTimeStart: job.scheduled_time_start,
    estimatedDurationHours: positiveNumber(job.estimated_duration_hours),
    permitRequired: Boolean(job.permit_required),
    permitNumber: clean(job.permit_number),
    proposalNumber,
    homeowner: {
      label: 'Homeowner',
      name: clean(customer?.name) || 'Unknown',
      phone: clean(customer?.phone),
    },
    runningJob: {
      label: crew ? 'Crew' : 'Subcontractor',
      name: runningName,
      phone: clean(crew?.phone) || clean(sub?.phone),
    },
    soldBy: salesperson
      ? { label: 'Sold by', name: clean(salesperson.full_name) || 'Unknown', phone: clean(salesperson.phone) }
      : null,
    measurements,
    fields,
    headsUp,
    anyEdits: RUN_SHEET_FIELD_KEYS.some((k) => fields[k].edited),
    overridesUpdatedAt: overrides?.updated_at ?? null,
    generatedAt: new Date().toISOString(),
  }
}

/** Pre-migration deploys must not 500 the whole job page — treat a missing table as "no edits". */
function isMissingOverridesTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42P01' || (error.message?.includes('job_run_sheet_overrides') ?? false)
}

export async function loadRunSheetOverrides(
  admin: SupabaseClient,
  jobId: string
): Promise<JobRunSheetOverrideRow | null> {
  const { data, error } = await admin
    .from('job_run_sheet_overrides')
    // Kept as a literal so the Supabase type parser can read it; mirrors RUN_SHEET_FIELD_KEYS.
    .select(
      'schedule_note, scope_of_work, materials_and_products, tear_off_and_decking, accessories, add_ons_sold, heads_up, updated_at'
    )
    .eq('job_id', jobId)
    .maybeSingle()

  if (error) {
    if (!isMissingOverridesTable(error)) {
      console.error('[Run sheet] override load failed:', error)
    }
    return null
  }
  return (data as unknown as JobRunSheetOverrideRow) ?? null
}
