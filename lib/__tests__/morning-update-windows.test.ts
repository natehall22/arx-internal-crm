import {
  isMondayEastern,
  resolveMorningUpdateActivityWindow,
  resolveMorningUpdateLastWeekWindow,
  resolveMorningUpdateSentDateLabel,
  resolveMorningUpdateToDateWindows,
  shareOfMonthGoalPct,
} from '../morning-update-windows'

/** Fixed ET instants: use noon UTC offsets that land unambiguously on the intended ET calendar day. */
function etWallClock(year: number, monthIndex: number, day: number, hour = 5, minute = 30): Date {
  // Build as ISO in America/New_York via toLocale trick: use Date.UTC then interpret.
  // Prefer explicit offset: EDT (UTC-4) for July.
  const offsetHours = monthIndex >= 2 && monthIndex <= 10 ? 4 : 5 // rough DST; July = 4
  return new Date(Date.UTC(year, monthIndex, day, hour + offsetHours, minute, 0))
}

describe('morning-update-windows', () => {
  describe('isMondayEastern', () => {
    it('is true on Monday morning ET', () => {
      // Monday July 13, 2026 5:30am EDT = 09:30 UTC
      expect(isMondayEastern(etWallClock(2026, 6, 13))).toBe(true)
    })

    it('is false on Tuesday morning ET', () => {
      expect(isMondayEastern(etWallClock(2026, 6, 14))).toBe(false)
    })

    it('is false on Saturday morning ET', () => {
      expect(isMondayEastern(etWallClock(2026, 6, 11))).toBe(false)
    })
  })

  describe('resolveMorningUpdateActivityWindow', () => {
    it('uses Sat–Sun weekend window on Monday', () => {
      const window = resolveMorningUpdateActivityWindow(etWallClock(2026, 6, 13))
      expect(window.kind).toBe('weekend')
      // Sat Jul 11 00:00 EDT = Jul 11 04:00 UTC; Mon Jul 13 00:00 EDT = Jul 13 04:00 UTC
      expect(window.start.toISOString()).toBe('2026-07-11T04:00:00.000Z')
      expect(window.end.toISOString()).toBe('2026-07-13T04:00:00.000Z')
      expect(window.periodLabel).toMatch(/Sat/)
      expect(window.periodLabel).toMatch(/Sun/)
    })

    it('uses yesterday only on Tuesday', () => {
      const window = resolveMorningUpdateActivityWindow(etWallClock(2026, 6, 14))
      expect(window.kind).toBe('yesterday')
      expect(window.start.toISOString()).toBe('2026-07-13T04:00:00.000Z')
      expect(window.end.toISOString()).toBe('2026-07-14T04:00:00.000Z')
      expect(window.periodLabel).toMatch(/Monday/)
    })
  })

  describe('resolveMorningUpdateLastWeekWindow', () => {
    it('returns prior Sun–Sat from Monday', () => {
      const week = resolveMorningUpdateLastWeekWindow(etWallClock(2026, 6, 13))
      // This week starts Sun Jul 12; last week Sun Jul 5 – Sat Jul 11
      expect(week.start.toISOString()).toBe('2026-07-05T04:00:00.000Z')
      expect(week.end.toISOString()).toBe('2026-07-12T04:00:00.000Z')
      expect(week.rangeLabel).toMatch(/Jul/)
      expect(week.monthGoalLabel).toMatch(/July/)
      expect(week.monthGoalLabel).toMatch(/2026/)
    })
  })

  describe('resolveMorningUpdateSentDateLabel', () => {
    it('labels the send calendar day', () => {
      expect(resolveMorningUpdateSentDateLabel(etWallClock(2026, 6, 13))).toMatch(
        /Monday, July 13, 2026/
      )
    })
  })

  describe('resolveMorningUpdateToDateWindows', () => {
    it('uses Sunday and month starts through the start of the send day', () => {
      const windows = resolveMorningUpdateToDateWindows(etWallClock(2026, 6, 14))
      expect(windows.weekToDate.start.toISOString()).toBe('2026-07-12T04:00:00.000Z')
      expect(windows.weekToDate.end.toISOString()).toBe('2026-07-14T04:00:00.000Z')
      expect(windows.monthToDate.start.toISOString()).toBe('2026-07-01T04:00:00.000Z')
      expect(windows.monthToDate.end.toISOString()).toBe('2026-07-14T04:00:00.000Z')
    })
  })

  describe('shareOfMonthGoalPct', () => {
    it('returns null when goal missing or zero', () => {
      expect(shareOfMonthGoalPct(10, null)).toBeNull()
      expect(shareOfMonthGoalPct(10, 0)).toBeNull()
    })

    it('rounds to one decimal', () => {
      expect(shareOfMonthGoalPct(400, 2000)).toBe(20)
      expect(shareOfMonthGoalPct(1, 3)).toBe(33.3)
    })
  })
})
