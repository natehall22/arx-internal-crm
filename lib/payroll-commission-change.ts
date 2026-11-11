/**
 * Commission change lines — when a job's commission base moves AFTER the job was paid (a time & materials job billing more
 * hours, or an invoice voided), the paid week never changes: the next OPEN week gets one signed line per person who was paid
 * on the job, `(new base − base already covered) × that person's paid share`, with the math in plain words. These are
 * ordinary payroll fixes (`payroll_adjustments`, kind 'commission_change', PAY_LINE_SOURCES 'Adjustment'); a negative check
 * carries forward at approve exactly like any other fix. Writer: SQL payroll_add_commission_changes (migration 202611120030),
 * per-job lock + "base covered so far" check, so re-running never pays the same dollars twice.
 *
 * A person's paid share = what their lines on the job paid (net, after the pool cap) ÷ the base the job was paid on.
 * Called after every time & materials base re-sync (lib/job-commission-base.ts syncTimeAndMaterialsCommissionBase).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { roundMoney } from '@/lib/money'
import { orgDb } from '@/lib/supabase/org-db'

export type PaidJobLine = { userId: string; net: number; base: number; periodId: string; cutoffAt: string }

export type CommissionChangeLine = { userId: string; baseDelta: number; amount: number; reason: string; expectedPrior: number }

const fmt = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Pure: the lines to add now. `prior` = per person, the base already covered by earlier change lines on this job. */
export function planCommissionChanges(input: { jobNumber: string | null; currentBase: number; paid: readonly PaidJobLine[]; prior: ReadonlyMap<string, number> }): CommissionChangeLine[] {
  const byUser = new Map<string, { net: number; base: number }>()
  for (const l of input.paid) {
    const u = byUser.get(l.userId) ?? { net: 0, base: l.base }
    u.net = roundMoney(u.net + l.net)
    u.base = Math.max(u.base, l.base)
    byUser.set(l.userId, u)
  }
  const out: CommissionChangeLine[] = []
  for (const [userId, u] of Array.from(byUser.entries())) {
    if (!(u.base > 0) || u.net === 0) continue // no share to scale (nothing paid, or paid on a $0 base)
    const prior = roundMoney(input.prior.get(userId) ?? 0)
    const covered = roundMoney(u.base + prior)
    const baseDelta = roundMoney(input.currentBase - covered)
    if (baseDelta === 0) continue
    const share = u.net / u.base
    const amount = roundMoney(baseDelta * share)
    if (amount === 0) continue
    const job = input.jobNumber ? `job ${input.jobNumber}` : 'a job billed by the hour'
    out.push({
      userId,
      baseDelta,
      amount,
      expectedPrior: prior,
      reason: `Commission change, ${job}: base ${fmt(covered)} → ${fmt(input.currentBase)} (${baseDelta > 0 ? '+' : ''}${fmt(baseDelta)}) × ${(share * 100).toFixed(4)}% = ${fmt(amount)}`,
    })
  }
  return out.sort((a, b) => a.userId.localeCompare(b.userId))
}

/** What the job's paid weeks (approved: locked / paid) paid each person, with the base it was paid on. */
async function loadPaidJobLines(admin: SupabaseClient, orgId: string, jobId: string): Promise<PaidJobLine[] | null> {
  const { data: lines, error } = await orgDb(admin, orgId).from('payroll_payout_lines').select('user_id, net_amount, payroll_period_id, payroll_job_snapshot_id').eq('job_id', jobId).limit(500)
  if (error) return null
  const rows = (lines ?? []) as Array<{ user_id: string; net_amount: number | string; payroll_period_id: string; payroll_job_snapshot_id: string }>
  if (!rows.length) return []
  const periodIds = Array.from(new Set(rows.map((r) => r.payroll_period_id)))
  const { data: periods } = await orgDb(admin, orgId).from('payroll_periods').select('id, status, cutoff_at').in('id', periodIds)
  const approved = new Map(((periods ?? []) as Array<{ id: string; status: string; cutoff_at: string }>).filter((p) => p.status === 'locked' || p.status === 'paid').map((p) => [p.id, p.cutoff_at]))
  const snapIds = Array.from(new Set(rows.map((r) => r.payroll_job_snapshot_id)))
  const { data: snaps } = await orgDb(admin, orgId).from('payroll_job_snapshots').select('id, commission_base').in('id', snapIds)
  const base = new Map(((snaps ?? []) as Array<{ id: string; commission_base: number | string | null }>).map((s) => [s.id, Number(s.commission_base) || 0]))
  return rows
    .filter((r) => approved.has(r.payroll_period_id))
    .map((r) => ({ userId: r.user_id, net: Number(r.net_amount) || 0, base: base.get(r.payroll_job_snapshot_id) ?? 0, periodId: r.payroll_period_id, cutoffAt: approved.get(r.payroll_period_id) as string }))
}

async function loadPrior(admin: SupabaseClient, orgId: string, jobId: string): Promise<Map<string, number>> {
  const { data } = await orgDb(admin, orgId).from('payroll_adjustments').select('user_id, base_delta, status, kind').eq('job_id', jobId).eq('kind', 'commission_change').neq('status', 'void').limit(5000)
  const out = new Map<string, number>()
  for (const r of (data ?? []) as Array<{ user_id: string; base_delta: number | string | null }>) out.set(r.user_id, roundMoney((out.get(r.user_id) ?? 0) + (Number(r.base_delta) || 0)))
  return out
}

export type CommissionChangeResult = { added: number; periodId: string | null; lines: CommissionChangeLine[] }

/**
 * Bring a paid job's commission up to (or down to) its current base on the next open week. Nothing paid yet, or nothing
 * changed = nothing written. Idempotent; a concurrent run is refused by the SQL check and this recomputes once.
 */
export async function syncCommissionChangesForJob(admin: SupabaseClient, orgId: string, jobId: string, actorUserId: string | null = null): Promise<CommissionChangeResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: job } = await orgDb(admin, orgId).from('production_jobs').select('id, job_number, commission_comp_base').eq('id', jobId).maybeSingle()
    if (!job) return { added: 0, periodId: null, lines: [] }
    const paid = await loadPaidJobLines(admin, orgId, jobId)
    if (!paid || paid.length === 0) return { added: 0, periodId: null, lines: [] }
    const lines = planCommissionChanges({
      jobNumber: (job as { job_number?: string | null }).job_number ?? null,
      currentBase: roundMoney(Number((job as { commission_comp_base?: number | string | null }).commission_comp_base) || 0),
      paid,
      prior: await loadPrior(admin, orgId, jobId),
    })
    if (!lines.length) return { added: 0, periodId: null, lines: [] }
    const latest = paid.reduce((a, b) => (a.cutoffAt > b.cutoffAt ? a : b))
    const { ensureNextOpenPeriod } = await import('@/lib/payroll-periods')
    const target = await ensureNextOpenPeriod(admin, orgId, latest.cutoffAt)
    const { data, error } = await admin.rpc('payroll_add_commission_changes', {
      p_org: orgId,
      p_job: jobId,
      p_period: target.id,
      p_source_period: latest.periodId,
      p_actor: actorUserId,
      p_lines: lines.map((l) => ({ user_id: l.userId, amount: l.amount, base_delta: l.baseDelta, reason: l.reason, expected_prior: l.expectedPrior })),
    })
    if (!error) return { added: Number(data) || lines.length, periodId: target.id, lines }
    if (error.code === '40001' && attempt === 0) continue
    throw new Error(`commission change: ${error.message}`)
  }
  return { added: 0, periodId: null, lines: [] }
}
