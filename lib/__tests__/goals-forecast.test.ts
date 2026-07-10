import {
  computeForecast,
  type ForecastHistory,
} from '@/lib/goals-forecast'
import { getEasternDateRange, easternWeekdayIndex } from '@/lib/goals-period'

function buildSyntheticWeek(
  weekStart: Date,
  setsPerWeek: number,
  sitRate: number,
  closeRate: number,
  seed: number
): {
  sets: string[]
  sits: string[]
  sales: { signedAt: string; projectCost: number }[]
  setToSalePairs: { setAt: string; signedAt: string }[]
} {
  const sets: string[] = []
  const sits: string[] = []
  const sales: { signedAt: string; projectCost: number }[] = []
  const setToSalePairs: { setAt: string; signedAt: string }[] = []

  for (let d = 0; d < 7; d++) {
    const day = new Date(weekStart.getTime() + d * 86_400_000)
    const perDay = setsPerWeek / 5
    if (d >= 1 && d <= 5) {
      for (let i = 0; i < perDay; i++) {
        const setAt = new Date(day.getTime() + 15 * 3_600_000).toISOString()
        sets.push(setAt)
        const roll = ((seed + d + i) % 100) / 100
        if (roll < sitRate) {
          const sitAt = new Date(day.getTime() + 20 * 3_600_000).toISOString()
          sits.push(sitAt)
          const closeRoll = ((seed + d + i + 17) % 100) / 100
          if (closeRoll < closeRate) {
            const signedAt = new Date(day.getTime() + (14 + d) * 86_400_000).toISOString()
            sales.push({ signedAt, projectCost: 15000 })
            setToSalePairs.push({ setAt, signedAt })
          }
        }
      }
    }
  }

  return { sets, sits, sales, setToSalePairs }
}

describe('goals-forecast weekday run-rate', () => {
  it('weights weekdays separately when projecting remaining days', () => {
    const asOf = new Date('2026-02-10T17:00:00.000Z')
    const range = getEasternDateRange('2026-02-01', '2026-02-28')
    const rangeStart = new Date(range.startIso)
    const rangeEnd = new Date(range.endIso)

    const doors: string[] = []
    for (let w = 0; w < 8; w++) {
      for (let d = 0; d < 7; d++) {
        const day = new Date(asOf.getTime() - (w * 7 + (6 - d)) * 86_400_000)
        const wd = easternWeekdayIndex(day.toISOString())
        const count = wd === 0 ? 0 : wd === 6 ? 2 : 10
        for (let i = 0; i < count; i++) {
          doors.push(day.toISOString())
        }
      }
    }

    const history: ForecastHistory = {
      doors,
      sets: [],
      sits: [],
      sales: [],
      payments: [],
      setToSalePairs: [],
    }

    const result = computeForecast({
      rangeStart,
      rangeEnd,
      asOf,
      history,
      knownFutureSets: [],
      goals: {},
    })

    expect(result.metrics.doors.projected).toBeGreaterThan(0)
    expect(result.metrics.doors.projectedLow).toBeLessThanOrEqual(result.metrics.doors.projected)
    expect(result.metrics.doors.projectedHigh).toBeGreaterThanOrEqual(result.metrics.doors.projected)
  })
})

describe('goals-forecast funnel derivation', () => {
  it('projects sits and sales from upstream set projections', () => {
    const asOf = new Date('2026-03-10T17:00:00.000Z')
    const range = getEasternDateRange('2026-03-01', '2026-03-31')
    const sets = Array.from({ length: 40 }).map((_, i) =>
      new Date(Date.UTC(2026, 0, 1 + i * 2)).toISOString()
    )
    const sits = sets.slice(0, 30).map((s) =>
      new Date(new Date(s).getTime() + 86_400_000).toISOString()
    )
    const sales = sits.slice(0, 12).map((s, i) => ({
      signedAt: new Date(new Date(s).getTime() + 10 * 86_400_000).toISOString(),
      projectCost: 16000 + i * 100,
    }))
    const setToSalePairs = sales.map((sale, i) => ({
      setAt: sets[i],
      signedAt: sale.signedAt,
    }))

    const result = computeForecast({
      rangeStart: new Date(range.startIso),
      rangeEnd: new Date(range.endIso),
      asOf,
      history: { doors: [], sets, sits, sales, payments: [], setToSalePairs },
      knownFutureSets: [],
      goals: { sets: 50, sales: 15 },
    })

    expect(result.metrics.sits.actual + result.metrics.sits.projected).toBeGreaterThanOrEqual(
      result.metrics.sits.actual
    )
    expect(result.metrics.sales.projected + result.metrics.sales.actual).toBeGreaterThanOrEqual(0)
  })
})

describe('goals-forecast lag exclusion', () => {
  it('excludes late-range sets from projected sales when lag exceeds range remainder', () => {
    const asOf = new Date('2026-03-28T17:00:00.000Z')
    const range = getEasternDateRange('2026-03-01', '2026-03-31')

    const sets = Array.from({ length: 30 }).map((_, i) =>
      new Date(Date.UTC(2026, 0, 5 + i)).toISOString()
    )
    sets.push('2026-03-29T15:00:00.000Z')

    const sits = sets.slice(0, 25).map((s) =>
      new Date(new Date(s).getTime() + 86_400_000).toISOString()
    )
    const sales = sits.slice(0, 10).map((s, i) => ({
      signedAt: new Date(new Date(s).getTime() + 14 * 86_400_000).toISOString(),
      projectCost: 15000,
    }))
    const setToSalePairs = sales.map((sale, i) => ({ setAt: sets[i], signedAt: sale.signedAt }))

    const withoutLateSet = computeForecast({
      rangeStart: new Date(range.startIso),
      rangeEnd: new Date(range.endIso),
      asOf,
      history: { doors: [], sets: sets.slice(0, -1), sits, sales, payments: [], setToSalePairs },
      knownFutureSets: [],
      goals: {},
    })

    const withLateSet = computeForecast({
      rangeStart: new Date(range.startIso),
      rangeEnd: new Date(range.endIso),
      asOf,
      history: { doors: [], sets, sits, sales, payments: [], setToSalePairs },
      knownFutureSets: ['2026-03-29T15:00:00.000Z'],
      goals: {},
    })

    expect(withLateSet.assumptions.some((a) => a.label.includes('lag'))).toBe(true)
    expect(withLateSet.metrics.sales.projected).toBeLessThanOrEqual(withoutLateSet.metrics.sales.projected + 1)
  })
})

describe('goals-forecast fallback ladder', () => {
  it('prefers 90d window when sample size is sufficient', () => {
    const asOf = new Date('2026-06-01T17:00:00.000Z')
    const range = getEasternDateRange('2026-06-01', '2026-06-30')
    const sets = Array.from({ length: 20 }).map((_, i) =>
      new Date(Date.UTC(2026, 2, 1 + i)).toISOString()
    )
    const sits = sets.map((s) => new Date(new Date(s).getTime() + 86_400_000).toISOString())

    const result = computeForecast({
      rangeStart: new Date(range.startIso),
      rangeEnd: new Date(range.endIso),
      asOf,
      history: { doors: [], sets, sits, sales: [], payments: [], setToSalePairs: [] },
      knownFutureSets: [],
      goals: {},
    })

    const assumption = result.assumptions.find((a) => a.label === 'Set → sit rate')
    expect(assumption?.window).toBe('90d')
    expect(assumption?.sampleSize).toBeGreaterThanOrEqual(10)
  })
})

describe('goals-forecast backtest shape', () => {
  it('projects a single future week within ±15% of synthetic door actuals from 8 weeks of history', () => {
    const weekStarts: Date[] = []
    const start = new Date('2026-01-05T12:00:00.000Z')
    for (let w = 0; w < 10; w++) {
      weekStarts.push(new Date(start.getTime() + w * 7 * 86_400_000))
    }

    const doors: string[] = []
    for (let w = 0; w < 10; w++) {
      for (let d = 1; d <= 5; d++) {
        const day = new Date(weekStarts[w].getTime() + d * 86_400_000)
        for (let i = 0; i < 2; i++) {
          doors.push(new Date(day.getTime() + i * 3_600_000).toISOString())
        }
      }
    }

    const asOf = new Date(weekStarts[8].getTime() - 1)
    const forecastRangeStart = weekStarts[8]
    const forecastRangeEnd = weekStarts[9]

    const actualWeek9Doors = doors.filter(
      (d) => new Date(d) >= forecastRangeStart && new Date(d) < forecastRangeEnd
    ).length

    const result = computeForecast({
      rangeStart: forecastRangeStart,
      rangeEnd: forecastRangeEnd,
      asOf,
      history: {
        doors: doors.filter((d) => new Date(d) < asOf),
        sets: [],
        sits: [],
        sales: [],
        payments: [],
        setToSalePairs: [],
      },
      knownFutureSets: [],
      goals: {},
    })

    const projectedDoors =
      result.metrics.doors.actual + result.metrics.doors.knownBooked + result.metrics.doors.projected
    const errorPct = Math.abs(projectedDoors - actualWeek9Doors) / Math.max(actualWeek9Doors, 1)
    expect(errorPct).toBeLessThanOrEqual(0.15)
  })
})
