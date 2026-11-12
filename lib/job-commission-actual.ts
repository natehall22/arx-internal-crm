/**
 * THE answer to "what does commission cost on this job" for every screen that shows a profit (the job Financials card,
 * the Job profit tracker). It is what PAYROLL computes — never a percentage typed into a screen:
 *
 *   paid     — the job's pay lines on approved weeks (`payroll_payout_lines.net_amount`, summed). What was actually paid.
 *   planned  — the job pays on the next pay week: `planPayrollPeriod`, the very function Pay this week previews and
 *              Approve writes (each person's own plan, the pool cap, minimums and all).
 *   estimate — the job is not payable yet (waiting on money / install): the same function prices it anyway.
 *   null     — the engine could not price it (no commission base, nobody credited): the screen shows "—", never a guess.
 *
 * The commission base itself is lib/job-commission-base.ts (signed contract + change orders, sales tax out, the dealer fee
 * NEVER deducted). Everything here is integer cents. Read-only: nothing is written.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { planPayrollPeriod } from '@/lib/payroll-period-materialization'
import { lateFundingUntil, nextCutoffAfter, payDateFor } from '@/lib/payroll-week-schedule'
import { loadPayWeekSchedule } from '@/lib/payroll-week-schedule-server'
import { randomUUID } from 'crypto'

import type { JobCommission } from '@/lib/job-commission-actual-shared'

export { COMMISSION_SOURCE_LABEL, jobProfitCents, type JobCommission, type JobCommissionSource } from '@/lib/job-commission-actual-shared'

const toCents = (dollars: unknown): number => {
  const n = Number(dollars)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export async function loadJobCommissions(admin: SupabaseClient, orgId: string, jobIds: string[], now: Date = new Date()): Promise<Map<string, JobCommission>> {
  const out = new Map<string, JobCommission>()
  if (jobIds.length === 0) return out

  // 1. Paid: the pay lines of approved weeks.
  const { data: lines } = await admin.from('payroll_payout_lines').select('job_id, net_amount').eq('org_id', orgId).in('job_id', jobIds)
  const paid = new Map<string, number>()
  for (const l of (lines ?? []) as Array<{ job_id: string; net_amount: number | string | null }>) {
    paid.set(l.job_id, (paid.get(l.job_id) ?? 0) + toCents(l.net_amount))
  }
  for (const [jobId, cents] of Array.from(paid)) out.set(jobId, { cents, source: 'paid' })

  // 2. Everything else: the payroll planner on the next pay week (nothing is written, no week has to exist).
  const rest = jobIds.filter((id) => !out.has(id))
  if (rest.length === 0) return out
  try {
    const schedule = await loadPayWeekSchedule(admin, orgId)
    const cutoff = nextCutoffAfter(now, schedule)
    const plan = await planPayrollPeriod(admin, {
      orgId,
      periodId: randomUUID(),
      onlyJobIds: rest,
      includeWaiting: true,
      timeZone: schedule.timeZone,
      lateFundingUntil: lateFundingUntil(cutoff, schedule)?.toISOString() ?? null,
      now,
      simulate: { period: { id: randomUUID(), cutoff_at: cutoff.toISOString(), scheduled_pay_date: payDateFor(cutoff, schedule) }, includeSettledExternally: false },
    })
    const sum = (rows: Array<{ net_amount: number | string | null }>) => rows.reduce((t, r) => t + toCents(r.net_amount), 0)
    for (const j of plan.jobs) if (j.rows.length > 0) out.set(j.job.id, { cents: sum(j.rows), source: 'planned' })
    for (const w of plan.waiting) if (w.rows.length > 0 && !out.has(w.job.id)) out.set(w.job.id, { cents: sum(w.rows), source: 'estimate' })
  } catch (e) {
    // No pay-week setup / engine could not run: those jobs show "—", never a made-up percentage.
    console.error('loadJobCommissions: planner failed', e)
  }
  return out
}
