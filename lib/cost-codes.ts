/**
 * Cost codes + budget vs actual (project tools). PURE, client-safe.
 *
 * A cost code is a label on a line of THE cost ledger (`job_cost_lines.cost_code`, lib/job-cost-ledger.ts) — never a second
 * place costs live. Lines with no code fall under the code their `cost_type` maps to, so every existing line already has one.
 * A company's own list (`org_cost_codes`) replaces the built-in defaults; codes are turned off, never deleted.
 * A budget is a sibling table keyed (job, code); actuals always come from the ledger.
 */
import { isDealerFeeCostLine } from '@/lib/job-cost-ledger'
import { roundMoney } from '@/lib/money'

export type CostCode = { code: string; label: string; costType: string | null; active: boolean }

/** Built-ins: what a company has until it sets its own. `costType` is the ledger cost_type a line gets for this code. */
export const DEFAULT_COST_CODES: ReadonlyArray<CostCode> = Object.freeze([
  { code: 'materials', label: 'Materials', costType: 'material', active: true },
  { code: 'labor', label: 'Labor', costType: 'labor', active: true },
  { code: 'sub', label: 'Sub', costType: 'subcontractor', active: true },
  { code: 'permit', label: 'Permit', costType: 'permit', active: true },
  { code: 'dump', label: 'Dump', costType: 'other', active: true },
  { code: 'equipment', label: 'Equipment', costType: 'other', active: true },
  { code: 'other', label: 'Other', costType: 'other', active: true },
])

/** The default code a ledger cost_type falls under when its line has no code. */
const CODE_FOR_COST_TYPE: Record<string, string> = { material: 'materials', labor: 'labor', subcontractor: 'sub', permit: 'permit', misc: 'other', other: 'other' }

const CODE_RE = /^[a-z0-9_]{1,40}$/

export function slugifyCostCode(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
}

/** A saved list (rows from org_cost_codes, in order) → the list to use; empty/invalid = the defaults. */
export function resolveCostCodes(rows: ReadonlyArray<{ code?: unknown; label?: unknown; cost_type?: unknown; active?: unknown }> | null | undefined): CostCode[] {
  const out: CostCode[] = []
  const seen = new Set<string>()
  for (const r of rows ?? []) {
    const code = typeof r.code === 'string' ? r.code : ''
    const label = typeof r.label === 'string' ? r.label.trim() : ''
    if (!CODE_RE.test(code) || !label || seen.has(code)) continue
    seen.add(code)
    out.push({ code, label, costType: typeof r.cost_type === 'string' ? r.cost_type : null, active: r.active !== false })
  }
  return out.length > 0 ? out : DEFAULT_COST_CODES.map((c) => ({ ...c }))
}

/** The ledger cost_type a line should get for a code (so the existing Materials/Labor/Other rollups stay right). */
export function costTypeForCode(code: string, codes: ReadonlyArray<CostCode>): string {
  const hit = codes.find((c) => c.code === code)
  if (hit?.costType) return hit.costType
  const builtIn = DEFAULT_COST_CODES.find((c) => c.code === code)
  return builtIn?.costType ?? 'other'
}

/** Which code a ledger line counts under: its own, else the default for its cost_type. */
export function codeForLine(line: { cost_code?: string | null; cost_type?: string | null }): string {
  const own = (line.cost_code ?? '').trim()
  if (own) return own
  return CODE_FOR_COST_TYPE[String(line.cost_type ?? 'other')] ?? 'other'
}

export type BudgetState = 'none' | 'under' | 'near' | 'over'

export type BudgetRow = { code: string; label: string; budget: number | null; actual: number; variance: number | null; state: BudgetState; active: boolean }
export type BudgetView = { rows: BudgetRow[]; totalBudget: number; totalActual: number; totalVariance: number; state: BudgetState }

/** green under 90% of budget, amber 90–100%, red over; no budget = gray (shown, never judged). */
export function budgetState(budget: number | null, actual: number): BudgetState {
  if (budget === null || budget <= 0) return actual > 0 && budget === 0 ? 'over' : 'none'
  if (actual > budget) return 'over'
  return actual >= budget * 0.9 ? 'near' : 'under'
}

/**
 * Budget, actual and variance (budget − actual: positive = money left) per code. Rows: every active code, plus any code that
 * has a budget or spend (a code turned off later, or a line coded before it was removed, never disappears from the totals).
 */
export function buildBudgetView(args: {
  codes: ReadonlyArray<CostCode>
  budgets: ReadonlyArray<{ cost_code: string; amount: number }>
  lines: ReadonlyArray<{ amount: number; cost_type: string; cost_code?: string | null; description?: string | null }>
}): BudgetView {
  const budgetBy = new Map<string, number>()
  for (const b of args.budgets) budgetBy.set(b.cost_code, roundMoney((budgetBy.get(b.cost_code) ?? 0) + Number(b.amount || 0)))
  const actualBy = new Map<string, number>()
  for (const l of args.lines) {
    // The mirrored dealer-fee line is a financing cost, not job cost (lib/job-cost-ledger.ts): never in a budget comparison.
    if (isDealerFeeCostLine(l)) continue
    const code = codeForLine(l)
    actualBy.set(code, roundMoney((actualBy.get(code) ?? 0) + Number(l.amount || 0)))
  }
  const order: CostCode[] = args.codes.map((c) => ({ ...c }))
  const known = new Set(order.map((c) => c.code))
  for (const code of Array.from(new Set([...Array.from(budgetBy.keys()), ...Array.from(actualBy.keys())]))) {
    if (known.has(code)) continue
    const builtIn = DEFAULT_COST_CODES.find((c) => c.code === code)
    order.push({ code, label: builtIn?.label ?? code.replace(/_/g, ' ').replace(/^./, (m) => m.toUpperCase()), costType: builtIn?.costType ?? null, active: false })
  }
  const rows: BudgetRow[] = []
  for (const c of order) {
    const budget = budgetBy.has(c.code) ? (budgetBy.get(c.code) as number) : null
    const actual = actualBy.get(c.code) ?? 0
    if (!c.active && budget === null && actual === 0) continue
    rows.push({ code: c.code, label: c.label, budget, actual, variance: budget === null ? null : roundMoney(budget - actual), state: budgetState(budget, actual), active: c.active })
  }
  const totalBudget = roundMoney(rows.reduce((s, r) => s + (r.budget ?? 0), 0))
  const totalActual = roundMoney(rows.reduce((s, r) => s + r.actual, 0))
  return { rows, totalBudget, totalActual, totalVariance: roundMoney(totalBudget - totalActual), state: budgetState(totalBudget > 0 ? totalBudget : null, totalActual) }
}

export function parseBudgetAmount(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$,\s]/g, ''))
  if (!Number.isFinite(n) || n < 0 || n > 1e9) return null
  return roundMoney(n)
}

export function isCostCodeSlug(v: unknown): v is string {
  return typeof v === 'string' && CODE_RE.test(v)
}
