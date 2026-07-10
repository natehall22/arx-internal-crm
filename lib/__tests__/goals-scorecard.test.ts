import { resolveLeadChannel } from '@/lib/goals-channel-attribution'
import { computeForecast, type ForecastHistory } from '@/lib/goals-forecast'
import { getEasternDateRange } from '@/lib/goals-period'
import { assertGoalsAdminAccess } from '@/lib/goals-admin-access'

describe('resolveLeadChannel', () => {
  it('buckets canvass door leads', () => {
    expect(resolveLeadChannel({ source: 'canvass', canvass_disposition: 'hot_lead' })).toBe('canvass')
  })

  it('buckets inbound channel as inside sales', () => {
    expect(resolveLeadChannel({ source: 'web', channel: 'inbound' })).toBe('inside_sales')
  })

  it('buckets call_center source as inside sales', () => {
    expect(resolveLeadChannel({ source: 'call_center' })).toBe('inside_sales')
  })

  it('buckets csv_import as canvass via isCanvassDoorLead', () => {
    expect(resolveLeadChannel({ source: 'csv_import' })).toBe('canvass')
  })

  it('defaults unknown non-canvass sources to other', () => {
    expect(resolveLeadChannel({ source: 'referral' })).toBe('other')
  })
})

describe('assertGoalsAdminAccess', () => {
  it('allows admin and owner only', () => {
    expect(assertGoalsAdminAccess('admin')).toBe(true)
    expect(assertGoalsAdminAccess('owner')).toBe(true)
    expect(assertGoalsAdminAccess('operations')).toBe(false)
    expect(assertGoalsAdminAccess('sales_manager')).toBe(false)
  })
})

describe('computeForecast integration', () => {
  const asOf = new Date('2026-03-15T17:00:00.000Z')
  const rangeStart = new Date(getEasternDateRange('2026-03-01', '2026-03-31').startIso)
  const rangeEnd = new Date(getEasternDateRange('2026-03-01', '2026-03-31').endIso)

  it('derives sits and sales from projected sets using funnel rates', () => {
    const history: ForecastHistory = {
      doors: [],
      sets: [
        '2026-01-05T15:00:00.000Z',
        '2026-01-12T15:00:00.000Z',
        '2026-01-19T15:00:00.000Z',
        '2026-01-26T15:00:00.000Z',
        '2026-02-02T15:00:00.000Z',
        '2026-02-09T15:00:00.000Z',
        '2026-02-16T15:00:00.000Z',
        '2026-02-23T15:00:00.000Z',
        '2026-03-01T15:00:00.000Z',
        '2026-03-08T15:00:00.000Z',
        '2026-03-10T15:00:00.000Z',
      ],
      sits: [
        '2026-01-06T15:00:00.000Z',
        '2026-01-13T15:00:00.000Z',
        '2026-01-20T15:00:00.000Z',
        '2026-01-27T15:00:00.000Z',
        '2026-02-03T15:00:00.000Z',
        '2026-02-10T15:00:00.000Z',
        '2026-02-17T15:00:00.000Z',
        '2026-02-24T15:00:00.000Z',
        '2026-03-02T15:00:00.000Z',
        '2026-03-09T15:00:00.000Z',
      ],
      sales: Array.from({ length: 10 }).map((_, i) => ({
        signedAt: new Date(Date.UTC(2026, 0, 10 + i * 7)).toISOString(),
        projectCost: 16000,
      })),
      payments: [],
      setToSalePairs: Array.from({ length: 10 }).map((_, i) => ({
        setAt: new Date(Date.UTC(2026, 0, 5 + i * 7)).toISOString(),
        signedAt: new Date(Date.UTC(2026, 0, 10 + i * 7)).toISOString(),
      })),
    }

    const result = computeForecast({
      rangeStart,
      rangeEnd,
      asOf,
      history,
      knownFutureSets: ['2026-03-20T15:00:00.000Z'],
      goals: { sets: 20, sits: 15, sales: 5 },
    })

    expect(result.metrics.sets.actual).toBe(3)
    expect(result.metrics.sits.actual).toBeGreaterThanOrEqual(1)
    expect(result.assumptions.some((a) => a.label === 'Set → sit rate')).toBe(true)
    expect(result.assumptions.some((a) => a.sampleSize >= 10)).toBe(true)
  })
})
