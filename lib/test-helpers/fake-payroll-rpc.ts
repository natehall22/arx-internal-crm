/**
 * In-memory mirror of the two payroll RPCs (migration 202610280010_atomic_approve_and_field_role_deny.sql + 202610210002). The real
 * SQL is exercised against Postgres in the dress rehearsal; these keep the TypeScript tests honest about what the
 * database does on success and on every refusal (a thrown error rolls the whole fake database back, see fake-db.ts).
 */
import { addEasternDays, cutoffYmdEt, weeklyPayrollPayDateForCutoff } from '@/lib/weekly-payroll/cutoff'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const num = (v: unknown) => Number(v) || 0

export function personTotals(tables: Tables, orgId: string, periodId: string): Map<string, number> {
  const by = new Map<string, number>()
  const add = (u: unknown, n: number) => by.set(u as string, r2((by.get(u as string) ?? 0) + r2(n)))
  const mine = (t: string) => (tables[t] ?? []).filter((r) => r.org_id === orgId && r.payroll_period_id === periodId)
  for (const l of mine('payroll_payout_lines')) add(l.user_id, num(l.net_amount))
  for (const h of mine('payroll_rep_hours')) if (num(h.hourly_earnings) > 0) add(h.user_id, num(h.hourly_earnings))
  for (const u of mine('payroll_unit_earnings')) if (num(u.amount) > 0) add(u.user_id, num(u.amount))
  for (const b of mine('payroll_bonus_lines')) if (b.status === 'approved' || b.status === 'paid') add(b.user_id, num(b.amount))
  for (const a of mine('payroll_adjustments')) if (a.status !== 'void') add(a.user_id, num(a.amount))
  return by
}

export const fakePayrollRpcs: Record<string, (args: Record<string, unknown>, tables: Tables) => unknown> = {
  payroll_claim_period_lock: (args, tables) => {
    const row = (tables.payroll_periods ?? []).find((r) => r.id === args.p_period_id && r.status === 'open' && !r.lock_claim_token)
    if (!row) return false
    row.lock_claim_token = args.p_token
    row.lock_claimed_at = new Date().toISOString()
    return true
  },
  payroll_commit_week: (args, tables) => {
    const orgId = args.p_org_id as string
    const periodId = args.p_period_id as string
    const plan = args.p_plan as { jobs?: Array<{ job_id: string; sale_amount: number | null; commission_comp_base: number | null; snapshot: Row; lines: Row[]; state: Row }>; units?: Array<{ user_id: string; amount: number; detail: unknown }> }
    const period = (tables.payroll_periods ?? []).find((p) => p.id === periodId && p.org_id === orgId)
    if (!period) throw new Error('payroll_commit:not_found')
    if (period.status !== 'open' || period.lock_claim_token !== args.p_token) throw new Error('payroll_commit:claim_lost')
    const earlier = (tables.payroll_adjustments ?? []).some((a) => {
      const pp = (tables.payroll_periods ?? []).find((p) => p.id === a.payroll_period_id)
      return a.org_id === orgId && a.status === 'pending' && pp?.status === 'open' && pp.id !== periodId && String(pp.cutoff_at) < String(period.cutoff_at)
    })
    if (earlier) throw new Error('payroll_commit:earlier_week_open')

    tables.payroll_job_snapshots ??= []
    tables.payroll_payout_lines ??= []
    tables.job_payroll_state ??= []
    tables.payroll_unit_earnings ??= []
    tables.payroll_adjustments ??= []
    let n = 0
    const id = (p: string) => `${p}-${++n}-${Math.random().toString(36).slice(2, 7)}`
    let lines = 0
    for (const j of plan.jobs ?? []) {
      const job = (tables.production_jobs ?? []).find((x) => x.id === j.job_id && x.org_id === orgId)
      if (!job || !['complete', 'collected'].includes(String(job.status)) || job.payroll_settled_externally_at || (job.sale_amount ?? null) !== (j.sale_amount ?? null) || (job.commission_comp_base ?? null) !== (j.commission_comp_base ?? null)) {
        throw new Error(`payroll_commit:job_changed:${j.job_id}`)
      }
      const other = tables.payroll_job_snapshots.find((s) => s.job_id === j.job_id && s.payroll_period_id !== periodId)
      if (other) throw Object.assign(new Error(`payroll_already_paid: job ${j.job_id} is already snapshotted in payroll period ${other.payroll_period_id}`), { code: '23505' })
      const snapId = id('snap')
      tables.payroll_job_snapshots = tables.payroll_job_snapshots.filter((s) => !(s.job_id === j.job_id && s.payroll_period_id === periodId))
      tables.payroll_job_snapshots.push({ ...j.snapshot, id: snapId })
      for (const l of j.lines) {
        if (tables.payroll_payout_lines.some((e) => e.payroll_period_id === periodId && e.job_id === l.job_id && e.user_id === l.user_id && e.participant_role === l.participant_role)) continue
        tables.payroll_payout_lines.push({ ...l, id: id('line'), payroll_job_snapshot_id: snapId })
        lines += 1
      }
      const st = tables.job_payroll_state.find((s) => s.job_id === j.job_id)
      if (st) Object.assign(st, j.state)
      else tables.job_payroll_state.push({ ...j.state })
    }
    tables.payroll_unit_earnings = tables.payroll_unit_earnings.filter((u) => !(u.org_id === orgId && u.payroll_period_id === periodId))
    for (const u of plan.units ?? []) if (u.amount > 0) tables.payroll_unit_earnings.push({ org_id: orgId, payroll_period_id: periodId, user_id: u.user_id, amount: r2(u.amount), detail: u.detail })

    const totals = personTotals(tables, orgId, periodId)
    const total = r2(Array.from(totals.values()).reduce((s, v) => s + Math.max(0, v), 0))
    if (total !== r2(num(args.p_expected_total))) throw new Error(`payroll_commit:total_mismatch:${total}:${r2(num(args.p_expected_total))}`)
    const negatives = Array.from(totals.entries()).filter(([, v]) => v < 0)
    let carried = 0
    if (negatives.length) {
      // find-or-create the next OPEN week in the same transaction (Eastern calendar weeks), verify it is not mid-approval
      let target: Row | null = null
      for (let k = 1; k <= 8 && !target; k++) {
        const tc = addEasternDays(String(period.cutoff_at), 7 * k)
        const near = () => (tables.payroll_periods ?? []).find((p) => p.org_id === orgId && p.status !== 'cancelled' && Math.abs(new Date(String(p.cutoff_at)).getTime() - tc.getTime()) <= 36 * 3_600_000)
        let cand = near()
        if (!cand) {
          tables.payroll_periods.push({ id: id('wk'), org_id: orgId, period_label: `Week ending ${cutoffYmdEt(tc)}`, cutoff_at: tc.toISOString(), lock_at: tc.toISOString(), scheduled_pay_date: weeklyPayrollPayDateForCutoff(tc), status: 'open', created_at: new Date().toISOString() })
          cand = near()
        }
        if (cand && cand.status === 'open') {
          if (cand.lock_claim_token) throw new Error('payroll_commit:next_week_busy')
          target = cand
        }
      }
      if (!target) throw new Error('payroll_commit:no_next_period')
      for (const [userId, amount] of negatives) {
        if (tables.payroll_adjustments.some((a) => a.kind === 'balance' && a.status !== 'void' && a.source_period_id === periodId && a.user_id === userId)) continue
        tables.payroll_adjustments.push({ id: id('adj'), org_id: orgId, payroll_period_id: target.id, user_id: userId, amount, reason: 'Carried over', kind: 'balance', status: 'pending', source_period_id: periodId, created_by: args.p_actor_user_id })
        carried += 1
      }
    }
    for (const a of tables.payroll_adjustments) if (a.org_id === orgId && a.payroll_period_id === periodId && a.status === 'pending') Object.assign(a, { status: 'applied', applied_at: new Date().toISOString() })
    Object.assign(period, { status: 'locked', locked_at: new Date().toISOString(), units_frozen_at: new Date().toISOString(), lock_claimed_at: null, lock_claim_token: null })
    return { ok: true, total, people: Array.from(totals.values()).filter((v) => v > 0).length, snapshots: (plan.jobs ?? []).length, lines, carried }
  },
}
