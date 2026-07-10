import {
  deltaTextClass,
  formatDeltaPct,
  formatMetricValue,
  formatSignedDelta,
  isCurrencyMetric,
} from '@/lib/goals-forecast-display'

describe('goals-forecast-display', () => {
  describe('formatMetricValue', () => {
    it('formats count metrics as integers', () => {
      expect(formatMetricValue('doors', 1234.6)).toBe('1,235')
      expect(formatMetricValue('sales', 42)).toBe('42')
    })

    it('formats revenue metrics as currency', () => {
      expect(formatMetricValue('revenueSigned', 18865)).toBe('$18,865')
      expect(formatMetricValue('revenueCollected', 5000)).toBe('$5,000')
    })
  })

  describe('isCurrencyMetric', () => {
    it('identifies revenue keys', () => {
      expect(isCurrencyMetric('revenueSigned')).toBe(true)
      expect(isCurrencyMetric('revenueCollected')).toBe(true)
      expect(isCurrencyMetric('doors')).toBe(false)
    })
  })

  describe('formatSignedDelta', () => {
    it('prefixes positive deltas and uses currency for revenue', () => {
      expect(formatSignedDelta('doors', 12)).toBe('+12')
      expect(formatSignedDelta('revenueSigned', 1500)).toBe('+$1,500')
    })

    it('formats negative deltas with a leading minus', () => {
      expect(formatSignedDelta('sets', -3)).toBe('-3')
    })

    it('returns em dash for null', () => {
      expect(formatSignedDelta('doors', null)).toBe('—')
    })
  })

  describe('formatDeltaPct', () => {
    it('computes percentage with one decimal', () => {
      expect(formatDeltaPct(25, 100)).toBe('25.0%')
      expect(formatDeltaPct(-10, 200)).toBe('-5.0%')
    })

    it('avoids divide-by-zero when compare total is 0', () => {
      expect(formatDeltaPct(100, 0)).toBe('—')
    })

    it('returns em dash for null delta', () => {
      expect(formatDeltaPct(null, 100)).toBe('—')
    })
  })

  describe('deltaTextClass', () => {
    it('maps sign to palette classes', () => {
      expect(deltaTextClass(5)).toBe('text-emerald-700')
      expect(deltaTextClass(-5)).toBe('text-rose-700')
      expect(deltaTextClass(0)).toBe('text-gray-600')
      expect(deltaTextClass(null)).toBe('text-gray-600')
    })
  })
})
