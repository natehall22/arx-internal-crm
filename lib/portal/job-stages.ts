/**
 * The customer portal's job progress — PURE (client-safe). It only re-reads what the app already decided:
 *  - the job's status (`production_jobs.status`, schedule columns written by `syncJobScheduleFromTrades`),
 *  - the materials answer (`lib/job-materials-state.ts`),
 *  - "paid in full" (`lib/job-collection.ts`).
 * There is NO status column of its own. Words come from the company's industry profile terms (install / installed), the same
 * ones the Customer File stepper uses, so another job-based company reads its own words.
 *
 * Cancelled and on-hold jobs get NO stage list: the customer is told to contact us, in words that say nothing about why.
 */
import { BASE_TERMS, type Terms } from '@/lib/industry-profiles'

export type StageTerms = Pick<Terms, 'install' | 'installed'>

export type JobStageKey = 'sold' | 'materials' | 'scheduled' | 'installed' | 'complete'
export type JobStage = { key: JobStageKey; label: string; state: 'done' | 'current' | 'todo' }

export type JobStageInput = {
  status: string
  materialsKey: 'none' | 'not_ordered' | 'partial' | 'ordered' | 'received'
  /** Any active trade has a crew and a day. */
  hasScheduledTrade: boolean
  paidInFull: boolean
}

/** Statuses that mean "the customer should hear from us, not see a progress bar". */
export const PORTAL_QUIET_JOB_STATUSES: readonly string[] = ['cancelled', 'on_hold']
export const isQuietJobStatus = (status: string | null | undefined): boolean => PORTAL_QUIET_JOB_STATUSES.includes(String(status))

const AFTER_MATERIALS = new Set(['scheduled', 'in_progress', 'complete', 'collected'])
const AFTER_SCHEDULED = new Set(['in_progress', 'complete', 'collected'])
const INSTALLED = new Set(['complete', 'collected'])

export function buildJobStages(i: JobStageInput, terms: StageTerms = BASE_TERMS): JobStage[] {
  const installed = INSTALLED.has(i.status)
  const scheduled = installed || AFTER_SCHEDULED.has(i.status) || (i.hasScheduledTrade && !isQuietJobStatus(i.status))
  const materials = scheduled || AFTER_MATERIALS.has(i.status) || i.materialsKey === 'ordered' || i.materialsKey === 'received'
  const done = [true, materials, scheduled, installed, installed && i.paidInFull]
  const defs: Array<[JobStageKey, string]> = [
    ['sold', 'Signed'],
    ['materials', 'Materials ordered'],
    ['scheduled', `${terms.install} scheduled`],
    ['installed', terms.installed],
    ['complete', 'Complete'],
  ]
  const firstOpen = done.findIndex((d) => !d)
  return defs.map(([key, label], idx) => ({ key, label, state: done[idx] ? 'done' : idx === firstOpen ? 'current' : 'todo' }))
}

/* ---- install dates ---------------------------------------------------------------------------------------------------- */

export const DEFAULT_EXACT_DATE_DAYS = 3
export const MAX_EXACT_DATE_DAYS = 14

export function exactDateDays(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isInteger(n) && n >= 0 && n <= MAX_EXACT_DATE_DAYS ? n : DEFAULT_EXACT_DATE_DAYS
}

const dayNumber = (ymd: string): number => Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000)

/** The Monday of the week a calendar day (YYYY-MM-DD) falls in. */
export function mondayOf(ymd: string): string {
  const n = dayNumber(ymd)
  const dow = (new Date(n * 86_400_000).getUTCDay() + 6) % 7 // Monday = 0
  return new Date((n - dow) * 86_400_000).toISOString().slice(0, 10)
}

export type InstallWhen = { kind: 'week'; ymd: string } | { kind: 'day'; ymd: string }

/**
 * "Week of <Monday>" until the day is within `exactDays` days, then the exact day. Computed from the scheduled date every
 * time the page loads, so a reschedule by ops shows up on its own. A day already past gives null (nothing to promise).
 */
export function installWhen(scheduledYmd: string | null | undefined, todayYmd: string, exactDays: number = DEFAULT_EXACT_DATE_DAYS): InstallWhen | null {
  if (!scheduledYmd || !/^\d{4}-\d{2}-\d{2}/.test(scheduledYmd)) return null
  const ymd = scheduledYmd.slice(0, 10)
  const away = dayNumber(ymd) - dayNumber(todayYmd)
  if (away < 0) return null
  return away <= exactDays ? { kind: 'day', ymd } : { kind: 'week', ymd: mondayOf(ymd) }
}
