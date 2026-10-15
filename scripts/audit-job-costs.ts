/**
 * Known Redundancy #11 — Phase 1 READ-ONLY audit of job cost.
 *
 * Run: npx tsx --env-file=.env.local scripts/audit-job-costs.ts
 * Out: tmp/job-cost-audit-<date>.csv and tmp/job-cost-audit-<date>-summary.md
 *
 * Only .select() is used. Nothing is written to the database.
 *
 * Every surface (job page, ops board, tracker, goals) now calls summarizeJobCosts, so this prints that one
 * answer per job (shared_*), the product-order / duplicate / payroll-blocker checks, and the OLD job-page
 * figure (orders only, even at $0) so the size of the fix is visible. Payroll keeps its own approved +
 * deduct_from_commission_base logic and is deliberately untouched.
 */
import { createClient } from '@supabase/supabase-js'
import { netProductOrdersTotal, summarizeJobCosts } from '../lib/job-costs'
import { mkdirSync, writeFileSync } from 'node:fs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (use --env-file=.env.local)')
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

const DISAGREE_THRESHOLD = 50
const DUP_AMOUNT_TOL = 1
const DUP_WINDOW_MS = 10 * 60 * 1000
const n = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v))
const has = (v: unknown) => v != null && v !== '' && Number.isFinite(Number(v))
const r2 = (v: number) => Math.round(v * 100) / 100

async function fetchAll<T>(table: string, select: string, build?: (q: any) => any): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    let q: any = supabase.from(table).select(select).range(from, from + 999)
    if (build) q = build(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...((data || []) as T[]))
    if (!data || data.length < 1000) break
  }
  return out
}

type Job = {
  id: string; org_id: string; job_number: string | null; status: string
  sale_amount: number | null; labor_cost: number | null; material_cost: number | null; dealer_fee_amount: number | null
  customer_name?: string | null
}
type Order = { id: string; job_id: string; description: string; amount: number; status: string; created_at: string }
type Line = {
  id: string; job_id: string; description: string; amount: number; cost_type: string
  approved: boolean | null; deduct_from_commission_base: boolean | null; status: string; created_at: string
}

const signed = (o: Order) => (o.status === 'returned' ? -Math.abs(n(o.amount)) : n(o.amount))
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2)
const similar = (a: string, b: string) => {
  const A = new Set(norm(a)); const B = norm(b)
  if (!A.size || !B.length) return false
  return B.filter((w) => A.has(w)).length / Math.min(A.size, B.length) >= 0.5
}

async function main() {
  const jobs = await fetchAll<Job>(
    'production_jobs',
    'id, org_id, job_number, status, sale_amount, labor_cost, material_cost, dealer_fee_amount'
  )
  const orders = await fetchAll<Order>('job_product_orders', 'id, job_id, description, amount, status, created_at')
  // Same filter every live reader uses (status active, not soft-deleted); counted separately below.
  const allLines = await fetchAll<Line & { deleted_at: string | null }>(
    'job_cost_lines',
    'id, job_id, description, amount, cost_type, approved, deduct_from_commission_base, status, created_at, deleted_at'
  )
  const lines = allLines.filter((l) => l.status === 'active' && !l.deleted_at)
  const excludedLines = allLines.length - lines.length

  const ordersBy = new Map<string, Order[]>(); for (const o of orders) ordersBy.set(o.job_id, [...(ordersBy.get(o.job_id) || []), o])
  const linesBy = new Map<string, Line[]>(); for (const l of lines) linesBy.set(l.job_id, [...(linesBy.get(l.job_id) || []), l])

  const rows: Record<string, string | number | boolean>[] = []
  const flags = { dup: [] as string[], disagree: [] as string[], zeroMaterial: [] as string[], blocked: [] as string[] }

  for (const job of jobs.sort((a, b) => String(a.job_number).localeCompare(String(b.job_number)))) {
    const jo = ordersBy.get(job.id) || []
    const jl = linesBy.get(job.id) || []
    const ordersTotal = r2(jo.reduce((s, o) => s + signed(o), 0))
    const byType: Record<string, number> = {}
    for (const l of jl) byType[l.cost_type] = r2((byType[l.cost_type] || 0) + n(l.amount))
    const linesTotal = r2(jl.reduce((s, l) => s + n(l.amount), 0))
    const labor = n(job.labor_cost), dealer = n(job.dealer_fee_amount)
    const matCol = job.material_cost

    const lineMat = byType.material || 0
    const lineLabor = (byType.labor || 0) + (byType.subcontractor || 0)
    const lineMisc = r2(linesTotal - lineMat - lineLabor)

    // --- what every surface now shows: the shared calculator (lib/job-costs) ---
    const shared = summarizeJobCosts({
      materialCostColumn: matCol, laborCostColumn: job.labor_cost, dealerFeeAmount: job.dealer_fee_amount,
      ordersTotal: netProductOrdersTotal(jo), lines: jl,
    })
    // What the job page used to show (orders only, even at $0) — kept only to size what the change fixed.
    const legacyJobPage = r2(labor + ordersTotal)
    const payrollDeductible = r2(jl.filter((l) => l.approved && l.deduct_from_commission_base).reduce((s, l) => s + n(l.amount), 0))
    const blockers = jl.filter((l) => l.deduct_from_commission_base && !l.approved)
    const payrollBlocked = blockers.length > 0
    const spread = r2(Math.abs(shared.direct - legacyJobPage))

    // (a) duplicates: order<->line, or line<->line within 10 min
    const dups: string[] = []
    for (const o of jo) for (const l of jl)
      if (Math.abs(n(o.amount) - n(l.amount)) <= DUP_AMOUNT_TOL && n(o.amount) > 0 && similar(o.description, l.description))
        dups.push(`order "${o.description}" ${n(o.amount)} == line "${l.description}" ${n(l.amount)}`)
    for (let i = 0; i < jl.length; i++) for (let j = i + 1; j < jl.length; j++) {
      const a = jl[i], b = jl[j]
      if (Math.abs(n(a.amount) - n(b.amount)) <= DUP_AMOUNT_TOL && n(a.amount) > 0 &&
          Math.abs(+new Date(a.created_at) - +new Date(b.created_at)) <= DUP_WINDOW_MS && similar(a.description, b.description))
        dups.push(`line "${a.description}" ${n(a.amount)} ~ line "${b.description}" ${n(b.amount)}`)
    }
    // orders vs column: column was overwritten by bulk import / differs from live orders
    const colVsOrders = jo.length && has(matCol) ? r2(n(matCol) - ordersTotal) : 0

    const done = ['complete', 'collected'].includes(job.status)
    const zeroMat = done && n(matCol) === 0 && ordersTotal === 0 && lineMat === 0

    const label = `${job.job_number ?? job.id.slice(0, 8)}`
    if (dups.length) flags.dup.push(`${label}: ${dups.join(' | ')}`)
    if (spread > DISAGREE_THRESHOLD) flags.disagree.push(`${label}: shared ${shared.direct} vs legacy job page ${legacyJobPage}`)
    if (zeroMat) flags.zeroMaterial.push(`${label} [${job.status}]`)
    if (payrollBlocked) flags.blocked.push(`${label} [${job.status}]: ${blockers.map((b) => `${b.description} $${n(b.amount)}`).join('; ')}`)

    rows.push({
      job_number: job.job_number ?? '', job_id: job.id, status: job.status, contract: n(job.sale_amount),
      material_cost_col: has(matCol) ? n(matCol) : '', labor_cost_col: has(job.labor_cost) ? labor : '', dealer_fee: dealer,
      product_orders_n: jo.length, product_orders_total: ordersTotal,
      lines_n: jl.length, lines_material: lineMat, lines_labor_sub: lineLabor, lines_misc_other_permit: lineMisc, lines_total: linesTotal,
      lines_by_type: Object.entries(byType).map(([k, v]) => `${k}:${v}`).join(' '),
      shared_materials: shared.materials, shared_labor: shared.labor, shared_extras: r2(shared.permit + shared.misc), shared_finance: shared.finance, shared_direct: shared.direct, shared_total: shared.total, shared_sources: shared.sources.join(' '), legacy_job_page_direct: legacyJobPage,
      reader_payroll_deductible: payrollDeductible, payroll_blocked: payrollBlocked,
      spread, col_minus_orders: colVsOrders,
      flag_duplicate: dups.length > 0, flag_disagree: spread > DISAGREE_THRESHOLD, flag_zero_material_done: zeroMat, flag_unapproved_deduct: payrollBlocked,
      duplicate_detail: dups.join(' | '),
    })
  }

  const date = new Date().toISOString().slice(0, 10)
  mkdirSync('tmp', { recursive: true })
  const cols = Object.keys(rows[0] || {})
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  writeFileSync(`tmp/job-cost-audit-${date}.csv`, [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'))

  const sec = (title: string, items: string[]) => `## ${title} (${items.length})\n${items.length ? items.map((i) => `- ${i}`).join('\n') : '- none'}\n`
  const unmirrored = orders.length
  const md = [
    `# Job cost audit ${date} (read-only)`,
    `Jobs: ${jobs.length} | job_product_orders rows: ${orders.length} | active job_cost_lines: ${lines.length} (excluded archived/deleted: ${excludedLines})`,
    `Jobs with orders: ${ordersBy.size} | jobs with lines: ${linesBy.size} | jobs with both: ${Array.from(ordersBy.keys()).filter((k) => linesBy.has(k)).length}`,
    `Orders needing a mirrored line in Phase 3 (no link column exists yet): ${unmirrored}`,
    '',
    sec('(a) Likely duplicates', flags.dup),
    sec(`(b) Legacy job-page figure differs from the shared calculator by > $${DISAGREE_THRESHOLD}`, flags.disagree),
    sec('(c) Complete/collected with $0 materials everywhere', flags.zeroMaterial),
    sec('(d) Unapproved deduct_from_commission_base lines (payroll-blocking)', flags.blocked),
  ].join('\n')
  writeFileSync(`tmp/job-cost-audit-${date}-summary.md`, md)
  console.log(md)
  console.log(`\nWrote tmp/job-cost-audit-${date}.csv and -summary.md (no database writes performed)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
