import {
  calendarWeekBounds,
  pickPrimaryPayDisplay,
  statementPathForPeriod,
} from '@/lib/payroll-dashboard-pay'

describe('payroll-dashboard-pay', () => {
  describe('calendarWeekBounds', () => {
    it('returns a seven-day window ending six days after start', () => {
      const wed = new Date('2026-05-27T15:00:00Z')
      const { weekStart, weekEnd } = calendarWeekBounds(wed)
      const [sy, sm, sd] = weekStart.split('-').map(Number)
      const [ey, em, ed] = weekEnd.split('-').map(Number)
      const startUtc = Date.UTC(sy, sm - 1, sd)
      const endUtc = Date.UTC(ey, em - 1, ed)
      expect((endUtc - startUtc) / (1000 * 60 * 60 * 24)).toBe(6)
    })
  })

  describe('pickPrimaryPayDisplay', () => {
    it('prefers open-period estimate over official and legacy', () => {
      const picked = pickPrimaryPayDisplay({
        estimate: { netPayout: 1200.456 },
        officialLast: { netPayout: 900 },
        legacyTotal: 50,
      })
      expect(picked.primaryLabel).toBe('estimated')
      expect(picked.primaryAmount).toBe(1200.46)
      expect(picked.source).toBe('payroll_estimate')
    })

    it('uses last official when no estimate', () => {
      const picked = pickPrimaryPayDisplay({
        estimate: null,
        officialLast: { netPayout: 800 },
        legacyTotal: 200,
      })
      expect(picked.primaryLabel).toBe('official_last')
      expect(picked.primaryAmount).toBe(800)
      expect(picked.source).toBe('payroll_official')
    })

    it('falls back to legacy with legacy_only source when nonzero', () => {
      const picked = pickPrimaryPayDisplay({
        estimate: null,
        officialLast: null,
        legacyTotal: 75,
      })
      expect(picked.primaryLabel).toBe('legacy')
      expect(picked.primaryAmount).toBe(75)
      expect(picked.source).toBe('legacy_only')
    })
  })

  describe('statementPathForPeriod', () => {
    it('builds in-app statement path', () => {
      expect(statementPathForPeriod('abc-123')).toBe('/commissions/statement/abc-123')
    })
  })
})
