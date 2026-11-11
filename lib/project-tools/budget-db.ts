/**
 * Budget vs actual (server). Budget lines + history live in job_budget_lines / job_budget_changes (written ONLY by the SQL
 * function set_job_budget_line); actuals come ONLY from the cost ledger (loadJobCostLedger) — never a second reader.
 * A company's cost codes: org_cost_codes (empty = the built-in defaults in lib/cost-codes.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { buildBudgetView, DEFAULT_COST_CODES, isCostCodeSlug, parseBudgetAmount, resolveCostCodes, slugifyCostCode, type BudgetView, type CostCode } from '@/lib/cost-codes'
import { loadJobCostLedger } from '@/lib/job-cost-ledger'
import { orgDb } from '@/lib/supabase/org-db'

export const PROJECT_TOOLS_NOT_READY = 'Project tools need a database update first. Ask your admin to apply it.'

function missingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703' || /does not exist|schema cache/i.test(error.message ?? ''))
}
export { missingTable as isMissingProjectToolsSchema }

export async function loadCostCodes(admin: SupabaseClient, orgId: string): Promise<CostCode[]> {
  const { data, error } = await orgDb(admin, orgId).from('org_cost_codes').select('code, label, cost_type, active, sort_order').order('sort_order', { ascending: true }).order('created_at', { ascending: true })
  if (error) {
    if (!missingTable(error)) console.error('[cost codes] load failed', error)
    return resolveCostCodes(null)
  }
  return resolveCostCodes(data)
}

/** Save the company's list (the whole list, in order). Codes left out are turned OFF, never deleted; a new label gets a slug. */
export async function saveCostCodes(admin: SupabaseClient, orgId: string, input: unknown): Promise<{ codes: CostCode[] } | { error: string; status: number }> {
  if (!Array.isArray(input) || input.length === 0 || input.length > 40) return { error: 'Send 1 to 40 cost codes', status: 400 }
  const rows: Array<{ code: string; label: string; cost_type: string | null; sort_order: number; active: boolean }> = []
  const seen = new Set<string>()
  for (let i = 0; i < input.length; i++) {
    const r = input[i] as { code?: unknown; label?: unknown; costType?: unknown; active?: unknown }
    const label = typeof r.label === 'string' ? r.label.trim().slice(0, 60) : ''
    if (!label) return { error: 'Every cost code needs a name', status: 400 }
    const code = isCostCodeSlug(r.code) ? r.code : slugifyCostCode(label)
    if (!code || seen.has(code)) return { error: `“${label}” is listed twice`, status: 400 }
    seen.add(code)
    const ct = typeof r.costType === 'string' && ['material', 'labor', 'permit', 'subcontractor', 'misc', 'other'].includes(r.costType) ? r.costType : DEFAULT_COST_CODES.find((c) => c.code === code)?.costType ?? 'other'
    rows.push({ code, label, cost_type: ct, sort_order: i, active: r.active !== false })
  }
  const db = orgDb(admin, orgId)
  const { data: existing, error: readErr } = await db.from('org_cost_codes').select('code')
  if (readErr) return missingTable(readErr) ? { error: PROJECT_TOOLS_NOT_READY, status: 409 } : { error: 'Could not save', status: 500 }
  const { error } = await db.from('org_cost_codes').upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: 'org_id,code' })
  if (error) return { error: 'Could not save', status: 500 }
  const gone = (existing ?? []).map((e: { code: string }) => e.code).filter((c: string) => !seen.has(c))
  if (gone.length > 0) await db.from('org_cost_codes').update({ active: false, updated_at: new Date().toISOString() }).in('code', gone)
  return { codes: await loadCostCodes(admin, orgId) }
}

export type BudgetChange = { id: string; cost_code: string; old_amount: number | null; new_amount: number; reason: string | null; changed_at: string; changed_by_name: string | null }

export async function loadBudgetView(admin: SupabaseClient, orgId: string, jobId: string): Promise<{ view: BudgetView; codes: CostCode[]; history: BudgetChange[]; ready: boolean }> {
  const codes = await loadCostCodes(admin, orgId)
  const db = orgDb(admin, orgId)
  const [budgetsRes, historyRes] = await Promise.all([
    db.from('job_budget_lines').select('cost_code, amount').eq('job_id', jobId),
    db.from('job_budget_changes').select('id, cost_code, old_amount, new_amount, reason, changed_at, changed_by, user:users!job_budget_changes_changed_by_fkey(full_name)').eq('job_id', jobId).order('changed_at', { ascending: false }).limit(30),
  ])
  if (budgetsRes.error) {
    if (!missingTable(budgetsRes.error)) console.error('[budget] load failed', budgetsRes.error)
    return { view: buildBudgetView({ codes, budgets: [], lines: [] }), codes, history: [], ready: false }
  }
  // Actuals: the one ledger reader. A failed read must not look like $0 spent.
  const ledger = await loadJobCostLedger(admin, orgId, [jobId], { withCostCodes: true })
  const lines = ledger.get(jobId)?.lines ?? []
  const view = buildBudgetView({ codes, budgets: (budgetsRes.data ?? []).map((b: { cost_code: string; amount: number | string }) => ({ cost_code: b.cost_code, amount: Number(b.amount) })), lines })
  const history: BudgetChange[] = (historyRes.data ?? []).map((h: Record<string, unknown>) => {
    const u = Array.isArray(h.user) ? h.user[0] : h.user
    return {
      id: String(h.id),
      cost_code: String(h.cost_code),
      old_amount: h.old_amount === null || h.old_amount === undefined ? null : Number(h.old_amount),
      new_amount: Number(h.new_amount),
      reason: (h.reason as string | null) ?? null,
      changed_at: String(h.changed_at),
      changed_by_name: (u as { full_name?: string } | null)?.full_name ?? null,
    }
  })
  return { view, codes, history, ready: true }
}

export async function setBudgetLine(admin: SupabaseClient, ctx: { orgId: string; userId: string; jobId: string }, input: { code?: unknown; amount?: unknown; reason?: unknown }): Promise<{ changed: boolean } | { error: string; status: number }> {
  if (!isCostCodeSlug(input.code)) return { error: 'Pick a cost code', status: 400 }
  const amount = parseBudgetAmount(input.amount)
  if (amount === null) return { error: 'Enter an amount of $0 or more', status: 400 }
  const codes = await loadCostCodes(admin, ctx.orgId)
  if (!codes.some((c) => c.code === input.code)) return { error: 'That cost code is not on your list', status: 400 }
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 300) : ''
  const { data, error } = await admin.rpc('set_job_budget_line', { p_org: ctx.orgId, p_job: ctx.jobId, p_code: input.code, p_amount: amount, p_user: ctx.userId, p_reason: reason })
  if (error) {
    if (missingTable(error) || error.code === '42883' || error.code === 'PGRST202') return { error: PROJECT_TOOLS_NOT_READY, status: 409 }
    if (error.code === 'P0002') return { error: 'Job not found', status: 404 }
    return { error: 'Could not save the budget', status: 500 }
  }
  return { changed: (data as { changed?: boolean } | null)?.changed !== false }
}
