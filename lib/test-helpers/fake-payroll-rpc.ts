/**
 * In-memory mirror of the payroll RPCs (migrations 202610280010_atomic_approve_and_field_role_deny.sql, 202610210002 and
 * 202611120010_payroll_pay_week_minimums_job_split.sql). The person total is NOT re-implemented here: it is
 * `personTotalsFromTables` from lib/payroll-week-total.ts, the one definition the SQL is parity-tested against. The real
 * SQL is exercised against Postgres in the dress rehearsal; these keep the TypeScript tests honest about what the
 * database does on success and on every refusal (a thrown error rolls the whole fake database back, see fake-db.ts).
 */
import { personTotalsFromTables } from '@/lib/payroll-week-total'
import { nextWeekCutoff, payDateFor, readPayWeekSchedule, sameWeekEnding, weekLabel } from '@/lib/payroll-week-schedule'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const num = (v: unknown) => Number(v) || 0

export function personTotals(tables: Tables, orgId: string, periodId: string): Map<string, number> {
  return personTotalsFromTables(tables, orgId, periodId)
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
    const plan = args.p_plan as { jobs?: Array<{ job_id: string; sale_amount: number | null; commission_comp_base: number | null; snapshot: Row; lines: Row[]; state: Row }>; units?: Array<{ user_id: string; amount: number; detail: unknown }>; minimums?: Array<{ user_id: string; amount: number; detail: unknown }> }
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
    tables.payroll_week_minimums ??= []
    for (const m of tables.payroll_week_minimums) if (m.org_id === orgId && m.payroll_period_id === periodId) Object.assign(m, { amount: 0, detail: null })
    for (const m of plan.minimums ?? []) {
      if (!(m.amount > 0)) continue
      const row = tables.payroll_week_minimums.find((x) => x.payroll_period_id === periodId && x.user_id === m.user_id)
      if (row) Object.assign(row, { amount: r2(m.amount), detail: m.detail })
      else tables.payroll_week_minimums.push({ id: id('min'), org_id: orgId, payroll_period_id: periodId, user_id: m.user_id, amount: r2(m.amount), detail: m.detail, met: null })
    }

    const totals = personTotals(tables, orgId, periodId)
    const total = r2(Array.from(totals.values()).reduce((s, v) => s + Math.max(0, v), 0))
    if (total !== r2(num(args.p_expected_total))) throw new Error(`payroll_commit:total_mismatch:${total}:${r2(num(args.p_expected_total))}`)
    const negatives = Array.from(totals.entries()).filter(([, v]) => v < 0)
    let carried = 0
    if (negatives.length) {
      // find-or-create the next OPEN week in the same transaction (the company's calendar weeks, arx_private.payroll_org_week), verify it is not mid-approval
      const org = (tables.orgs ?? []).find((o) => o.id === orgId)
      const sched = readPayWeekSchedule(org?.settings, (org?.timezone as string) || null)
      let target: Row | null = null
      let tc = nextWeekCutoff(String(period.cutoff_at), sched)
      for (let k = 1; k <= 8 && !target; k++, tc = nextWeekCutoff(tc, sched)) {
        const near = () => (tables.payroll_periods ?? []).find((p) => p.org_id === orgId && p.status !== 'cancelled' && sameWeekEnding(String(p.cutoff_at), tc, sched))
        let cand = near()
        if (!cand) {
          tables.payroll_periods.push({ id: id('wk'), org_id: orgId, period_label: weekLabel(tc, sched), cutoff_at: tc.toISOString(), lock_at: tc.toISOString(), scheduled_pay_date: payDateFor(tc, sched), status: 'open', created_at: new Date().toISOString() })
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
  payroll_set_job_split: (args, tables) => {
    const orgId = args.p_org_id as string
    const jobId = args.p_job_id as string
    if (!String(args.p_reason ?? '').trim()) throw new Error('job_split:reason_required')
    const job = (tables.production_jobs ?? []).find((j) => j.id === jobId && j.org_id === orgId)
    if (!job) throw new Error('job_split:job_not_found')
    if (job.payroll_settled_externally_at) throw new Error('job_split:settled_externally')
    const closed = new Set((tables.payroll_periods ?? []).filter((p) => p.status === 'locked' || p.status === 'paid').map((p) => p.id))
    if ((tables.payroll_payout_lines ?? []).some((l) => l.org_id === orgId && l.job_id === jobId && closed.has(l.payroll_period_id))) throw new Error('job_split:already_paid')
    const claimed = (tables.payroll_periods ?? []).find((p) => p.id === args.p_period_id && p.org_id === orgId && p.lock_claim_token)
    if (claimed) throw Object.assign(new Error('payroll_period_claimed'), { code: '55006' })
    tables.deal_commission_roles ??= []
    tables.payroll_override_audit ??= []
    let changed = 0
    for (const r of (args.p_rows as Array<Record<string, unknown>>) ?? []) {
      if (!(tables.users ?? []).some((u) => u.id === r.user_id && u.org_id === orgId)) throw new Error('job_split:user_not_found')
      let pct = r.override_percent == null ? null : Number(r.override_percent)
      const amt = r.override_amount == null ? null : Number(r.override_amount)
      if (pct != null && (pct < 0 || pct > 100)) throw new Error('job_split:bad_percent')
      if (amt != null && amt < 0) throw new Error('job_split:bad_amount')
      if (pct != null && amt != null) pct = null
      const i = tables.deal_commission_roles.findIndex((d) => d.org_id === orgId && d.job_id === jobId && d.user_id === r.user_id && d.role === r.role)
      const old = i >= 0 ? { ...tables.deal_commission_roles[i] } : null
      if (r.clear) {
        if (i < 0) continue
        tables.deal_commission_roles.splice(i, 1)
      } else if (old) {
        if ((old.override_percent ?? null) === pct && (old.override_amount ?? null) === amt) continue
        Object.assign(tables.deal_commission_roles[i], { override_percent: pct, override_amount: amt })
      } else {
        tables.deal_commission_roles.push({ id: `dcr-${Math.random().toString(36).slice(2, 8)}`, org_id: orgId, job_id: jobId, user_id: r.user_id, role: r.role, override_percent: pct, override_amount: amt })
      }
      tables.payroll_override_audit.push({ org_id: orgId, override_type: 'manual_adjustment', job_id: jobId, payroll_period_id: args.p_period_id, actor_user_id: args.p_actor_user_id, reason: String(args.p_reason).trim(), before_value: old, after_value: r.clear ? null : { override_percent: pct, override_amount: amt, role: r.role, user_id: r.user_id } })
      changed += 1
    }
    return { ok: true, changed }
  },
  payroll_move_open_week: (args, tables) => {
    const orgId = args.p_org_id as string
    const from = (tables.payroll_periods ?? []).find((p) => p.id === args.p_from_id && p.org_id === orgId)
    const to = (tables.payroll_periods ?? []).find((p) => p.id === args.p_to_id && p.org_id === orgId)
    if (args.p_from_id === args.p_to_id) throw new Error('move_week:same_week')
    if (!from || !to) throw new Error('move_week:not_found')
    if (from.status !== 'open' || to.status !== 'open') throw new Error('move_week:not_open')
    if ((tables.payroll_payout_lines ?? []).some((l) => l.payroll_period_id === from.id)) throw new Error('move_week:has_pay_lines')
    const hrs = tables.payroll_rep_hours ?? []
    if (hrs.some((a) => a.payroll_period_id === from.id && hrs.some((b) => b.payroll_period_id === to.id && b.user_id === a.user_id))) throw new Error('move_week:hours_conflict')
    const bon = tables.payroll_bonus_lines ?? []
    if (bon.some((a) => a.payroll_period_id === from.id && !a.source_id && bon.some((b) => b.payroll_period_id === to.id && !b.source_id && b.user_id === a.user_id && b.bonus_type === a.bonus_type))) throw new Error('move_week:bonus_conflict')
    let h = 0, b = 0, a = 0
    for (const r of hrs) if (r.payroll_period_id === from.id) { r.payroll_period_id = to.id; h++ }
    for (const r of bon) if (r.payroll_period_id === from.id) { r.payroll_period_id = to.id; b++ }
    for (const r of tables.payroll_adjustments ?? []) if (r.payroll_period_id === from.id && r.status === 'pending') { r.payroll_period_id = to.id; a++ }
    if (tables.payroll_week_minimums) tables.payroll_week_minimums = tables.payroll_week_minimums.filter((m) => m.payroll_period_id !== from.id)
    from.status = 'cancelled'
    return { ok: true, hours: h, bonuses: b, fixes: a }
  },
}
