/**
 * Overhead allocation — "every job completed in a month shoulders an equal share of that month's
 * overhead" (Nathan, Oct 9 2026). Example: 5 jobs completed in a month with $1,200 of admin/business
 * cost → each job carries $240 before its net profit is reported.
 *
 * Pure and client-safe. Not wired into any page yet (see lib/reporting/README.md).
 * Overhead dollars come from wherever the org records non-job expenses (planned `org_expenses`
 * table / `rpt_spend_month`); this module only does the split.
 */
import { roundMoney } from '@/lib/money'
import { EASTERN_TZ, getEasternDateIso } from '@/lib/eastern-datetime'

export type OverheadJobInput = {
  id: string
  /** ISO timestamp or YYYY-MM-DD the job was marked complete; jobs without one are not allocated. */
  completed_at: string | null
}

export type OverheadAllocation = {
  /** job id → allocated overhead dollars */
  byJob: Map<string, number>
  /** YYYY-MM → { overhead, jobs, perJob } */
  byMonth: Map<string, { overhead: number; jobs: number; perJob: number }>
  /** Months that had overhead but no completed jobs (overhead that no job carries). */
  unallocatedMonths: string[]
}

/**
 * Business calendar date (YYYY-MM-DD) of a stored value. `completed_at` is a timestamptz, so a job
 * completed 9pm Eastern on the 31st must land on the 31st, not the 1st — `getEasternDateIso` does that.
 * A bare DATE value ('2026-09-30') is returned as-is: running it through `new Date()` would read it as
 * UTC midnight and shift it to the previous day in Eastern time.
 */
export function businessDateKey(value: string, timeZone: string = EASTERN_TZ): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return getEasternDateIso(value, timeZone) ?? value.slice(0, 10)
}

/** Business month (YYYY-MM) a job was completed in. */
export function completionMonthKey(completedAt: string, timeZone: string = EASTERN_TZ): string {
  return businessDateKey(completedAt, timeZone).slice(0, 7)
}

/**
 * Split each month's overhead evenly across the jobs completed in that month. Cents are distributed
 * so the per-job shares add back to the month total exactly (the first jobs, in id order, take the
 * leftover cent).
 */
export function allocateOverhead(
  jobs: OverheadJobInput[],
  overheadByMonth: Record<string, number> | Map<string, number>,
  timeZone: string = EASTERN_TZ
): OverheadAllocation {
  const overhead = overheadByMonth instanceof Map ? overheadByMonth : new Map(Object.entries(overheadByMonth))
  const jobsByMonth = new Map<string, string[]>()
  const seen = new Set<string>()
  for (const job of jobs) {
    if (!job.completed_at || seen.has(job.id)) continue
    seen.add(job.id)
    const key = completionMonthKey(job.completed_at, timeZone)
    jobsByMonth.set(key, [...(jobsByMonth.get(key) || []), job.id])
  }

  const byJob = new Map<string, number>()
  const byMonth = new Map<string, { overhead: number; jobs: number; perJob: number }>()
  const unallocatedMonths: string[] = []

  for (const [month, rawAmount] of Array.from(overhead.entries())) {
    const amount = roundMoney(rawAmount)
    const ids = (jobsByMonth.get(month) || []).slice().sort()
    if (ids.length === 0) {
      if (amount !== 0) unallocatedMonths.push(month)
      byMonth.set(month, { overhead: amount, jobs: 0, perJob: 0 })
      continue
    }
    const totalCents = Math.round(amount * 100)
    const base = Math.trunc(totalCents / ids.length)
    let remainder = totalCents - base * ids.length
    const step = remainder >= 0 ? 1 : -1
    ids.forEach((id) => {
      let cents = base
      if (remainder !== 0) {
        cents += step
        remainder -= step
      }
      byJob.set(id, cents / 100)
    })
    byMonth.set(month, { overhead: amount, jobs: ids.length, perJob: roundMoney(amount / ids.length) })
  }

  // Completed jobs in months with no recorded overhead carry 0 (explicit, so callers can tell "0" from "not completed").
  jobsByMonth.forEach((ids) => ids.forEach((id) => { if (!byJob.has(id)) byJob.set(id, 0) }))

  return { byJob, byMonth, unallocatedMonths: unallocatedMonths.sort() }
}
