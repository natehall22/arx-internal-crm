/**
 * THE job cost ledger. `job_cost_lines` is the only place a job's costs live, and this
 * module is the only way to read them (Known Redundancy #11, closed 2026-10-21).
 *
 * Before this, a job's cost was computed five different ways from three stores:
 * `job_product_orders` (Materials tab "+ Job Cost"), `job_cost_lines` ("+ Add cost line"),
 * and the `production_jobs.material_cost` / `labor_cost` columns (a 2026-07-08 spreadsheet
 * import, plus the Materials card "Save Labor Cost" box). Every reader picked a different
 * mix, so 26-0041 counted the same $5,421.03 twice on one screen and once on another.
 *
 * Now:
 *  - ONE write path: `POST/PATCH/DELETE /api/ops/jobs/[id]/cost-lines` — used by both the
 *    Materials card "+ Job Cost" button and the Photos & files "+ Add cost line" form.
 *  - ONE reader: `loadJobCostLedger` (server) → `summarizeJobCostLines` (pure). The job page
 *    Financials card, the ops board, /admin/job-profit-tracker, the goals scorecard, payroll
 *    materialization and the payroll worksheet all go through it.
 *  - `job_product_orders` and the two cost columns are kept (schema is additive-only) but
 *    nothing writes or reads them any more.
 *
 * The lender/dealer fee is NOT a ledger cost. It is `production_jobs.dealer_fee_amount`
 * (from the sold proposal's financing), and signing / the financial-source route mirror it
 * into a system line described exactly `Lender / dealer fee`. The summary leaves that line out
 * of `total` so callers add `dealer_fee_amount` once via `jobDirectCost` — never twice.
 */
import { roundMoney } from '@/lib/money'

/** Exact description of the system line mirrored from `production_jobs.dealer_fee_amount`. */
export const DEALER_FEE_COST_LINE_DESCRIPTION = 'Lender / dealer fee'

export const JOB_COST_TYPES = ['material', 'labor', 'permit', 'subcontractor', 'misc', 'other'] as const
export type JobCostType = (typeof JOB_COST_TYPES)[number]

export const JOB_COST_TYPE_LABELS: Record<JobCostType, string> = {
  material: 'Materials',
  labor: 'Labor',
  subcontractor: 'Subcontractor',
  permit: 'Permit',
  misc: 'Other',
  other: 'Other',
}

export function normalizeJobCostType(value: unknown, fallback: JobCostType = 'other'): JobCostType {
  return (JOB_COST_TYPES as readonly string[]).includes(String(value)) ? (value as JobCostType) : fallback
}

/**
 * Payroll flags every NEW line is born with (decision 2026-10-21).
 *
 * `approved: false` keeps the review trail (the profit tracker flags unreviewed lines).
 * `deduct_from_commission_base: false` because the deduction is not wired into anyone's pay
 * (`payroll_job_snapshots.deductible_costs_total` is written and read by nothing), yet an
 * unapproved line with the flag on BLOCKS the whole job from payroll (`derivePayrollEligibility`
 * → `missing_costs`). Every Materials-tab cost has always been `false`; making the shared write
 * path default to `true` would have stalled payroll on every material receipt. When the owners
 * decide costs should reduce the comp base, flip this — it is the one place.
 */
export const NEW_COST_LINE_PAYROLL_FLAGS = {
  approved: false,
  deduct_from_commission_base: false,
} as const

export type JobCostLedgerLine = {
  id: string
  job_id: string
  description: string
  amount: number
  cost_type: string
  approved: boolean
  deduct_from_commission_base: boolean
  source_product_order_id: string | null
  /** job_cost_line_source enum; null = entered before 2026-10-21 and unclassified. */
  source: JobCostLineSource | null
  vendor_id: string | null
  vendor_name: string | null
  created_at: string
  updated_at: string
}

export const JOB_COST_LINE_SOURCES = [
  'manual',
  'product_order_mirror',
  'legacy_column_import',
  'dealer_fee_sync',
] as const
export type JobCostLineSource = (typeof JOB_COST_LINE_SOURCES)[number]

/** Columns `loadJobCostLedger` selects — the shape every reader gets. */
export const JOB_COST_LEDGER_COLUMNS =
  'id, job_id, description, amount, cost_type, approved, deduct_from_commission_base, source_product_order_id, source, vendor_id, vendor:vendors(name), created_at, updated_at'

export type JobCostSummary = {
  /** cost_type `material` */
  materials: number
  /** cost_type `labor` + `subcontractor` */
  labor: number
  /** everything else (permit, misc, other) except the dealer-fee system line */
  other: number
  /** materials + labor + other. Does NOT include the dealer fee — see `jobDirectCost`. */
  total: number
  /** The mirrored `Lender / dealer fee` line, if any. Informational only. */
  dealerFeeLine: number
  /** Real (non-dealer-fee) lines counted in `total`. */
  lineCount: number
  hasMaterials: boolean
  hasLabor: boolean
  /** Any real line still waiting on a payroll admin's review. */
  hasUnreviewed: boolean
}

export const EMPTY_JOB_COST_SUMMARY: JobCostSummary = Object.freeze({
  materials: 0,
  labor: 0,
  other: 0,
  total: 0,
  dealerFeeLine: 0,
  lineCount: 0,
  hasMaterials: false,
  hasLabor: false,
  hasUnreviewed: false,
}) as JobCostSummary

export function isDealerFeeCostLine(line: { description?: string | null }): boolean {
  return (line.description ?? '').trim() === DEALER_FEE_COST_LINE_DESCRIPTION
}

export type JobCostBucket = 'materials' | 'labor' | 'other'

export function jobCostBucket(costType: string | null | undefined): JobCostBucket {
  if (costType === 'material') return 'materials'
  if (costType === 'labor' || costType === 'subcontractor') return 'labor'
  return 'other'
}

function toMoney(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Pure. Callers must pass only live lines (status `active`, not deleted) — `loadJobCostLedger`
 * and the cost-lines GET route already filter. Negative amounts are returns/credits and net off.
 */
export function summarizeJobCostLines(
  lines: ReadonlyArray<Pick<JobCostLedgerLine, 'amount' | 'cost_type' | 'description'> & { approved?: boolean | null }>
): JobCostSummary {
  let materials = 0
  let labor = 0
  let other = 0
  let dealerFeeLine = 0
  let lineCount = 0
  let hasMaterials = false
  let hasLabor = false
  let hasUnreviewed = false

  for (const line of lines) {
    const amount = toMoney(line.amount)
    if (isDealerFeeCostLine(line)) {
      dealerFeeLine += amount
      continue
    }
    lineCount += 1
    if (line.approved === false) hasUnreviewed = true
    const bucket = jobCostBucket(line.cost_type)
    if (bucket === 'materials') {
      materials += amount
      hasMaterials = true
    } else if (bucket === 'labor') {
      labor += amount
      hasLabor = true
    } else {
      other += amount
    }
  }

  return {
    materials: roundMoney(materials),
    labor: roundMoney(labor),
    other: roundMoney(other),
    total: roundMoney(materials + labor + other),
    dealerFeeLine: roundMoney(dealerFeeLine),
    lineCount,
    hasMaterials,
    hasLabor,
    hasUnreviewed,
  }
}

/** A job's direct cost: the ledger plus the financing dealer fee, counted exactly once. */
export function jobDirectCost(
  summary: Pick<JobCostSummary, 'total'> | null | undefined,
  dealerFeeAmount: number | string | null | undefined
): number {
  return roundMoney((summary?.total ?? 0) + Math.max(0, toMoney(dealerFeeAmount)))
}

export type JobCostLedgerEntry = { lines: JobCostLedgerLine[]; summary: JobCostSummary }
export type JobCostLedger = Map<string, JobCostLedgerEntry>

type LedgerClient = { from: (table: string) => any }

function vendorNameOf(v: unknown): string | null {
  const row = Array.isArray(v) ? v[0] : v
  const name = row && typeof row === 'object' ? (row as { name?: unknown }).name : null
  return typeof name === 'string' && name.trim() ? name.trim() : null
}

const LEDGER_CHUNK = 200
const LEDGER_PAGE = 1000

/**
 * The one server-side read of `job_cost_lines`. Live lines only (status `active`, not soft
 * deleted), org-scoped. Every requested job id gets an entry, so callers never branch on
 * "missing". Throws on a read error — a silently empty ledger reads as $0 cost, i.e. inflated
 * profit, which is worse than a failed page.
 */
export async function loadJobCostLedger(
  client: LedgerClient,
  orgId: string,
  jobIds: ReadonlyArray<string>
): Promise<JobCostLedger> {
  const ids = Array.from(new Set(jobIds.filter(Boolean)))
  const linesByJob = new Map<string, JobCostLedgerLine[]>()
  for (const id of ids) linesByJob.set(id, [])

  for (let i = 0; i < ids.length; i += LEDGER_CHUNK) {
    const chunk = ids.slice(i, i + LEDGER_CHUNK)
    const rows: Array<Record<string, unknown>> = []
    // Page explicitly: PostgREST caps a response at 1,000 rows and truncates silently, which
    // would read as missing costs (inflated profit) on a big date range.
    for (let from = 0; ; from += LEDGER_PAGE) {
      const { data, error } = await client
        .from('job_cost_lines')
        .select(JOB_COST_LEDGER_COLUMNS)
        .eq('org_id', orgId)
        .eq('status', 'active')
        .is('deleted_at', null)
        .in('job_id', chunk)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, from + LEDGER_PAGE - 1)
      if (error) throw error
      const page = (data || []) as Array<Record<string, unknown>>
      rows.push(...page)
      if (page.length < LEDGER_PAGE) break
    }
    for (const raw of rows) {
      const line: JobCostLedgerLine = {
        id: String(raw.id),
        job_id: String(raw.job_id),
        description: String(raw.description ?? ''),
        amount: toMoney(raw.amount),
        cost_type: String(raw.cost_type ?? 'other'),
        approved: raw.approved !== false,
        deduct_from_commission_base: raw.deduct_from_commission_base !== false,
        source_product_order_id: (raw.source_product_order_id as string | null) ?? null,
        source: (JOB_COST_LINE_SOURCES as readonly string[]).includes(String(raw.source))
          ? (raw.source as JobCostLineSource)
          : null,
        vendor_id: (raw.vendor_id as string | null) ?? null,
        vendor_name: vendorNameOf(raw.vendor),
        created_at: String(raw.created_at ?? ''),
        updated_at: String(raw.updated_at ?? raw.created_at ?? ''),
      }
      linesByJob.get(line.job_id)?.push(line)
    }
  }

  const ledger: JobCostLedger = new Map()
  for (const [jobId, lines] of Array.from(linesByJob.entries())) {
    ledger.set(jobId, { lines, summary: summarizeJobCostLines(lines) })
  }
  return ledger
}

export function ledgerSummaryFor(ledger: JobCostLedger, jobId: string): JobCostSummary {
  return ledger.get(jobId)?.summary ?? EMPTY_JOB_COST_SUMMARY
}

/**
 * Ops-board enrichment: attaches `job_costs` (a `JobCostSummary`) to each job row, the same way
 * the board's other enrichers attach payroll/sold-squares fields. Redacted with the other
 * financial summary keys in `lib/ops-access.ts`.
 */
export async function enrichJobsWithCostLedger(
  client: LedgerClient,
  orgId: string,
  jobs: Array<{ id: string } & Record<string, unknown>>
): Promise<void> {
  if (jobs.length === 0) return
  try {
    const ledger = await loadJobCostLedger(
      client,
      orgId,
      jobs.map((j) => j.id)
    )
    for (const job of jobs) {
      job.job_costs = ledgerSummaryFor(ledger, job.id)
    }
  } catch (error) {
    // The board must still load. `job_costs: null` renders "Costs incomplete", never $0 cost.
    console.error('[ops] job cost ledger enrichment failed:', error)
    for (const job of jobs) job.job_costs = null
  }
}

/**
 * Supplier / crew → `vendors` row (org-scoped, matched case-insensitively on name, created on
 * first use). The supplier is a reportable field (`job_cost_lines.vendor_id`), not text glued
 * onto the description. Returns null for a blank name.
 */
export async function resolveVendorId(
  client: LedgerClient,
  orgId: string,
  name: string | null | undefined,
  userId: string | null
): Promise<string | null> {
  const clean = (name ?? '').trim().replace(/\s+/g, ' ')
  if (!clean) return null
  const { data: existing, error: findError } = await client
    .from('vendors')
    .select('id, name')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .ilike('name', clean.replace(/[%_\\]/g, (c) => `\\${c}`))
    .limit(1)
  if (findError) throw findError
  if (existing && existing.length > 0) return String(existing[0].id)
  const { data: created, error: insertError } = await client
    .from('vendors')
    .insert({ org_id: orgId, name: clean, active: true, created_by: userId })
    .select('id')
    .single()
  if (insertError) throw insertError
  return String(created.id)
}

/** A return/refund is stored as a negative amount (how 26-0002's -$446.29 return was mirrored). */
export function signedCostAmount(amount: number, isCredit: boolean): number {
  const abs = Math.abs(toMoney(amount))
  return roundMoney(isCredit ? -abs : abs)
}

export type RecentJobCostLine = {
  id: string
  job_id: string
  description: string
  amount: number
  cost_type: string
  created_at: string
  job: { job_number: string | null; customer_name: string | null } | null
}

/**
 * Org-wide feed of the newest live ledger lines (ops dashboard "Recent material orders").
 * Same filters as `loadJobCostLedger`; the dealer-fee system line is never a "recent cost".
 */
export async function loadRecentJobCostLines(
  client: LedgerClient,
  orgId: string,
  opts: { costType?: JobCostType; limit?: number } = {}
): Promise<RecentJobCostLine[]> {
  const limit = opts.limit ?? 10
  let query = client
    .from('job_cost_lines')
    .select('id, job_id, description, amount, cost_type, created_at, job:production_jobs(job_number, customer:customers(name))')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .neq('description', DEALER_FEE_COST_LINE_DESCRIPTION)
  if (opts.costType) query = query.eq('cost_type', opts.costType)
  const { data, error } = await query.order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)
  return ((data || []) as Array<Record<string, any>>).map((row) => {
    const job = one(row.job)
    const customer = one(job?.customer) as { name?: string | null } | null
    return {
      id: String(row.id),
      job_id: String(row.job_id),
      description: String(row.description ?? ''),
      amount: toMoney(row.amount),
      cost_type: String(row.cost_type ?? 'other'),
      created_at: String(row.created_at ?? ''),
      job: job ? { job_number: job.job_number ?? null, customer_name: customer?.name ?? null } : null,
    }
  })
}
