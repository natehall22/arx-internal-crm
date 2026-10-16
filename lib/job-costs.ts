/**
 * The one answer to "what did this job cost" (Known Redundancy #11).
 *
 * Precedence, matching the reconciled ARX Tracker sheet:
 *   materials  stored `production_jobs.material_cost` -> else live product orders -> else `material` cost lines
 *   labor      stored `production_jobs.labor_cost`    -> else `labor` + `subcontractor` cost lines
 *   permit     `permit` cost lines
 *   misc       `misc` / `other` cost lines, excluding the lender/dealer-fee line (that is `finance`)
 *   finance    `production_jobs.dealer_fee_amount`    -> else the lender/dealer-fee cost line
 *
 * Material/labor cost lines are NOT added when the column is set: the columns are the reconciled
 * figures and the lines are the supporting detail, so adding both is the double count this module
 * exists to prevent. Pure and client-safe; DB access lives in `loadJobCostInputs`.
 */
import { roundMoney } from '@/lib/money'
import { isMissingJobProductOrdersTable, mapMaterialOrdersRowsToUi } from '@/lib/ops-product-orders'

export type JobCostLineInput = {
  job_id?: string
  amount: number | string | null
  cost_type: string | null
  approved?: boolean | null
  description?: string | null
}

export type JobProductOrderInput = {
  job_id?: string
  amount: number | string | null
  status: string | null
}

export type JobCostInput = {
  materialCostColumn: number | string | null | undefined
  laborCostColumn: number | string | null | undefined
  dealerFeeAmount: number | string | null | undefined
  /** Net of returns; null when the job has no product orders. */
  ordersTotal: number | null
  lines: JobCostLineInput[]
}

export type JobCostSummary = {
  materials: number
  labor: number
  permit: number
  misc: number
  finance: number
  /** materials + labor + permit + misc — the ARX Tracker sheet's "Total Expenses". The sheet leaves finance out of it; the books count `total`. */
  direct: number
  total: number
  /** Share of permit + misc that sits on lines still awaiting approval. */
  pendingExtras: number
  /** Count of ANY active cost line awaiting approval (these block payroll when deductible). */
  pendingLines: number
  /** Where each figure came from, e.g. `materials:column`. */
  sources: string[]
  /** True when the job has cost only in the legacy product orders table. */
  hasLegacyOnly: boolean
}

const JOB_ID_CHUNK = 50
// Anchored to the START of the description so an unrelated line that merely mentions a lender
// ("Lender required roof inspection") is a real extra, not the financing fee. Matches the auto-synced
// "Lender / dealer fee" and the hand-typed "lending fee" / "Lending Fee (Sunlight)" lines in prod.
const LENDER_FEE_LINE = /^\s*(lender|lending|dealer)(\s*\/\s*(lender|dealer))?\s+fees?\b/i

/** The auto-synced / hand-entered lender or dealer financing fee line. Material and labor lines are never fee lines. */
export function isLenderFeeCostLine(line: Pick<JobCostLineInput, 'cost_type' | 'description'>): boolean {
  return !['material', 'labor', 'subcontractor', 'permit'].includes(String(line.cost_type || '')) && LENDER_FEE_LINE.test(line.description || '')
}

function num(value: unknown): number {
  const parsed = Number(value)
  return value == null || value === '' || !Number.isFinite(parsed) ? 0 : parsed
}

function hasValue(value: unknown): boolean {
  return value != null && value !== '' && Number.isFinite(Number(value))
}

/** Net total of product orders; returns subtract. Mirrors `getSignedOrderAmount` in lib/ops-product-orders. */
export function netProductOrdersTotal(orders: JobProductOrderInput[]): number | null {
  if (orders.length === 0) return null
  return roundMoney(
    orders.reduce((sum, o) => sum + (o.status === 'returned' ? -Math.abs(num(o.amount)) : num(o.amount)), 0)
  )
}

export function summarizeJobCosts(input: JobCostInput): JobCostSummary {
  const sources: string[] = []
  const lineSum = (pred: (l: JobCostLineInput) => boolean) =>
    input.lines.filter(pred).reduce((sum, l) => sum + num(l.amount), 0)
  const type = (l: JobCostLineInput) => String(l.cost_type || '')
  const isFeeLine = isLenderFeeCostLine

  let materials: number
  let legacyOnly = false
  if (hasValue(input.materialCostColumn)) {
    materials = num(input.materialCostColumn)
    sources.push('materials:column')
  } else if (input.ordersTotal != null) {
    materials = input.ordersTotal
    legacyOnly = true
    sources.push('materials:product_orders')
  } else {
    materials = lineSum((l) => type(l) === 'material')
    sources.push('materials:cost_lines')
  }

  let labor: number
  if (hasValue(input.laborCostColumn)) {
    labor = num(input.laborCostColumn)
    sources.push('labor:column')
  } else {
    labor = lineSum((l) => type(l) === 'labor' || type(l) === 'subcontractor')
    sources.push('labor:cost_lines')
  }

  const permit = lineSum((l) => type(l) === 'permit')
  const extraMisc = (l: JobCostLineInput) =>
    !['material', 'labor', 'subcontractor', 'permit'].includes(type(l)) && !isFeeLine(l)
  const misc = lineSum(extraMisc)
  const pendingExtras = lineSum((l) => (type(l) === 'permit' || extraMisc(l)) && !l.approved)

  let finance = num(input.dealerFeeAmount)
  if (finance > 0) {
    sources.push('finance:column')
  } else {
    finance = lineSum(isFeeLine)
    if (finance > 0) sources.push('finance:cost_line')
  }

  return {
    materials: roundMoney(materials),
    labor: roundMoney(labor),
    permit: roundMoney(permit),
    misc: roundMoney(misc),
    finance: roundMoney(finance),
    direct: roundMoney(materials + labor + permit + misc),
    total: roundMoney(materials + labor + permit + misc + finance),
    pendingExtras: roundMoney(pendingExtras),
    pendingLines: input.lines.filter((l) => !l.approved).length,
    sources,
    hasLegacyOnly: legacyOnly,
  }
}

/**
 * Batch-load the inputs for many jobs with the filters every reader already used: active,
 * non-deleted cost lines, org-scoped. Product orders are read for the legacy fallback only.
 */
export async function loadJobCostInputs(
  supabase: any,
  orgId: string,
  jobIds: string[]
): Promise<{ lines: Map<string, JobCostLineInput[]>; orders: Map<string, JobProductOrderInput[]> }> {
  const lines = new Map<string, JobCostLineInput[]>()
  const orders = new Map<string, JobProductOrderInput[]>()
  if (jobIds.length === 0) return { lines, orders }

  // Chunk the id list: keeps each request URL short and each result well under PostgREST's 1000-row cap.
  const chunks: string[][] = []
  for (let i = 0; i < jobIds.length; i += JOB_ID_CHUNK) chunks.push(jobIds.slice(i, i + JOB_ID_CHUNK))

  const results = await Promise.all(
    chunks.map(async (ids) => {
      const [linesRes, ordersRes] = await Promise.all([
        supabase
          .from('job_cost_lines')
          .select('job_id, amount, cost_type, approved, description')
          .eq('org_id', orgId)
          .eq('status', 'active')
          .is('deleted_at', null)
          .in('job_id', ids),
        supabase.from('job_product_orders').select('job_id, amount, status').eq('org_id', orgId).in('job_id', ids),
      ])
      if (linesRes.error) throw new Error(`Failed to load job cost lines: ${linesRes.error.message}`)

      let orderRows = (ordersRes.data || []) as JobProductOrderInput[]
      if (ordersRes.error) {
        if (!isMissingJobProductOrdersTable(ordersRes.error)) {
          throw new Error(`Failed to load job product orders: ${ordersRes.error.message}`)
        }
        // Older environments keep orders in `material_orders` (same fallback the order routes use).
        const fallback = await supabase
          .from('material_orders')
          .select('id, org_id, job_id, supplier, items, status, total_cost, notes, created_at')
          .eq('org_id', orgId)
          .in('job_id', ids)
        if (fallback.error) throw new Error(`Failed to load material orders: ${fallback.error.message}`)
        orderRows = mapMaterialOrdersRowsToUi(fallback.data)
      }
      return { lineRows: (linesRes.data || []) as JobCostLineInput[], orderRows }
    })
  )
  for (const { lineRows, orderRows } of results) {
    for (const l of lineRows) lines.set(l.job_id!, [...(lines.get(l.job_id!) || []), l])
    for (const o of orderRows) orders.set(o.job_id!, [...(orders.get(o.job_id!) || []), o])
  }
  return { lines, orders }
}

/**
 * Attach `cost_direct` / `cost_finance` to ops-board job rows (which already select the
 * material_cost / labor_cost / dealer_fee_amount columns). Pass a service client; callers must
 * strip both keys for users without job-financial access (see ops-access redaction).
 */
export async function enrichJobsWithCostSummary(
  supabase: any,
  orgId: string,
  jobs: Array<{ id: string } & Record<string, unknown>>
): Promise<void> {
  let inputs: Awaited<ReturnType<typeof loadJobCostInputs>>
  try {
    inputs = await loadJobCostInputs(supabase, orgId, jobs.map((j) => j.id))
  } catch (error) {
    // The board must still render: without the fields it falls back to the stored columns.
    console.error('[job-costs] cost enrichment failed; ops board falls back to stored columns', error)
    return
  }
  const { lines, orders } = inputs
  for (const job of jobs) {
    const summary = summarizeJobCosts({
      materialCostColumn: job.material_cost as number | null,
      laborCostColumn: job.labor_cost as number | null,
      dealerFeeAmount: job.dealer_fee_amount as number | null,
      ordersTotal: netProductOrdersTotal(orders.get(job.id) || []),
      lines: lines.get(job.id) || [],
    })
    job.cost_direct = summary.direct
    job.cost_finance = summary.finance
  }
}
