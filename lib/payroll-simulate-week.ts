/**
 * Side-by-side before cutover: what the NEW payroll would have paid each person for a chosen week, computed as a dry run — no week is
 * created, nothing is written. It runs the same planner as Pay this week (planPayrollPeriod) on a week that does not have to exist,
 * on the company's own pay week, and includes jobs that were settled outside the CRM (those are exactly what was paid outside).
 *
 * A job counts in the week its pay first became due: it pays at this week's cutoff (or late-money window) and did NOT at the previous
 * week's. Covered: commission lines and the weekly minimum. Not covered (say so next to the numbers): hourly, per-unit pay, bonuses
 * and fixes — they need rows typed into a real week. ARX reps are commission/bonus only.
 */
import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { roundMoney } from '@/lib/money'
import { paysThisWeek, planPayrollPeriod } from '@/lib/payroll-period-materialization'
import { addWeeks, cutoffInstantForYmd, cutoffWeekday, isYmd, lateFundingUntil, payDateFor, weekdayOfYmd, WEEKDAY_NAMES } from '@/lib/payroll-week-schedule'
import { loadPayWeekSchedule } from '@/lib/payroll-week-schedule-server'
import { parseWeeklyMinimum } from '@/lib/payroll-weekly-minimum'
import { loadPlanForWeek } from '@/lib/payroll-hours'
import type { CrmWeek } from '@/lib/payroll-reconcile'

export type SimulatedPerson = {
  userId: string
  name: string
  /** What the CRM would pay (commission + weekly minimum when the plan needs no office check). */
  total: number
  commission: number
  jobs: string[]
  /** A weekly minimum that needs the office's yes: added only if the week's requirements were met. */
  minimumIfMet: number
}

export type SimulatedWeek = Omit<CrmWeek, 'people'> & { payDate: string; people: SimulatedPerson[] }

export async function simulatePayWeek(admin: SupabaseClient, orgId: string, weekEnding: string, now: Date = new Date()): Promise<SimulatedWeek> {
  if (!isYmd(weekEnding)) throw new Error(`"${weekEnding}" is not a date (YYYY-MM-DD)`)
  const s = await loadPayWeekSchedule(admin, orgId)
  if (weekdayOfYmd(weekEnding) !== cutoffWeekday(s)) throw new Error(`${weekEnding} is not a ${WEEKDAY_NAMES[cutoffWeekday(s)]}: weeks end on ${WEEKDAY_NAMES[cutoffWeekday(s)]} for this company`)
  const cutoff = cutoffInstantForYmd(weekEnding, s)
  const prev = addWeeks(cutoff, -1, s)
  const late = lateFundingUntil(cutoff, s)
  const prevLate = lateFundingUntil(prev, s)
  const fake = { id: randomUUID(), cutoff_at: cutoff.toISOString(), scheduled_pay_date: payDateFor(cutoff, s) }

  const plan = await planPayrollPeriod(admin, {
    orgId,
    periodId: fake.id,
    timeZone: s.timeZone,
    lateFundingUntil: late?.toISOString() ?? null,
    now,
    simulate: { period: fake, includeSettledExternally: true },
  })
  // Only jobs that first became payable this week (not already payable at the previous week's cutoff / late-money window).
  const due = plan.jobs.filter((j) => !paysThisWeek({ eligibleAt: j.eligibleAt, ...(j.eligibility ?? {}) }, prev.toISOString(), prevLate?.toISOString() ?? null, now))

  const byUser = new Map<string, { commission: number; jobs: Set<string> }>()
  for (const j of due) {
    for (const r of j.rows) {
      const cur = byUser.get(r.user_id) ?? { commission: 0, jobs: new Set<string>() }
      cur.commission = roundMoney(cur.commission + roundMoney(Number(r.net_amount) || 0))
      cur.jobs.add(j.job.job_number)
      byUser.set(r.user_id, cur)
    }
  }
  // Weekly minimums: everyone on a plan that has one that week (they may have no commission at all).
  const { data: assigned } = await admin.from('user_comp_plans').select('user_id').eq('org_id', orgId).lte('effective_from', weekEnding).or(`effective_to.is.null,effective_to.gte.${weekEnding}`)
  const ids = Array.from(new Set([...Array.from(byUser.keys()), ...(assigned ?? []).map((a) => a.user_id as string)]))
  const { data: users } = ids.length ? await admin.from('users').select('id, full_name').eq('org_id', orgId).in('id', ids) : { data: [] }
  const names = new Map((users ?? []).map((u) => [u.id as string, (u.full_name as string) || 'Unnamed']))

  const people: SimulatedPerson[] = []
  for (const id of ids) {
    const c = byUser.get(id) ?? { commission: 0, jobs: new Set<string>() }
    const a = await loadPlanForWeek(admin, id, orgId, cutoff.toISOString(), { leftOrSaved: true, clock: { timeZone: s.timeZone } })
    const rule = parseWeeklyMinimum((a?.comp_plans as Record<string, unknown> | null)?.weekly_minimum)
    const gap = rule ? Math.max(0, roundMoney(rule.amount - c.commission)) : 0
    const auto = rule && !rule.needsCheck ? gap : 0
    const total = roundMoney(c.commission + auto)
    if (total === 0 && gap === 0) continue
    people.push({ userId: id, name: names.get(id) ?? 'Unknown', total, commission: c.commission, jobs: Array.from(c.jobs).sort(), minimumIfMet: rule?.needsCheck ? gap : 0 })
  }
  people.sort((x, y) => y.total - x.total || x.name.localeCompare(y.name))
  return { weekEnding, payDate: fake.scheduled_pay_date, people }
}
