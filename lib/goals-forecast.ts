import {
  countRemainingWeeks,
  easternWeekdayIndex,
  listEasternDatesInRange,
  toEasternDateIso,
} from '@/lib/goals-period'

export type ForecastMetricKey =
  | 'doors'
  | 'sets'
  | 'sits'
  | 'sales'
  | 'revenueSigned'
  | 'revenueCollected'

export type RateWindow = '90d' | '180d' | 'all'

export type RateAssumption = {
  label: string
  rate: number | null
  window: RateWindow | null
  sampleSize: number
  note?: string
}

export type ForecastMetricOutput = {
  actual: number
  knownBooked: number
  projected: number
  projectedLow: number
  projectedHigh: number
  goal: number | null
  gapToGoal: number | null
  neededPerWeek: number | null
}

export type WeeklyTrendPoint = {
  weekStart: string
  sets: number
  sits: number
  sales: number
}

export type ForecastResult = {
  rangeStart: string
  rangeEnd: string
  asOf: string
  metrics: Record<ForecastMetricKey, ForecastMetricOutput>
  weeklyTrend: WeeklyTrendPoint[]
  assumptions: RateAssumption[]
}

export type ForecastHistory = {
  doors: string[]
  sets: string[]
  sits: string[]
  sales: { signedAt: string; projectCost: number }[]
  payments: { paidAt: string; amount: number }[]
  setToSalePairs: { setAt: string; signedAt: string }[]
}

export type ForecastGoals = Partial<Record<ForecastMetricKey, number | null>>

const MS_DAY = 86_400_000

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

type ConversionRateResult = { rate: number; window: RateWindow; n: number }

function pickConversionRate(
  numerators: { at: string; converted: boolean }[],
  asOf: Date,
  minN = 10
): ConversionRateResult {
  const windows: { window: RateWindow; days: number }[] = [
    { window: '90d', days: 90 },
    { window: '180d', days: 180 },
    { window: 'all', days: 3650 },
  ]

  for (const { window, days } of windows) {
    const start = daysAgo(asOf, days)
    const sample = numerators.filter((row) => {
      const t = new Date(row.at).getTime()
      return t >= start.getTime() && t < asOf.getTime()
    })
    const conversions = sample.filter((row) => row.converted).length
    if (sample.length >= minN) {
      return { rate: conversions / sample.length, window, n: sample.length }
    }
  }

  const allBefore = numerators.filter((row) => new Date(row.at).getTime() < asOf.getTime())
  const conversions = allBefore.filter((row) => row.converted).length
  return {
    rate: allBefore.length > 0 ? conversions / allBefore.length : 0,
    window: allBefore.length >= minN ? 'all' : '90d',
    n: allBefore.length,
  }
}

function weekdayRunRate(
  events: string[],
  asOf: Date,
  rangeEnd: Date,
  historyWeeks = 8
): { projected: number; low: number; high: number } {
  const historyStart = daysAgo(asOf, historyWeeks * 7)
  const historyEvents = events.filter((iso) => inRange(iso, historyStart, asOf))

  const weekdayTotals = Array.from({ length: 7 }, () => 0)
  const weekdayCounts = Array.from({ length: 7 }, () => 0)

  if (historyEvents.length > 0) {
    for (let w = 0; w < historyWeeks; w++) {
      const weekStart = daysAgo(asOf, (w + 1) * 7)
      const weekEnd = daysAgo(asOf, w * 7)
      const weekByDay = Array.from({ length: 7 }, () => 0)
      for (const iso of historyEvents) {
        const t = new Date(iso).getTime()
        if (t >= weekStart.getTime() && t < weekEnd.getTime()) {
          weekByDay[easternWeekdayIndex(iso)] += 1
        }
      }
      for (let d = 0; d < 7; d++) {
        weekdayTotals[d] += weekByDay[d]
        weekdayCounts[d] += 1
      }
    }
  }

  const weekdayAvg = weekdayTotals.map((total, d) =>
    weekdayCounts[d] > 0 ? total / weekdayCounts[d] : 0
  )

  const flatDaily =
    historyEvents.length > 0
      ? historyEvents.length / Math.max(1, (asOf.getTime() - historyStart.getTime()) / MS_DAY)
      : 0

  const weeklyTotals: number[] = []
  let weeksWithData = 0
  for (let w = 0; w < historyWeeks; w++) {
    const weekStart = daysAgo(asOf, (w + 1) * 7)
    const weekEnd = daysAgo(asOf, w * 7)
    const weekCount = historyEvents.filter((iso) => {
      const t = new Date(iso).getTime()
      return t >= weekStart.getTime() && t < weekEnd.getTime()
    }).length
    weeklyTotals.push(weekCount)
    if (weekCount > 0) weeksWithData += 1
  }

  const hasEightWeeks = weeksWithData >= historyWeeks

  const remainingDates = listEasternDatesInRange(asOf.toISOString(), rangeEnd.toISOString())
  let projected = 0
  for (const date of remainingDates) {
    const wd = easternWeekdayIndex(`${date}T12:00:00.000Z`)
    let avg = 0
    if (hasEightWeeks) {
      avg = weekdayCounts[wd] > 0 ? weekdayTotals[wd] / weekdayCounts[wd] : 0
    } else {
      avg = weekdayAvg[wd] > 0 ? weekdayAvg[wd] : flatDaily
    }
    projected += avg
  }

  const p25 = percentile(weeklyTotals, 0.25)
  const p75 = percentile(weeklyTotals, 0.75)
  const avgWeekly =
    weeklyTotals.length > 0
      ? weeklyTotals.reduce((a, b) => a + b, 0) / weeklyTotals.length
      : flatDaily * 7

  const lowRaw = p25 > 0 ? (p25 / Math.max(avgWeekly, 1)) * projected : projected * 0.85
  const highRaw = p75 > 0 ? (p75 / Math.max(avgWeekly, 1)) * projected : projected * 1.15

  return {
    projected,
    low: Math.min(projected, lowRaw),
    high: Math.max(projected, highRaw),
  }
}

function computeSetToSitRate(sets: string[], sits: string[], asOf: Date): ConversionRateResult {
  const sitSet = new Set(sits.map((iso) => toEasternDateIso(iso)))
  const rows = sets.map((setAt) => ({
    at: setAt,
    converted: sitSet.has(toEasternDateIso(setAt)),
  }))
  return pickConversionRate(rows, asOf)
}

function computeSitToSaleRate(
  sits: string[],
  sales: { signedAt: string }[],
  asOf: Date
): ConversionRateResult {
  const saleDates = sales.map((s) => toEasternDateIso(s.signedAt))
  const rows = sits.map((sitAt) => {
    const sitDay = toEasternDateIso(sitAt)
    const converted = saleDates.some((d) => d >= sitDay)
    return { at: sitAt, converted }
  })
  return pickConversionRate(rows, asOf)
}

function computeMedianSaleValue(
  sales: { signedAt: string; projectCost: number }[],
  asOf: Date
): { value: number; n: number; window: RateWindow } {
  const windows: { window: RateWindow; days: number }[] = [
    { window: '90d', days: 90 },
    { window: '180d', days: 180 },
    { window: 'all', days: 3650 },
  ]
  for (const { window, days } of windows) {
    const start = daysAgo(asOf, days)
    const sample = sales.filter((s) => inRange(s.signedAt, start, asOf))
    if (sample.length >= 10) {
      return { value: median(sample.map((s) => s.projectCost)), n: sample.length, window }
    }
  }
  const all = sales.filter((s) => new Date(s.signedAt).getTime() < asOf.getTime())
  return { value: median(all.map((s) => s.projectCost)), n: all.length, window: 'all' }
}

function computeMedianSetToSaleLagDays(
  pairs: { setAt: string; signedAt: string }[],
  asOf: Date
): { lagDays: number; n: number } {
  const lags: number[] = []
  for (const pair of pairs) {
    if (new Date(pair.signedAt).getTime() >= asOf.getTime()) continue
    const lag = Math.round(
      (new Date(pair.signedAt).getTime() - new Date(pair.setAt).getTime()) / MS_DAY
    )
    if (lag >= 0 && lag <= 120) lags.push(lag)
  }
  return { lagDays: Math.round(median(lags)) || 14, n: lags.length }
}

function futureSetShowRate(
  sets: string[],
  sits: string[],
  asOf: Date
): { rate: number; n: number } {
  const futureSets = sets.filter((iso) => new Date(iso).getTime() >= asOf.getTime())
  if (futureSets.length === 0) return { rate: 1, n: 0 }
  const sitDays = new Set(sits.map((iso) => toEasternDateIso(iso)))
  const converted = futureSets.filter((iso) => sitDays.has(toEasternDateIso(iso))).length
  if (converted >= 10) return { rate: converted / futureSets.length, n: futureSets.length }
  return { rate: 1, n: futureSets.length }
}

function buildMetricOutput(
  actual: number,
  knownBooked: number,
  projected: number,
  projectedLow: number,
  projectedHigh: number,
  goal: number | null,
  remainingWeeks: number
): ForecastMetricOutput {
  const total = actual + knownBooked + projected
  const gap = goal != null ? goal - total : null
  const neededPerWeek =
    gap != null && remainingWeeks > 0 && gap > 0
      ? gap / remainingWeeks
      : gap != null && gap <= 0
        ? 0
        : null

  return {
    actual,
    knownBooked,
    projected,
    projectedLow,
    projectedHigh,
    goal,
    gapToGoal: gap,
    neededPerWeek,
  }
}

function buildWeeklyTrend(
  sets: string[],
  sits: string[],
  sales: { signedAt: string }[],
  rangeStart: Date,
  rangeEnd: Date
): WeeklyTrendPoint[] {
  const points: WeeklyTrendPoint[] = []
  let cursor = rangeStart
  while (cursor < rangeEnd) {
    const weekEnd = new Date(Math.min(cursor.getTime() + 7 * MS_DAY, rangeEnd.getTime()))
    points.push({
      weekStart: toEasternDateIso(cursor),
      sets: sets.filter((iso) => inRange(iso, cursor, weekEnd)).length,
      sits: sits.filter((iso) => inRange(iso, cursor, weekEnd)).length,
      sales: sales.filter((s) => inRange(s.signedAt, cursor, weekEnd)).length,
    })
    cursor = weekEnd
  }
  return points
}

export function computeForecast(params: {
  rangeStart: Date
  rangeEnd: Date
  asOf: Date
  history: ForecastHistory
  knownFutureSets: string[]
  goals: ForecastGoals
}): ForecastResult {
  const { rangeStart, rangeEnd, asOf, history, knownFutureSets, goals } = params
  const asOfClamped = asOf.getTime() < rangeEnd.getTime() ? asOf : rangeEnd
  const remainingWeeks = countRemainingWeeks(asOfClamped.toISOString(), rangeEnd.toISOString())

  const doorsActual = history.doors.filter((iso) => inRange(iso, rangeStart, rangeEnd, asOfClamped)).length
  const setsActual = history.sets.filter((iso) => inRange(iso, rangeStart, rangeEnd, asOfClamped)).length
  const sitsActual = history.sits.filter((iso) => inRange(iso, rangeStart, rangeEnd, asOfClamped)).length
  const salesInRange = history.sales.filter((s) => inRange(s.signedAt, rangeStart, rangeEnd, asOfClamped))
  const salesActual = salesInRange.length
  const revenueActual = salesInRange.reduce((sum, s) => sum + s.projectCost, 0)
  const revenueCollectedActual = history.payments
    .filter((p) => inRange(p.paidAt, rangeStart, rangeEnd, asOfClamped))
    .reduce((sum, p) => sum + p.amount, 0)

  const doorsRun = weekdayRunRate(history.doors, asOfClamped, rangeEnd)
  const setsRun = weekdayRunRate(history.sets, asOfClamped, rangeEnd)

  const futureShow = futureSetShowRate(history.sets, history.sits, asOfClamped)
  const knownBookedSets = knownFutureSets.length * futureShow.rate

  const setToSit = computeSetToSitRate(history.sets, history.sits, asOfClamped)
  const sitToSale = computeSitToSaleRate(history.sits, history.sales, asOfClamped)
  const medianSale = computeMedianSaleValue(history.sales, asOfClamped)
  const lag = computeMedianSetToSaleLagDays(history.setToSalePairs, asOfClamped)

  const projectedTotalSets = setsActual + knownBookedSets + setsRun.projected
  const projectedSits = projectedTotalSets * setToSit.rate
  const projectedSalesBeforeLag = projectedSits * sitToSale.rate

  const rangeEndMs = rangeEnd.getTime()
  const lagCutoff = new Date(rangeEndMs - lag.lagDays * MS_DAY)
  const setsInLagWindow = projectedTotalSets > 0
    ? history.sets.filter((iso) => {
        const t = new Date(iso).getTime()
        return t >= lagCutoff.getTime() && t < rangeEndMs
      }).length +
      knownFutureSets.filter((iso) => {
        const t = new Date(iso).getTime()
        return t >= lagCutoff.getTime() && t < rangeEndMs
      }).length
    : 0
  const lagPenaltyRate = projectedTotalSets > 0 ? Math.min(1, setsInLagWindow / projectedTotalSets) : 0
  const projectedSales = projectedSalesBeforeLag * (1 - lagPenaltyRate)
  const projectedRevenue = projectedSales * medianSale.value

  const assumptions: RateAssumption[] = [
    {
      label: 'Set → sit rate',
      rate: setToSit.rate,
      window: setToSit.window,
      sampleSize: setToSit.n,
    },
    {
      label: 'Sit → sale rate',
      rate: sitToSale.rate,
      window: sitToSale.window,
      sampleSize: sitToSale.n,
    },
    {
      label: 'Median signed contract value',
      rate: medianSale.value,
      window: medianSale.window,
      sampleSize: medianSale.n,
      note: 'Median project_cost of signed contracts',
    },
    {
      label: 'Set → sale lag (days)',
      rate: lag.lagDays,
      window: lag.n >= 10 ? '90d' : 'all',
      sampleSize: lag.n,
      note: 'Sets inside this window at range end may convert after the range',
    },
    {
      label: 'Future booked set show rate',
      rate: futureShow.rate,
      window: futureShow.n >= 10 ? '90d' : null,
      sampleSize: futureShow.n,
      note: futureShow.n < 10 ? 'Insufficient history — counting known bookings at 100%' : undefined,
    },
  ]

  const setsLow = setsRun.low
  const setsHigh = setsRun.high
  const projectedSitsLow = (setsActual + knownBookedSets + setsLow) * setToSit.rate
  const projectedSitsHigh = (setsActual + knownBookedSets + setsHigh) * setToSit.rate

  return {
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    asOf: asOfClamped.toISOString(),
    metrics: {
      doors: buildMetricOutput(
        doorsActual,
        0,
        doorsRun.projected,
        doorsRun.low,
        doorsRun.high,
        goals.doors ?? null,
        remainingWeeks
      ),
      sets: buildMetricOutput(
        setsActual,
        knownBookedSets,
        setsRun.projected,
        setsLow,
        setsHigh,
        goals.sets ?? null,
        remainingWeeks
      ),
      sits: buildMetricOutput(
        sitsActual,
        0,
        projectedSits - sitsActual,
        projectedSitsLow - sitsActual,
        projectedSitsHigh - sitsActual,
        goals.sits ?? null,
        remainingWeeks
      ),
      sales: buildMetricOutput(
        salesActual,
        0,
        projectedSales - salesActual,
        projectedSitsLow * sitToSale.rate * (1 - lagPenaltyRate) - salesActual,
        projectedSitsHigh * sitToSale.rate * (1 - lagPenaltyRate) - salesActual,
        goals.sales ?? null,
        remainingWeeks
      ),
      revenueSigned: buildMetricOutput(
        revenueActual,
        0,
        projectedRevenue - revenueActual,
        projectedSitsLow * sitToSale.rate * (1 - lagPenaltyRate) * medianSale.value - revenueActual,
        projectedSitsHigh * sitToSale.rate * (1 - lagPenaltyRate) * medianSale.value - revenueActual,
        goals.revenueSigned ?? null,
        remainingWeeks
      ),
      revenueCollected: buildMetricOutput(
        revenueCollectedActual,
        0,
        0,
        0,
        0,
        goals.revenueSigned ?? null,
        remainingWeeks
      ),
    },
    weeklyTrend: buildWeeklyTrend(history.sets, history.sits, history.sales, rangeStart, rangeEnd),
    assumptions,
  }
}

export function computeQuarterCompare(
  rangeA: { start: Date; end: Date },
  rangeB: { start: Date; end: Date },
  asOf: Date,
  history: ForecastHistory,
  knownFutureSets: string[],
  goals: ForecastGoals
): {
  primary: ForecastResult
  compare: ForecastResult
  deltas: Record<ForecastMetricKey, number | null>
} {
  const primary = computeForecast({
    rangeStart: rangeA.start,
    rangeEnd: rangeA.end,
    asOf,
    history,
    knownFutureSets,
    goals,
  })
  const compare = computeForecast({
    rangeStart: rangeB.start,
    rangeEnd: rangeB.end,
    asOf,
    history,
    knownFutureSets: [],
    goals,
  })

  const deltas = {} as Record<ForecastMetricKey, number | null>
  for (const key of Object.keys(primary.metrics) as ForecastMetricKey[]) {
    const a =
      primary.metrics[key].actual +
      primary.metrics[key].knownBooked +
      primary.metrics[key].projected
    const b =
      compare.metrics[key].actual +
      compare.metrics[key].knownBooked +
      compare.metrics[key].projected
    deltas[key] = a - b
  }

  return { primary, compare, deltas }
}
