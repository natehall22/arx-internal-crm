import { resolveLeadChannel } from '@/lib/goals-channel-attribution'
import {
  getEasternMonthEndDate,
  getForecastPresetRange,
  listGoalMonthsInRange,
} from '@/lib/goals-period'
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

describe('getForecastPresetRange', () => {
  it('runs the month preset to end of month, not to today', () => {
    // The forecast grades the range against a whole-month target, so the range has
    // to be the whole month. Ending it at "today" made Gap ≈ Goal every time.
    expect(getForecastPresetRange('mtd', '2026-08-04')).toEqual({
      start: '2026-08-01',
      end: '2026-08-31',
    })
  })

  it('handles a February month end', () => {
    expect(getForecastPresetRange('mtd', '2028-02-10').end).toBe('2028-02-29')
  })

  it('runs the quarter preset to end of quarter', () => {
    expect(getForecastPresetRange('this_quarter', '2026-08-04')).toEqual({
      start: '2026-07-01',
      end: '2026-09-30',
    })
  })

  it('compares against the previous calendar quarter, not a fixed 90 days', () => {
    expect(getForecastPresetRange('last_vs_this_quarter', '2026-08-04')).toEqual({
      start: '2026-07-01',
      end: '2026-09-30',
      compareStart: '2026-04-01',
      compareEnd: '2026-06-30',
    })
  })

  it('rolls the compare quarter back across a year boundary', () => {
    expect(getForecastPresetRange('last_vs_this_quarter', '2026-02-14')).toEqual({
      start: '2026-01-01',
      end: '2026-03-31',
      compareStart: '2025-10-01',
      compareEnd: '2025-12-31',
    })
  })
})

describe('listGoalMonthsInRange', () => {
  it('lists every month a range touches', () => {
    expect(listGoalMonthsInRange('2026-07-01', '2026-09-30')).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
    ])
  })

  it('returns a single month for an in-month range', () => {
    expect(listGoalMonthsInRange('2026-08-04', '2026-08-20')).toEqual(['2026-08'])
  })

  it('crosses a year boundary', () => {
    expect(listGoalMonthsInRange('2025-12-15', '2026-01-05')).toEqual(['2025-12', '2026-01'])
  })
})

describe('getEasternMonthEndDate', () => {
  it('handles 30- and 31-day months and leap February', () => {
    expect(getEasternMonthEndDate('2026-08')).toBe('2026-08-31')
    expect(getEasternMonthEndDate('2026-09')).toBe('2026-09-30')
    expect(getEasternMonthEndDate('2028-02')).toBe('2028-02-29')
    expect(getEasternMonthEndDate('2026-02')).toBe('2026-02-28')
  })

  it('is not thrown off by the DST transitions bracketing March and November', () => {
    expect(getEasternMonthEndDate('2026-03')).toBe('2026-03-31')
    expect(getEasternMonthEndDate('2026-10')).toBe('2026-10-31')
  })
})
