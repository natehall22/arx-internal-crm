import { easternWeekdayIndex, listEasternDatesInRange, toEasternDateIso } from '@/lib/goals-period'

export type ForecastMetricKey =
  | 'doors'
  | 'sets'
  | 'sits'
  | 'sales'
  | 'revenueSigned'
  | 'revenueCollected'

export type RateWindow = '90d' | '180d' | 'all'

export type RateAssumption = {
  key: 'doorToSet' | 'setToSit' | 'sitToSale' | 'setToSaleLag'
  label: string
  kind: 'rate' | 'days'
  value: number | null
  window: RateWindow | null
  sampleSize: number
  note?: string
}

export type ForecastMetricOutput = {
  /** Booked/recorded so far inside the range, up to `asOf`. */
  actual: number
  /** End-of-range expectation, inclusive of `actual`. */
  projectedTotal: number
  goal: number | null
  /** goal − projectedTotal. Positive means short of goal. */
  gapToGoal: number | null
}

export type WeeklyTrendPoint = {
  weekStart: string
  sets: number
  sits: number
  sales: number
}

/** How the range's goal was assembled from per-month `org_monthly_goals` rows. */
export type GoalCoverage = {
  months: string[]
  monthsMissingGoal: string[]
  /** True when the range covers only part of at least one month, so its goal was prorated by day count. */
  prorated: boolean
}

export type ForecastResult = {
  rangeStart: string
  rangeEnd: string
  asOf: string
  metrics: Record<ForecastMetricKey, ForecastMetricOutput>
  weeklyTrend: WeeklyTrendPoint[]
  assumptions: RateAssumption[]
  goalCoverage: GoalCoverage
}

export type HistorySet = {
  at: string
  opportunityId: string | null
  leadId: string | null
}

export type HistorySit = {
  at: string
  opportunityId: string
  leadId: string | null
}

export type HistorySale = {
  signedAt: string
  projectCost: number
  opportunityId: string | null
}

export type ForecastHistory = {
  doors: string[]
  sets: HistorySet[]
  sits: HistorySit[]
  sales: HistorySale[]
  payments: { paidAt: string; amount: number }[]
}

export type ForecastGoals = Partial<Record<ForecastMetricKey, number | null>>

const MS_DAY = 86_400_000

/**
 * A set's outcome is normally recorded on the appointment day, but reps enter it
 * late often enough that grading the last few days as "no-show" understates the rate.
 * Sets scheduled inside this window are excluded from the set→sit denominator.
 */
const SET_TO_SIT_MATURITY_DAYS = 7

/** Fallback maturity/lag when there aren't enough closed sit→sale pairs to measure one. */
const DEFAULT_SIT_TO_SALE_LAG_DAYS = 21

/** A sit older than this is treated as dead pipeline, not a live chance to close. */
const MAX_OPEN_SIT_AGE_DAYS = 90

/** Beyond this, a set/sit-to-signing gap is data entry noise rather than a real sales cycle. */
const MAX_PLAUSIBLE_LAG_DAYS = 180

/** Minimum matured records before a conversion rate is trusted over a wider window. */
const MIN_RATE_SAMPLE = 10

/** Doors are high-volume, so the door→set ratio needs a proportionally larger denominator. */
const MIN_DOOR_SAMPLE = 100

/** Below this many observed lags, the CDF falls back to a linear ramp. */
const MIN_LAG_CDF_SAMPLE = 8

function inRange(iso: string, start: Date, end: Date, asOf?: Date): boolean {
  const t = new Date(iso).getTime()
  const s = start.getTime()
  const e = (asOf ?? end).getTime()
  return Number.isFinite(t) && t >= s && t < e
}

function median(values: number[]): number {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function percentile(values: number[], p: number): number {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

function daysAgo(asOf: Date, days: number): Date {
  return new Date(asOf.getTime() - days * MS_DAY)
}

function ms(iso: string): number {
  return new Date(iso).getTime()
}

type ConversionRateResult = { rate: number; window: RateWindow; n: number }

const RATE_WINDOWS: { window: RateWindow; days: number }[] = [
  { window: '90d', days: 90 },
  { window: '180d', days: 180 },
  { window: 'all', days: 3650 },
]

/**
 * First window (90d → 180d → all-time) with at least `minN` matured records.
 * `records.at` is when the record entered the stage; `converted` is whether it
 * reached the next stage. Records newer than `maturityDays` are excluded entirely —
 * counting them as failures would drag every rate toward zero.
 */
function pickConversionRate(
  records: { at: string; converted: boolean }[],
  asOf: Date,
  maturityDays: number,
  minN = MIN_RATE_SAMPLE
): ConversionRateResult {
  const maturedBefore = daysAgo(asOf, maturityDays).getTime()
  const matured = records.filter((row) => {
    const t = ms(row.at)
    return Number.isFinite(t) && t < maturedBefore
  })

  for (const { window, days } of RATE_WINDOWS) {
    const start = daysAgo(asOf, days).getTime()
    const sample = matured.filter((row) => ms(row.at) >= start)
    if (sample.length >= minN) {
      return { rate: sample.filter((r) => r.converted).length / sample.length, window, n: sample.length }
    }
  }

  const conversions = matured.filter((row) => row.converted).length
  return {
    rate: matured.length > 0 ? conversions / matured.length : 0,
    window: 'all',
    n: matured.length,
  }
}

/**
 * Expected events across the remaining days of the range, using each weekday's own
 * trailing average — Saturday and Sunday knock volume looks nothing like Tuesday's,
 * so a flat daily rate skews any range that doesn't end on a week boundary.
 */
function weekdayRunRate(events: string[], asOf: Date, rangeEnd: Date, historyWeeks = 8): number {
  const asOfMs = asOf.getTime()
  const historyStartMs = daysAgo(asOf, historyWeeks * 7).getTime()

  const weekdayTotals = Array.from({ length: 7 }, () => 0)
  const weeksWithData = new Set<number>()
  let total = 0

  for (const iso of events) {
    const t = ms(iso)
    if (!Number.isFinite(t) || t < historyStartMs || t >= asOfMs) continue
    weekdayTotals[easternWeekdayIndex(iso)] += 1
    weeksWithData.add(Math.floor((asOfMs - t) / (7 * MS_DAY)))
    total += 1
  }

  const flatDaily = total > 0 ? total / (historyWeeks * 7) : 0
  // With a full history every weekday slot has 8 observations, so the per-weekday
  // average stands on its own. With gaps, a weekday that happens to have no history
  // falls back to the flat daily rate rather than projecting zero.
  const hasFullHistory = weeksWithData.size >= historyWeeks

  let projected = 0
  for (const date of listEasternDatesInRange(asOf.toISOString(), rangeEnd.toISOString())) {
    const wd = easternWeekdayIndex(`${date}T12:00:00.000Z`)
    const weekdayAvg = weekdayTotals[wd] / historyWeeks
    projected += hasFullHistory || weekdayAvg > 0 ? weekdayAvg : flatDaily
  }

  return projected
}

/** Key a set to the pipeline record it belongs to: opportunity when present, else lead. */
function setKey(set: HistorySet): string | null {
  if (set.opportunityId) return `opp:${set.opportunityId}`
  if (set.leadId) return `lead:${set.leadId}`
  return null
}

function sitKeys(sit: HistorySit): string[] {
  const keys = [`opp:${sit.opportunityId}`]
  if (sit.leadId) keys.push(`lead:${sit.leadId}`)
  return keys
}

/**
 * Doors → sets is a volume ratio, not a per-record join: a knock that books an
 * inspection isn't linked back to the door pin it came from. Measured over whole
 * windows, with doors as the denominator sample.
 */
function computeDoorToSetRate(doors: string[], sets: HistorySet[], asOf: Date): ConversionRateResult {
  const asOfMs = asOf.getTime()
  const countSince = (times: number[], startMs: number) =>
    times.reduce((n, t) => (t >= startMs && t < asOfMs ? n + 1 : n), 0)

  const doorTimes = doors.map(ms)
  const setTimes = sets.map((s) => ms(s.at))

  for (const { window, days } of RATE_WINDOWS) {
    const start = daysAgo(asOf, days).getTime()
    const doorCount = countSince(doorTimes, start)
    if (doorCount >= MIN_DOOR_SAMPLE) {
      return { rate: countSince(setTimes, start) / doorCount, window, n: doorCount }
    }
  }

  const doorCount = countSince(doorTimes, -Infinity)
  return {
    rate: doorCount > 0 ? countSince(setTimes, -Infinity) / doorCount : 0,
    window: 'all',
    n: doorCount,
  }
}

/**
 * Share of sets that produced a qualifying inspection outcome on the SAME pipeline
 * record. The previous implementation matched a set to any sit on the same calendar
 * date anywhere in the org, which measured daily activity overlap rather than
 * conversion.
 */
function computeSetToSitRate(sets: HistorySet[], sits: HistorySit[], asOf: Date): ConversionRateResult {
  const sitOppIds = new Set<string>()
  const latestSitByLead = new Map<string, number>()
  for (const sit of sits) {
    const t = ms(sit.at)
    if (!Number.isFinite(t)) continue
    sitOppIds.add(sit.opportunityId)
    if (sit.leadId) {
      const existing = latestSitByLead.get(sit.leadId)
      if (existing == null || t > existing) latestSitByLead.set(sit.leadId, t)
    }
  }

  const records = sets.map((set) => {
    // An opportunity is a single deal, so any qualifying outcome on it means this
    // appointment sat. Outcome timestamps are entered by hand and routinely land
    // out of order relative to the appointment, so ordering is NOT required here.
    if (set.opportunityId) {
      return { at: set.at, converted: sitOppIds.has(set.opportunityId) }
    }
    // Lead-keyed fallback: a lead can be re-knocked and span several deals over
    // time, so only credit a sit on or after this appointment's day.
    const latest = set.leadId ? latestSitByLead.get(set.leadId) : undefined
    const setAt = ms(set.at)
    const setDayStart = setAt - (setAt % MS_DAY)
    return { at: set.at, converted: latest != null && latest >= setDayStart }
  })

  return pickConversionRate(records, asOf, SET_TO_SIT_MATURITY_DAYS)
}

/**
 * Days from a stage timestamp to the opportunity's first signing at or after it.
 * `null` when the opportunity never sold, sold beforehand, or the gap is too large
 * to be a real sales cycle.
 */
function signingLagDays(
  salesByOpp: Map<string, number[]>,
  opportunityId: string,
  fromMs: number,
  beforeMs = Infinity
): { signedAtMs: number; lagDays: number } | null {
  const signings = salesByOpp.get(opportunityId)
  if (!signings || !Number.isFinite(fromMs)) return null

  let earliest = Infinity
  for (const t of signings) {
    if (t >= fromMs && t < beforeMs && t < earliest) earliest = t
  }
  if (!Number.isFinite(earliest)) return null

  const lagDays = Math.round((earliest - fromMs) / MS_DAY)
  if (lagDays < 0 || lagDays > MAX_PLAUSIBLE_LAG_DAYS) return null
  return { signedAtMs: earliest, lagDays }
}

/** Days from sit to signed contract, for sits that did close. Drives maturity + landing math. */
function sitToSaleLagSamples(sits: HistorySit[], salesByOpp: Map<string, number[]>): number[] {
  const lags: number[] = []
  for (const sit of sits) {
    const lag = signingLagDays(salesByOpp, sit.opportunityId, ms(sit.at))
    if (lag) lags.push(lag.lagDays)
  }
  return lags
}

/**
 * Share of sits that became a signed contract on the SAME opportunity. The previous
 * implementation counted a sit as converted if any sale anywhere in the org was
 * signed on or after that date, which made the rate approach 100% by construction.
 */
function computeSitToSaleRate(
  sits: HistorySit[],
  salesByOpp: Map<string, number[]>,
  maturityDays: number,
  asOf: Date
): ConversionRateResult {
  // A signed contract on the opportunity IS the conversion, regardless of whether
  // it predates the recorded outcome timestamp. Verified against production: 11 of
  // 28 sold opportunities were signed BEFORE their inspection outcome was saved,
  // because reps set the outcome to "Sale" after the paperwork. Requiring the sale
  // to follow the sit discarded those as losses.
  const records = sits.map((sit) => ({
    at: sit.at,
    converted: (salesByOpp.get(sit.opportunityId)?.length ?? 0) > 0,
  }))
  return pickConversionRate(records, asOf, maturityDays)
}

function medianSaleValue(sales: HistorySale[], asOf: Date): { value: number; n: number; window: RateWindow } {
  for (const { window, days } of RATE_WINDOWS) {
    const start = daysAgo(asOf, days)
    const sample = sales.filter((s) => inRange(s.signedAt, start, asOf))
    if (sample.length >= MIN_RATE_SAMPLE) {
      return { value: median(sample.map((s) => s.projectCost)), n: sample.length, window }
    }
  }
  const all = sales.filter((s) => ms(s.signedAt) < asOf.getTime())
  return { value: median(all.map((s) => s.projectCost)), n: all.length, window: 'all' }
}

/** Median days from the first set on an opportunity to its signed contract. */
function medianSetToSaleLag(
  sets: HistorySet[],
  salesByOpp: Map<string, number[]>,
  asOf: Date
): { lagDays: number; n: number; window: RateWindow; samples: number[] } {
  const firstSetByOpp = new Map<string, number>()
  for (const set of sets) {
    if (!set.opportunityId) continue
    const t = ms(set.at)
    if (!Number.isFinite(t)) continue
    const existing = firstSetByOpp.get(set.opportunityId)
    if (existing == null || t < existing) firstSetByOpp.set(set.opportunityId, t)
  }

  const lags: { at: number; lag: number }[] = []
  for (const [oppId, setAt] of Array.from(firstSetByOpp.entries())) {
    const lag = signingLagDays(salesByOpp, oppId, setAt, asOf.getTime())
    if (lag) lags.push({ at: lag.signedAtMs, lag: lag.lagDays })
  }

  for (const { window, days } of RATE_WINDOWS) {
    const start = daysAgo(asOf, days).getTime()
    const sample = lags.filter((l) => l.at >= start).map((l) => l.lag)
    if (sample.length >= MIN_RATE_SAMPLE) {
      return { lagDays: Math.round(median(sample)), n: sample.length, window, samples: sample }
    }
  }
  const all = lags.map((l) => l.lag)
  return {
    lagDays: all.length > 0 ? Math.round(median(all)) : DEFAULT_SIT_TO_SALE_LAG_DAYS,
    n: all.length,
    window: 'all',
    samples: all,
  }
}

/**
 * Cumulative share of eventual conversions that have signed by `days` after entering
 * the stage. Built from observed lags when there are enough of them, otherwise a
 * linear ramp over `fallbackLagDays` (median → half done, 2× median → all done).
 */
function buildLagCdf(lagSamples: number[], fallbackLagDays: number): (days: number) => number {
  const sorted = lagSamples.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b)
  if (sorted.length < MIN_LAG_CDF_SAMPLE) {
    const span = Math.max(1, fallbackLagDays * 2)
    return (days) => (days <= 0 ? 0 : Math.min(1, days / span))
  }
  return (days) => {
    if (days <= 0) return 0
    let count = 0
    for (const lag of sorted) {
      if (lag <= days) count += 1
      else break
    }
    return count / sorted.length
  }
}

/**
 * Expected share of a cohort's eventual conversions that land inside the remaining
 * window, for records that entered the stage `ageDays` ago. A sit that is already
 * older than the whole observed lag distribution contributes nothing — which is what
 * makes stale pipeline stop inflating the projection.
 */
function conversionShareInWindow(
  cdf: (days: number) => number,
  ageDays: number,
  remainingDays: number
): number {
  if (remainingDays <= 0) return 0
  const age = Math.max(0, ageDays)
  return Math.max(0, cdf(age + remainingDays) - cdf(age))
}

function buildMetricOutput(actual: number, projectedTotal: number, goal: number | null): ForecastMetricOutput {
  const total = Math.max(actual, projectedTotal)
  return {
    actual,
    projectedTotal: total,
    goal,
    gapToGoal: goal != null ? goal - total : null,
  }
}

/** Per-week actuals inside the range, for the trend chart. One pass per stage. */
function buildWeeklyTrend(
  sets: HistorySet[],
  sits: HistorySit[],
  sales: HistorySale[],
  rangeStart: Date,
  rangeEnd: Date
): WeeklyTrendPoint[] {
  const startMs = rangeStart.getTime()
  const endMs = rangeEnd.getTime()
  const weekCount = Math.max(1, Math.ceil((endMs - startMs) / (7 * MS_DAY)))

  const points: WeeklyTrendPoint[] = Array.from({ length: weekCount }, (_, i) => ({
    weekStart: toEasternDateIso(new Date(startMs + i * 7 * MS_DAY)),
    sets: 0,
    sits: 0,
    sales: 0,
  }))

  const tally = (iso: string, key: 'sets' | 'sits' | 'sales') => {
    const t = ms(iso)
    if (!Number.isFinite(t) || t < startMs || t >= endMs) return
    points[Math.min(weekCount - 1, Math.floor((t - startMs) / (7 * MS_DAY)))][key] += 1
  }

  for (const set of sets) tally(set.at, 'sets')
  for (const sit of sits) tally(sit.at, 'sits')
  for (const sale of sales) tally(sale.signedAt, 'sales')

  return points
}

const EMPTY_GOAL_COVERAGE: GoalCoverage = {
  months: [],
  monthsMissingGoal: [],
  prorated: false,
}

export function computeForecast(params: {
  rangeStart: Date
  rangeEnd: Date
  asOf: Date
  history: ForecastHistory
  /** Future appointments already on the calendar between `asOf` and `rangeEnd`. */
  knownFutureSets: string[]
  goals: ForecastGoals
  goalCoverage?: GoalCoverage
}): ForecastResult {
  const { rangeStart, rangeEnd, asOf, history, knownFutureSets, goals } = params
  const asOfClamped = asOf.getTime() < rangeEnd.getTime() ? asOf : rangeEnd
  const remainingDays = Math.max(0, (rangeEnd.getTime() - asOfClamped.getTime()) / MS_DAY)

  const salesByOpp = new Map<string, number[]>()
  for (const sale of history.sales) {
    if (!sale.opportunityId) continue
    const t = ms(sale.signedAt)
    if (!Number.isFinite(t)) continue
    const existing = salesByOpp.get(sale.opportunityId)
    if (existing) existing.push(t)
    else salesByOpp.set(sale.opportunityId, [t])
  }

  // --- rates ---
  const sitToSaleLags = sitToSaleLagSamples(history.sits, salesByOpp)
  const sitToSaleMaturityDays =
    sitToSaleLags.length >= MIN_RATE_SAMPLE
      ? Math.min(60, Math.max(7, Math.round(percentile(sitToSaleLags, 0.75))))
      : DEFAULT_SIT_TO_SALE_LAG_DAYS
  const sitToSaleLagDays =
    sitToSaleLags.length > 0 ? Math.round(median(sitToSaleLags)) : DEFAULT_SIT_TO_SALE_LAG_DAYS

  const doorToSet = computeDoorToSetRate(history.doors, history.sets, asOfClamped)
  const setToSit = computeSetToSitRate(history.sets, history.sits, asOfClamped)
  const sitToSale = computeSitToSaleRate(history.sits, salesByOpp, sitToSaleMaturityDays, asOfClamped)
  const saleValue = medianSaleValue(history.sales, asOfClamped)
  const setToSaleLag = medianSetToSaleLag(history.sets, salesByOpp, asOfClamped)

  // --- actuals inside the range ---
  const doorsActual = history.doors.filter((iso) => inRange(iso, rangeStart, rangeEnd, asOfClamped)).length
  const setsInRange = history.sets.filter((s) => inRange(s.at, rangeStart, rangeEnd, asOfClamped))
  const sitsActual = history.sits.filter((s) => inRange(s.at, rangeStart, rangeEnd, asOfClamped)).length
  const salesInRange = history.sales.filter((s) => inRange(s.signedAt, rangeStart, rangeEnd, asOfClamped))
  const revenueActual = salesInRange.reduce((sum, s) => sum + s.projectCost, 0)
  const revenueCollectedActual = history.payments
    .filter((p) => inRange(p.paidAt, rangeStart, rangeEnd, asOfClamped))
    .reduce((sum, p) => sum + p.amount, 0)

  // --- doors + sets ---
  const doorsProjected = weekdayRunRate(history.doors, asOfClamped, rangeEnd)
  const setsRunRate = weekdayRunRate(
    history.sets.map((s) => s.at),
    asOfClamped,
    rangeEnd
  )

  // Known future bookings and the run-rate projection describe the SAME remaining
  // days: appointments booked so far are a floor on that total, not an addition to it.
  const knownBooked = knownFutureSets.length
  const setsIncremental = Math.max(0, setsRunRate - knownBooked)
  const futureSets = knownBooked + setsIncremental
  const setsTotal = setsInRange.length + futureSets

  // --- sits ---
  // Sets already inside the range whose record has no qualifying outcome yet.
  const sitKeySet = new Set<string>()
  for (const sit of history.sits) for (const key of sitKeys(sit)) sitKeySet.add(key)
  const setsAwaitingSitRows = setsInRange.filter((s) => {
    const key = setKey(s)
    return !key || !sitKeySet.has(key)
  })
  const setsAwaitingSit = setsAwaitingSitRows.length

  const sitsFromPending = (setsAwaitingSit + futureSets) * setToSit.rate
  const sitsTotal = sitsActual + sitsFromPending

  // --- sales ---
  // Three disjoint cohorts of live pipeline, each weighted by its chance of signing
  // before the range ends.
  const sitToSaleCdf = buildLagCdf(sitToSaleLags, sitToSaleLagDays)
  const setToSaleCdf = buildLagCdf(setToSaleLag.samples, setToSaleLag.lagDays)

  // Cohort 1 — sits already recorded with no sale on the opportunity. Each is
  // weighted by the slice of the lag curve that still lies inside the range, so an
  // old sit that never closed contributes ~nothing.
  const openSitCutoff = daysAgo(asOfClamped, MAX_OPEN_SIT_AGE_DAYS).getTime()
  let salesFromOpenSits = 0
  for (const sit of history.sits) {
    const t = ms(sit.at)
    if (!Number.isFinite(t) || t >= asOfClamped.getTime() || t < openSitCutoff) continue
    // Any sale on the opportunity closes it out — see computeSitToSaleRate on why
    // sale-after-sit ordering can't be relied on.
    if ((salesByOpp.get(sit.opportunityId)?.length ?? 0) > 0) continue
    const ageDays = (asOfClamped.getTime() - t) / MS_DAY
    salesFromOpenSits += sitToSale.rate * conversionShareInWindow(sitToSaleCdf, ageDays, remainingDays)
  }

  // Cohort 2 — appointments inside the range that have already happened but have no
  // outcome recorded yet.
  let salesFromAwaitingSit = 0
  for (const set of setsAwaitingSitRows) {
    const ageDays = Math.max(0, (asOfClamped.getTime() - ms(set.at)) / MS_DAY)
    salesFromAwaitingSit +=
      setToSit.rate * sitToSale.rate * conversionShareInWindow(setToSaleCdf, ageDays, remainingDays)
  }

  // Cohort 3 — appointments still to come. They land spread across the remaining
  // window, so on average only half of it is left for them to convert in.
  const salesFromFutureSets =
    futureSets * setToSit.rate * sitToSale.rate * conversionShareInWindow(setToSaleCdf, 0, remainingDays / 2)

  const salesRemaining = salesFromOpenSits + salesFromAwaitingSit + salesFromFutureSets
  const salesTotal = salesInRange.length + salesRemaining
  const revenueTotal = revenueActual + salesRemaining * saleValue.value

  const assumptions: RateAssumption[] = [
    {
      key: 'doorToSet',
      label: 'Door → set rate',
      kind: 'rate',
      value: doorToSet.rate,
      window: doorToSet.window,
      sampleSize: doorToSet.n,
      note: 'Sets booked per door knocked, org-wide',
    },
    {
      key: 'setToSit',
      label: 'Set → sit rate',
      kind: 'rate',
      value: setToSit.rate,
      window: setToSit.window,
      sampleSize: setToSit.n,
      note: `Excludes sets from the last ${SET_TO_SIT_MATURITY_DAYS} days — outcome not in yet`,
    },
    {
      key: 'sitToSale',
      label: 'Sit → sale rate',
      kind: 'rate',
      value: sitToSale.rate,
      window: sitToSale.window,
      sampleSize: sitToSale.n,
      note: `Excludes sits from the last ${sitToSaleMaturityDays} days — still deciding`,
    },
    {
      key: 'setToSaleLag',
      label: 'Set → sale lag',
      kind: 'days',
      value: setToSaleLag.lagDays,
      window: setToSaleLag.window,
      sampleSize: setToSaleLag.n,
      note: 'Median days from first appointment to signed contract',
    },
  ]

  return {
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    asOf: asOfClamped.toISOString(),
    metrics: {
      doors: buildMetricOutput(doorsActual, doorsActual + doorsProjected, goals.doors ?? null),
      sets: buildMetricOutput(setsInRange.length, setsTotal, goals.sets ?? null),
      sits: buildMetricOutput(sitsActual, sitsTotal, goals.sits ?? null),
      sales: buildMetricOutput(salesInRange.length, salesTotal, goals.sales ?? null),
      revenueSigned: buildMetricOutput(revenueActual, revenueTotal, goals.revenueSigned ?? null),
      // Cash collection is driven by draw schedules and insurance timing, not the
      // sales funnel, so it carries no projection — and the revenue target is a
      // signed-revenue target, so it must not be reused here as a goal.
      revenueCollected: buildMetricOutput(revenueCollectedActual, revenueCollectedActual, null),
    },
    weeklyTrend: buildWeeklyTrend(history.sets, history.sits, history.sales, rangeStart, rangeEnd),
    assumptions,
    goalCoverage: params.goalCoverage ?? EMPTY_GOAL_COVERAGE,
  }
}

/** Goals for one range, in the shape `fetchGoalsForRange` returns. */
export type RangeGoals = { goals: ForecastGoals; coverage: GoalCoverage }

export function computeQuarterCompare(params: {
  rangeA: { start: Date; end: Date }
  rangeB: { start: Date; end: Date }
  asOf: Date
  history: ForecastHistory
  knownFutureSets: string[]
  primary: RangeGoals
  compare: RangeGoals
}): {
  primary: ForecastResult
  compare: ForecastResult
  deltas: Record<ForecastMetricKey, number | null>
} {
  const { rangeA, rangeB, asOf, history, knownFutureSets } = params
  const primary = computeForecast({
    rangeStart: rangeA.start,
    rangeEnd: rangeA.end,
    asOf,
    history,
    knownFutureSets,
    goals: params.primary.goals,
    goalCoverage: params.primary.coverage,
  })
  const compare = computeForecast({
    rangeStart: rangeB.start,
    rangeEnd: rangeB.end,
    asOf,
    history,
    // The compare range is historical — nothing is still "on the calendar" for it.
    knownFutureSets: [],
    goals: params.compare.goals,
    goalCoverage: params.compare.coverage,
  })

  const deltas = {} as Record<ForecastMetricKey, number | null>
  for (const key of Object.keys(primary.metrics) as ForecastMetricKey[]) {
    deltas[key] = primary.metrics[key].projectedTotal - compare.metrics[key].projectedTotal
  }

  return { primary, compare, deltas }
}
