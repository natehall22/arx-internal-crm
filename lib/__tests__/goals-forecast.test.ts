import {
  computeForecast,
  type ForecastHistory,
  type HistorySale,
  type HistorySet,
  type HistorySit,
} from '@/lib/goals-forecast'
import { getEasternDateRange, easternWeekdayIndex } from '@/lib/goals-period'

const MS_DAY = 86_400_000

function emptyHistory(): ForecastHistory {
  return { doors: [], sets: [], sits: [], sales: [], payments: [] }
}

/**
 * One opportunity walking the funnel: set → (optionally) sit → (optionally) sale.
 * Every stage shares an opportunity id, which is what the conversion rates join on.
 */
function pipeline(
  oppId: string,
  setAt: Date,
  opts: { sitAfterDays?: number | null; saleAfterSitDays?: number | null; projectCost?: number } = {}
): { set: HistorySet; sit?: HistorySit; sale?: HistorySale } {
  const set: HistorySet = { at: setAt.toISOString(), opportunityId: oppId, leadId: `lead-${oppId}` }
  if (opts.sitAfterDays == null) return { set }
  const sitAt = new Date(setAt.getTime() + opts.sitAfterDays * MS_DAY)
  const sit: HistorySit = { at: sitAt.toISOString(), opportunityId: oppId, leadId: `lead-${oppId}` }
  if (opts.saleAfterSitDays == null) return { set, sit }
  return {
    set,
    sit,
    sale: {
      signedAt: new Date(sitAt.getTime() + opts.saleAfterSitDays * MS_DAY).toISOString(),
      projectCost: opts.projectCost ?? 16000,
      opportunityId: oppId,
    },
  }
}

function collect(rows: ReturnType<typeof pipeline>[]): ForecastHistory {
  return {
    doors: [],
    sets: rows.map((r) => r.set),
    sits: rows.flatMap((r) => (r.sit ? [r.sit] : [])),
    sales: rows.flatMap((r) => (r.sale ? [r.sale] : [])),
    payments: [],
  }
}

describe('goals-forecast weekday run-rate', () => {
  it('weights weekdays separately when projecting remaining days', () => {
    const asOf = new Date('2026-02-10T17:00:00.000Z')
    const range = getEasternDateRange('2026-02-01', '2026-02-28')

    const doors: string[] = []
    for (let w = 0; w < 8; w++) {
      for (let d = 0; d < 7; d++) {
        const day = new Date(asOf.getTime() - (w * 7 + (6 - d)) * MS_DAY)
        const wd = easternWeekdayIndex(day.toISOString())
        const count = wd === 0 ? 0 : wd === 6 ? 2 : 10
        for (let i = 0; i < count; i++) doors.push(day.toISOString())
      }
    }

    const result = computeForecast({
      rangeStart: new Date(range.startIso),
      rangeEnd: new Date(range.endIso),
      asOf,
      history: { ...emptyHistory(), doors },
      knownFutureSets: [],
      goals: {},
    })

    expect(result.metrics.doors.projectedTotal).toBeGreaterThan(result.metrics.doors.actual)
  })
})

describe('goals-forecast conversion rates', () => {
  it('matches a set to a sit on the same opportunity, not merely the same day', () => {
    const asOf = new Date('2026-06-01T17:00:00.000Z')
    const range = getEasternDateRange('2026-06-01', '2026-06-30')

    // 20 sets on 20 distinct days; only the first 5 ever sat. A same-day matcher
    // would also credit the 15 that didn't, because a *different* opportunity sat
    // on each of those days.
    const rows = Array.from({ length: 20 }).map((_, i) =>
      pipeline(`opp-${i}`, new Date(Date.UTC(2026, 3, 1 + i, 15)), {
        sitAfterDays: i < 5 ? 0 : null,
      })
    )
    // Decoy sits from unrelated opportunities, one on each non-converting set's day.
    const decoySits: HistorySit[] = Array.from({ length: 15 }).map((_, i) => ({
      at: new Date(Date.UTC(2026, 3, 6 + i, 18)).toISOString(),
      opportunityId: `decoy-${i}`,
      leadId: `decoy-lead-${i}`,
    }))

    const history = collect(rows)
    history.sits = [...history.sits, ...decoySits]

    const result = computeForecast({
      rangeStart: new Date(range.startIso),
      rangeEnd: new Date(range.endIso),
      asOf,
      history,
      knownFutureSets: [],
      goals: {},
    })

    const setToSit = result.assumptions.find((a) => a.key === 'setToSit')
    expect(setToSit?.value).toBeCloseTo(5 / 20, 5)
  })

  it('matches a sit to a sale on the same opportunity, not any later sale org-wide', () => {
    const asOf = new Date('2026-06-01T17:00:00.000Z')
    const range = getEasternDateRange('2026-06-01', '2026-06-30')

    // 20 sits, 6 of which close. The old date-only matcher counted a sit as
    // converted if ANY sale was signed on or after it, which drove the rate to ~100%.
    const rows = Array.from({ length: 20 }).map((_, i) =>
      pipeline(`opp-${i}`, new Date(Date.UTC(2026, 1, 1 + i, 15)), {
        sitAfterDays: 0,
        saleAfterSitDays: i < 6 ? 5 : null,
      })
    )

    const result = computeForecast({
      rangeStart: new Date(range.startIso),
      rangeEnd: new Date(range.endIso),
      asOf,
      history: collect(rows),
      knownFutureSets: [],
      goals: {},
    })

    const sitToSale = result.assumptions.find((a) => a.key === 'sitToSale')
    expect(sitToSale?.value).toBeCloseTo(6 / 20, 5)
    expect(sitToSale?.value).toBeLessThan(0.5)
  })

  it('excludes sets too recent to have an outcome yet from the set→sit denominator', () => {
    const asOf = new Date('2026-06-01T17:00:00.000Z')
    const range = getEasternDateRange('2026-06-01', '2026-06-30')

    const matured = Array.from({ length: 20 }).map((_, i) =>
      pipeline(`opp-${i}`, new Date(Date.UTC(2026, 3, 1 + i, 15)), { sitAfterDays: 0 })
    )
    // Booked for the last three days, outcome not entered yet — must not be graded.
    const fresh = Array.from({ length: 10 }).map((_, i) =>
      pipeline(`fresh-${i}`, new Date(asOf.getTime() - (i % 3) * MS_DAY - 3_600_000))
    )

    const result = computeForecast({
      rangeStart: new Date(range.startIso),
      rangeEnd: new Date(range.endIso),
      asOf,
      history: collect([...matured, ...fresh]),
      knownFutureSets: [],
      goals: {},
    })

    const setToSit = result.assumptions.find((a) => a.key === 'setToSit')
    expect(setToSit?.sampleSize).toBe(20)
    expect(setToSit?.value).toBeCloseTo(1, 5)
  })
})

describe('goals-forecast set projection', () => {
  it('treats calendar bookings as a floor on the run rate, not an addition to it', () => {
    const asOf = new Date('2026-06-15T17:00:00.000Z')
    const range = getEasternDateRange('2026-06-01', '2026-06-30')

    // Steady 2 sets/weekday for 8 weeks of history.
    const rows: ReturnType<typeof pipeline>[] = []
    for (let d = 1; d <= 70; d++) {
      const day = new Date(asOf.getTime() - d * MS_DAY)
      const wd = easternWeekdayIndex(day.toISOString())
      if (wd === 0 || wd === 6) continue
      for (let i = 0; i < 2; i++) {
        rows.push(pipeline(`opp-${d}-${i}`, new Date(day.getTime() + i * 3_600_000)))
      }
    }

    const base = computeForecast({
      rangeStart: new Date(range.startIso),
      rangeEnd: new Date(range.endIso),
      asOf,
      history: collect(rows),
      knownFutureSets: [],
      goals: {},
    })

    // Three appointments already on the books for the rest of the range. They are
    // part of the same remaining days the run rate already estimates, so the total
    // must not move by three.
    const withBookings = computeForecast({
      rangeStart: new Date(range.startIso),
      rangeEnd: new Date(range.endIso),
      asOf,
      history: collect(rows),
      knownFutureSets: [
        '2026-06-17T15:00:00.000Z',
        '2026-06-18T15:00:00.000Z',
        '2026-06-19T15:00:00.000Z',
      ],
      goals: {},
    })

    expect(withBookings.metrics.sets.projectedTotal).toBeCloseTo(base.metrics.sets.projectedTotal, 5)
  })

  it('raises the projection when bookings already exceed the run rate', () => {
    const asOf = new Date('2026-06-28T17:00:00.000Z')
    const range = getEasternDateRange('2026-06-01', '2026-06-30')

    const knownFutureSets = Array.from({ length: 25 }).map(() => '2026-06-29T15:00:00.000Z')

    const result = computeForecast({
      rangeStart: new Date(range.startIso),
      rangeEnd: new Date(range.endIso),
      asOf,
      history: emptyHistory(),
      knownFutureSets,
      goals: {},
    })

    expect(result.metrics.sets.projectedTotal).toBeGreaterThanOrEqual(25)
  })
})

describe('goals-forecast sales projection', () => {
  it('projects sales from open pipeline instead of zeroing out on a short range', () => {
    // Every set sits and 40% close, so a range with live pipeline must project
    // some sales. The previous lag model clamped this to zero whenever the range
    // was shorter than the set→sale lag.
    const asOf = new Date('2026-06-25T17:00:00.000Z')
    const range = getEasternDateRange('2026-06-20', '2026-06-30')

    const closed = Array.from({ length: 20 }).map((_, i) =>
      pipeline(`won-${i}`, new Date(Date.UTC(2026, 3, 1 + i, 15)), {
        sitAfterDays: 0,
        saleAfterSitDays: i < 8 ? 4 : null,
      })
    )
    // Recent sits with no sale yet — live pipeline as of `asOf`.
    const open = Array.from({ length: 10 }).map((_, i) =>
      pipeline(`open-${i}`, new Date(asOf.getTime() - (i + 2) * MS_DAY), { sitAfterDays: 0 })
    )

    const result = computeForecast({
      rangeStart: new Date(range.startIso),
      rangeEnd: new Date(range.endIso),
      asOf,
      history: collect([...closed, ...open]),
      knownFutureSets: [],
      goals: {},
    })

    expect(result.metrics.sales.projectedTotal).toBeGreaterThan(0)
    expect(result.metrics.revenueSigned.projectedTotal).toBeGreaterThan(0)
  })

  it('never projects a total below what already happened', () => {
    const asOf = new Date('2026-06-30T17:00:00.000Z')
    const range = getEasternDateRange('2026-06-01', '2026-06-30')

    const rows = Array.from({ length: 4 }).map((_, i) =>
      pipeline(`opp-${i}`, new Date(Date.UTC(2026, 5, 2 + i, 15)), {
        sitAfterDays: 0,
        saleAfterSitDays: 1,
        projectCost: 20000,
      })
    )

    const result = computeForecast({
      rangeStart: new Date(range.startIso),
      rangeEnd: new Date(range.endIso),
      asOf,
      history: collect(rows),
      knownFutureSets: [],
      goals: {},
    })

    for (const metric of Object.values(result.metrics)) {
      expect(metric.projectedTotal).toBeGreaterThanOrEqual(metric.actual)
    }
    expect(result.metrics.revenueSigned.actual).toBe(80000)
  })
})

describe('goals-forecast goal wiring', () => {
  it('reports the gap against the supplied range goal and leaves collected revenue ungoaled', () => {
    const asOf = new Date('2026-06-10T17:00:00.000Z')
    const range = getEasternDateRange('2026-06-01', '2026-06-30')

    const result = computeForecast({
      rangeStart: new Date(range.startIso),
      rangeEnd: new Date(range.endIso),
      asOf,
      history: emptyHistory(),
      knownFutureSets: [],
      goals: { sets: 220, revenueSigned: 238000 },
    })

    expect(result.metrics.sets.goal).toBe(220)
    expect(result.metrics.sets.gapToGoal).toBe(220 - result.metrics.sets.projectedTotal)
    // The revenue target is a SIGNED target; reusing it for collected cash showed
    // the same $238k goal twice against unrelated numbers.
    expect(result.metrics.revenueCollected.goal).toBeNull()
    expect(result.metrics.revenueCollected.gapToGoal).toBeNull()
  })
})

describe('goals-forecast backtest shape', () => {
  it('projects a single future week within ±15% of synthetic door actuals from 8 weeks of history', () => {
    const weekStarts: Date[] = []
    const start = new Date('2026-01-05T12:00:00.000Z')
    for (let w = 0; w < 10; w++) weekStarts.push(new Date(start.getTime() + w * 7 * MS_DAY))

    const doors: string[] = []
    for (let w = 0; w < 10; w++) {
      for (let d = 1; d <= 5; d++) {
        const day = new Date(weekStarts[w].getTime() + d * MS_DAY)
        for (let i = 0; i < 2; i++) doors.push(new Date(day.getTime() + i * 3_600_000).toISOString())
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
      history: { ...emptyHistory(), doors: doors.filter((d) => new Date(d) < asOf) },
      knownFutureSets: [],
      goals: {},
    })

    const errorPct =
      Math.abs(result.metrics.doors.projectedTotal - actualWeek9Doors) / Math.max(actualWeek9Doors, 1)
    expect(errorPct).toBeLessThanOrEqual(0.15)
  })
})
