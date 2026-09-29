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
  contractAddOnLines,
  contractProductText,
  findJobSignedContracts,
  stripDollarAmounts,
  type JobSignedContract,
} from '@/lib/job-contract'
import {
  buildJobSoldScope,
  resolveJobOpportunityId,
  resolveJobProposalId,
  type JobSoldScope,
} from '@/lib/job-sold-scope'
import { buildMaterialsOrderList } from '@/lib/materials-order-list'
import {
  applyMaterialOrderOverrides,
  type DisplayMaterialsOrderItem,
  type JobMaterialOrderOverrideRow,
} from '@/lib/materials-order-overrides'
import { parseProjectReviewStored } from '@/lib/project-review'

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
  materials_and_products: 'Project review → materials, else project product summary, else signed contract',
  tear_off_and_decking: 'Project review → tear-off, layers & decking',
  accessories: 'Project review → accessories',
  add_ons_sold: 'Accepted proposal → adder line items, plus signed contract → additional products',
  heads_up: 'Project review (HOA, site, open items), job instructions, crew notes, signed change orders',
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

export type RunSheetChangeOrder = { label: string; body: string }

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
  /** The one sold-scope answer both sheets print from. */
  soldScope: JobSoldScope | null
  coverage: MaterialsCoverageOverrides
  /** The materials order list with ops quantity edits applied — the supplier sheet's rows. */
  materialOrder: DisplayMaterialsOrderItem[]
  /**
   * Signed change orders. COs are dollars + free text only — they never touch proposal line items,
   * so nothing they add or remove is in the squares, LF or order quantities. Both sheets print them
   * so a garage roof added after the sale can't be silently left off the order.
   */
  changeOrders: RunSheetChangeOrder[]
  /**
   * The signed contract(s), shown to ops as a reference beside the boxes. Never printed whole:
   * `notes` routinely carries deductibles and payment terms.
   */
  signedContracts: JobSignedContract[]
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
 * Price-tier adders nobody installs. The pricebook has no flag for this (Premier Pricing is an
 * `each`-unit "addon" like OSB), so it has to be the name. It used to be caught only by the
 * `percent` check below, which Premier Pricing never matched — it printed on 14 crew sheets.
 */
const PRICING_ONLY_ADDER = /\bpricing\b/i

/**
 * Sold adders in proposal order. `percent`-unit rows and price tiers are pricing modifiers, not
 * things anyone installs, so they are dropped — a crew reading "Premier Pricing" is noise.
 */
export function formatAddOns(
  lineItems: { name: string; quantity: unknown; unit: string | null; is_adder: boolean }[],
  contracts: JobSignedContract[]
): string | null {
  const parts: string[] = []
  const adderNames: string[] = []
  for (const item of lineItems) {
    if (!item.is_adder) continue
    const qty = positiveNumber(item.quantity)
    if (qty == null) continue
    const unit = (item.unit || '').toLowerCase()
    if (unit === 'percent') continue
    const unitLabel = ADDER_UNIT_LABELS[unit] ?? item.unit ?? ''
    const name = clean(item.name)
    if (!name || PRICING_ONLY_ADDER.test(name)) continue
    parts.push(`${name} — ${[fmtQty(qty), unitLabel].filter(Boolean).join(' ')}`)
    adderNames.push(name)
  }
  // What the contract lists beyond the proposal (solar detach, tree trimming, a gate repair).
  parts.push(...contractAddOnLines(contracts, adderNames))
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
 * The measurement strip, read straight off the sold scope and the materials order list — never
 * off its own measurement lookup. The supplier order sheet is built from the same two objects, so
 * the squares, LF and starter count on the crew's paper are the ones the supplier was sent.
 */
export function buildMeasurementStrip(
  scope: JobSoldScope | null,
  orderItems: DisplayMaterialsOrderItem[]
): RunSheetMeasurement[] {
  const out: RunSheetMeasurement[] = []
  const squares = positiveNumber(scope?.total_squares)
  // Squares lead the strip — it is the number the crew checks first.
  if (squares != null) out.push({ label: 'Squares (w/ waste)', value: `${squares.toFixed(1)} sq` })

  const linear = scope?.roof_measurement_linear ?? null
  if (!linear) return out

  const pitch = clean(linear.predominant_pitch)
  if (pitch) out.push({ label: 'Pitch', value: pitch })

  const pushLf = (label: string, value: unknown) => {
    const n = positiveNumber(value)
    if (n != null) out.push({ label, value: fmtLf(n) })
  }

  pushLf('Ridge', linear.ridges_lf)
  pushLf('Hip', linear.hips_lf)
  pushLf('Valley', linear.valleys_lf)
  pushLf('Eave', linear.eaves_lf)
  pushLf('Rake', linear.rakes_lf)

  // Starter is a bundle count, not an LF, but crews check the delivery against it — so it is the
  // order sheet's row, ops edits included. Excluded from the order = not on the crew sheet either.
  const starter = orderItems.find((i) => i.key === 'starter' && !i.isExcluded)
  if (starter?.qty) out.push({ label: 'Starter', value: starter.qty })

  pushLf('Step flash', linear.step_flashing_lf)
  pushLf('Wall flash', (linear.wall_flashing_lf ?? 0) + (linear.flashing_lf ?? 0))
  pushLf('Drip edge', linear.drip_edge_lf ?? (linear.eaves_lf ?? 0) + (linear.rakes_lf ?? 0))

  return out
}

/**
 * Signed COs as sheet blocks. Dollar figures are stripped: the run sheet carries no pricing, and
 * reps often write the price into the description ("Adding black seamless gutters - $1,395.20").
 */
export function toRunSheetChangeOrders(
  rows: {
    co_number: number | string | null
    description: string | null
    customer_signed_at: string | null
    signed_at: string | null
  }[]
): RunSheetChangeOrder[] {
  const out: RunSheetChangeOrder[] = []
  for (const row of rows) {
    const body = clean(stripDollarAmounts(row.description ?? ''))
    if (!body) continue
    const signed = row.customer_signed_at ?? row.signed_at
    const date = signed
      ? new Date(signed).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : null
    out.push({
      // co_number is already "CO-001"-shaped in prod; don't prefix it with another "#".
      label: `Change order${row.co_number != null ? ` ${row.co_number}` : ''}${date ? ` (signed ${date})` : ''}`,
      body,
    })
  }
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
      id, org_id, job_number, job_type, status, address_text, scheduled_date, scheduled_time_start,
      estimated_duration_hours, special_instructions, materials_notes, permit_required, permit_number,
      project_id, accepted_proposal_id, linked_proposal_id,
      customer:customers(name, phone),
      assigned_crew:crews(name, phone),
      assigned_sub:sub_contractors(company_name, contact_name, phone),
      salesperson:users!production_jobs_salesperson_id_fkey(full_name, phone),
      project:projects(opportunity_id, scope_of_work, product_summary, project_review, sold_roof_squares, customers(name), leads(homeowner_name))
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

  // A CO made from the project page can have no job_id yet — it still belongs to this job.
  const coFilter = job.project_id
    ? `job_id.eq.${job.id},and(job_id.is.null,project_id.eq.${job.project_id})`
    : `job_id.eq.${job.id}`

  const [orgRes, scope, overrides, orderOverridesRes, notesRes, changeOrdersRes] = await Promise.all([
    admin
      .from('orgs')
      .select(
        'name, phone, starter_lf_per_bundle, cap_lf_per_bundle, underlayment_sq_per_roll, ridge_vent_lf_per_piece, ridge_vent_end_setback_ft, ice_water_lf_per_roll'
      )
      .eq('id', orgId)
      .maybeSingle(),
    buildJobSoldScope({ admin, orgId, job }),
    loadRunSheetOverrides(admin, jobId),
    admin
      .from('job_material_order_overrides')
      .select('id, job_id, item_key, qty_text, excluded, note, updated_by, updated_at')
      .eq('job_id', jobId),
    admin
      .from('production_job_notes')
      .select('note')
      .eq('job_id', jobId)
      .eq('share_with_sub', true)
      .order('created_at', { ascending: false })
      .limit(5),
    admin
      .from('job_change_orders')
      .select('co_number, description, customer_signed_at, signed_at')
      .eq('org_id', orgId)
      .eq('status', 'completed')
      .or(coFilter)
      .order('created_at', { ascending: true }),
  ])

  const coverage = resolveMaterialsCoverageOverrides(orgRes.data as OrgMaterialsCoverageRow | null)

  // No sold scope (no proposal, measurement or squares) still can have a signed contract.
  const contractProposalId = scope ? scope.proposal_id : await resolveJobProposalId(admin, orgId, job)
  const contractOpportunityId = scope
    ? scope.opportunity_id ?? null
    : await resolveJobOpportunityId(admin, orgId, contractProposalId, job.project_id, job.address_text)
  const signedContracts = await findJobSignedContracts(admin, orgId, {
    proposalId: contractProposalId,
    opportunityId: contractOpportunityId,
  })
  const materialOrder = applyMaterialOrderOverrides(
    buildMaterialsOrderList({
      totalSquaresWithWaste: scope?.total_squares ?? null,
      linear: scope?.roof_measurement_linear ?? null,
      ridgeSegmentCount: scope?.materials_extras?.ridge_segment_count ?? null,
      lowSlopeAreaSqft: scope?.materials_extras?.low_slope_area_sqft ?? null,
      lowSlopeFacetCount: scope?.materials_extras?.low_slope_facet_count ?? null,
      penetrationCount: scope?.materials_extras?.penetration_count ?? null,
      coverageOverrides: coverage,
    }),
    (orderOverridesRes.data ?? []) as JobMaterialOrderOverrideRow[]
  )

  const measurements = buildMeasurementStrip(scope, materialOrder)
  const review = parseProjectReviewStored(project?.project_review)?.answers ?? null

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
  const changeOrders = toRunSheetChangeOrders(changeOrdersRes.data ?? [])
  for (const co of changeOrders) {
    pushHeadsUp(computedHeadsUp, co.label, co.body)
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
      // The contract only fills a blank — ops' later product notes are usually more specific.
      clean(review?.materialsAndProducts) ||
        clean(project?.product_summary) ||
        contractProductText(signedContracts),
      overrides?.materials_and_products ?? null
    ),
    tear_off_and_decking: makeField(
      'tear_off_and_decking',
      clean(review?.tearOffAndDecking),
      overrides?.tear_off_and_decking ?? null
    ),
    accessories: makeField('accessories', clean(review?.accessories), overrides?.accessories ?? null),
    add_ons_sold: makeField(
      'add_ons_sold',
      formatAddOns(scope?.line_items ?? [], signedContracts),
      overrides?.add_ons_sold ?? null
    ),
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
    proposalNumber: clean(scope?.proposal_number),
    homeowner: {
      label: 'Homeowner',
      name:
        clean(customer?.name) ||
        clean(first(project?.customers as any)?.name) ||
        clean(first(project?.leads as any)?.homeowner_name) ||
        'Unknown',
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
    soldScope: scope,
    coverage,
    materialOrder,
    changeOrders,
    signedContracts,
    anyEdits: RUN_SHEET_FIELD_KEYS.some((k) => fields[k].edited),
    overridesUpdatedAt: overrides?.updated_at ?? null,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * What the job sheets editor gets. The sold scope carries line-item prices — the run sheet never
 * does. `signedContracts` stays: the editor is ops-only and shows it as a non-printing reference.
 */
export type ClientJobRunSheet = Omit<JobRunSheetData, 'soldScope' | 'coverage' | 'materialOrder' | 'changeOrders'>

export function toClientRunSheet(sheet: JobRunSheetData): ClientJobRunSheet {
  const {
    soldScope: _soldScope,
    coverage: _coverage,
    materialOrder: _materialOrder,
    changeOrders: _changeOrders,
    ...rest
  } = sheet
  return rest
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
