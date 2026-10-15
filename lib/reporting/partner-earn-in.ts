/**
 * Ownership earn-in tracker — the Cam Hill Ownership Earn-In Agreement (effective 2026-09-14).
 * Quotes below are from that agreement; it, not this file, is the source of truth.
 *
 * Stage 1 (18%): vests "on the first date Cam has both (a) completed 18 months of active service and
 *   (b) reached $2,500,000 in cumulative Qualifying Revenue".
 * Stage 2 (+7%): vests "when ARX generates $3,000,000 in company-wide Revenue during any consecutive
 *   12-month period beginning on or after the initial vesting date". "Revenue counted toward the
 *   first benchmark cannot count toward the second."
 * Section 7 (sale before full vesting): use the LOWER of time progress and revenue progress, times
 *   18% (stage 1) or 7% (stage 2).
 * Revenue (§2): final contract amount of COMPLETED work incl. approved changes/supplements, counted
 *   on completion, no cost deductions. Callers pass the jobs already filtered to that definition;
 *   Qualifying Revenue = Cam's jobs + approved recruits' jobs (team credit is decided upstream).
 *
 * INTERPRETATION (confirm with owners): for the Section 7 stage-2 revenue progress this uses the best
 * 12-month window that starts on/after the vesting date — the same measure that decides stage-2
 * vesting. Read-only math; it does not change ownership records.
 */
import { businessDateKey } from '@/lib/reporting/overhead-allocation'

export const EARN_IN_TERMS = {
  stage1Months: 18,
  stage1Revenue: 2_500_000,
  stage1Pct: 18,
  stage2WindowMonths: 12,
  stage2Revenue: 3_000_000,
  stage2Pct: 7,
} as const

export type EarnInJob = { id: string; completedAt: string; revenue: number }

export type EarnInInput = {
  /** Service commencement date, YYYY-MM-DD. */
  startDate: string
  /** Report date, YYYY-MM-DD. */
  asOf: string
  /** Completed jobs that count as Qualifying Revenue for the partner (own + credited recruits). */
  qualifyingJobs: EarnInJob[]
  /** All completed company jobs (for stage 2). */
  companyJobs: EarnInJob[]
  terms?: typeof EARN_IN_TERMS
}

export type EarnInStatus = {
  monthsServed: number
  qualifyingRevenue: number
  stage1: {
    timeProgress: number
    revenueProgress: number
    vestedOn: string | null
    /** Date the 18-month service mark is/was reached. */
    serviceMarkOn: string
    /** Date cumulative qualifying revenue crossed the threshold, if it has. */
    revenueMarkOn: string | null
  }
  stage2: {
    eligible: boolean
    monthsSinceVesting: number
    bestWindowRevenue: number
    /** All eligible company revenue since vesting (the literal "post-vesting Revenue" reading of §7). */
    postVestingRevenue: number
    bestWindowStart: string | null
    vestedOn: string | null
  }
  vestedPct: number
  /** Section 7 credit if the company sold on `asOf`. */
  saleCreditPct: number
}

/** YYYY-MM-DD + n months (day clamped to month end). */
export function addMonths(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/** Whole months completed from `from` to `to` (a month counts once its anniversary date is reached). */
export function wholeMonthsBetween(from: string, to: string): number {
  if (to < from) return 0
  let n = 0
  while (addMonths(from, n + 1) <= to) n++
  return n
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const round4 = (x: number) => Math.round(x * 10000) / 10000

/** One entry per job id ("Shared jobs receive no duplicate credit"), within [from, asOf], in completion order. */
function normalize(jobs: EarnInJob[], asOf: string, from = ''): EarnInJob[] {
  const seen = new Set<string>()
  return jobs
    .filter((j) => j.completedAt && !seen.has(j.id) && seen.add(j.id))
    .map((j) => ({ ...j, completedAt: businessDateKey(j.completedAt) }))
    .filter((j) => j.completedAt >= from && j.completedAt <= asOf)
    .sort((a, b) => (a.completedAt === b.completedAt ? a.id.localeCompare(b.id) : a.completedAt.localeCompare(b.completedAt)))
}

export function computeEarnIn(input: EarnInInput): EarnInStatus {
  const t = input.terms ?? EARN_IN_TERMS
  const asOf = input.asOf
  const qualifying = normalize(input.qualifyingJobs, asOf, input.startDate)
  const company = normalize(input.companyJobs, asOf)

  const monthsServed = wholeMonthsBetween(input.startDate, asOf)
  const serviceMarkOn = addMonths(input.startDate, t.stage1Months)

  // Stage 1: date cumulative qualifying revenue first reaches the threshold.
  let cumulative = 0
  let revenueMarkOn: string | null = null
  // Jobs whose revenue counted toward the first benchmark (up to and including the one that crossed it).
  const countedInStage1 = new Set<string>()
  for (const job of qualifying) {
    cumulative += job.revenue
    if (revenueMarkOn == null) {
      countedInStage1.add(job.id)
      if (cumulative >= t.stage1Revenue) revenueMarkOn = job.completedAt
    }
  }
  const qualifyingRevenue = Math.round(cumulative * 100) / 100
  const stage1VestedOn =
    revenueMarkOn != null && serviceMarkOn <= asOf ? (revenueMarkOn > serviceMarkOn ? revenueMarkOn : serviceMarkOn) : null

  let bestWindowRevenue = 0
  let bestWindowStart: string | null = null
  let stage2VestedOn: string | null = null
  let postVestingRevenue = 0
  if (stage1VestedOn) {
    // Revenue that counted toward stage 1 never counts toward stage 2.
    const eligible = company.filter((j) => j.completedAt >= stage1VestedOn && !countedInStage1.has(j.id))
    postVestingRevenue = eligible.reduce((s, j) => s + j.revenue, 0)
    // Sliding window ending at each job: jobs completed within the 12 months before it (window start ≥ vesting date).
    let startIdx = 0
    let sum = 0
    for (let i = 0; i < eligible.length; i++) {
      sum += eligible[i].revenue
      while (addMonths(eligible[startIdx].completedAt, t.stage2WindowMonths) <= eligible[i].completedAt) {
        sum -= eligible[startIdx].revenue
        startIdx++
      }
      if (sum > bestWindowRevenue) {
        bestWindowRevenue = sum
        bestWindowStart = eligible[startIdx].completedAt
      }
      if (stage2VestedOn == null && sum >= t.stage2Revenue) stage2VestedOn = eligible[i].completedAt
    }
  }

  const monthsSinceVesting = stage1VestedOn ? wholeMonthsBetween(stage1VestedOn, asOf) : 0
  const stage1Time = clamp01(monthsServed / t.stage1Months)
  const stage1Revenue = clamp01(qualifyingRevenue / t.stage1Revenue)

  let vestedPct = 0
  let saleCreditPct: number
  if (!stage1VestedOn) {
    saleCreditPct = Math.min(stage1Time, stage1Revenue) * t.stage1Pct
  } else if (!stage2VestedOn) {
    vestedPct = t.stage1Pct
    const timeP = clamp01(monthsSinceVesting / t.stage2WindowMonths)
    const revP = clamp01(bestWindowRevenue / t.stage2Revenue)
    saleCreditPct = t.stage1Pct + Math.min(timeP, revP) * t.stage2Pct
  } else {
    vestedPct = t.stage1Pct + t.stage2Pct
    saleCreditPct = vestedPct
  }

  return {
    monthsServed,
    qualifyingRevenue,
    stage1: {
      timeProgress: round4(stage1Time),
      revenueProgress: round4(stage1Revenue),
      vestedOn: stage1VestedOn,
      serviceMarkOn,
      revenueMarkOn,
    },
    stage2: {
      eligible: stage1VestedOn != null,
      monthsSinceVesting,
      bestWindowRevenue: Math.round(bestWindowRevenue * 100) / 100,
      postVestingRevenue: Math.round(postVestingRevenue * 100) / 100,
      bestWindowStart,
      vestedOn: stage2VestedOn,
    },
    vestedPct,
    saleCreditPct: Math.round(saleCreditPct * 100) / 100,
  }
}
