import { calculateEstimateTotals } from '../calculations'
import type { EstimateLine } from '@/lib/types/database'

describe('calculateEstimateTotals', () => {
  const baseLine: EstimateLine = {
    id: '1',
    org_id: 'org-1',
    estimate_id: 'est-1',
    pricebook_item_id: null,
    category: 'roofing',
    name: 'Test',
    unit: 'square',
    qty: 1,
    unit_price: 100,
    line_total: 100,
    is_labor: false,
    is_taxable: true,
    sort_order: 0,
    created_at: '',
    updated_at: '',
  }

  it('calculates basic totals correctly', () => {
    const lines: EstimateLine[] = [
      { ...baseLine, is_labor: false, qty: 2, unit_price: 100, line_total: 200 },
    ]

    const result = calculateEstimateTotals(lines, 0, 0, 0.08, 0)

    expect(result.subtotal).toBe(200)
    expect(result.tax).toBe(16) // 200 * 0.08
    expect(result.total).toBe(216)
  })

  it('applies labor multipliers correctly', () => {
    const lines: EstimateLine[] = [
      { ...baseLine, is_labor: true, qty: 1, unit_price: 100, line_total: 100 },
    ]

    const result = calculateEstimateTotals(lines, 0.1, 0.15, 0.08, 0)

    // Labor: 100 * (1 + 0.1 + 0.15) = 125
    expect(result.laborSubtotal).toBe(100)
    expect(result.subtotal).toBe(125)
    expect(result.tax).toBe(10) // 125 * 0.08
    expect(result.total).toBe(135)
  })

  it('applies discount correctly', () => {
    const lines: EstimateLine[] = [
      { ...baseLine, is_labor: false, qty: 1, unit_price: 100, line_total: 100 },
    ]

    const result = calculateEstimateTotals(lines, 0, 0, 0.08, 50)

    expect(result.subtotal).toBe(50) // 100 - 50
    expect(result.tax).toBe(4) // 50 * 0.08
    expect(result.total).toBe(54)
  })

  it('handles mixed labor and materials', () => {
    const lines: EstimateLine[] = [
      { ...baseLine, is_labor: true, qty: 1, unit_price: 100, line_total: 100 },
      { ...baseLine, is_labor: false, qty: 1, unit_price: 200, line_total: 200 },
    ]

    const result = calculateEstimateTotals(lines, 0.1, 0.15, 0.08, 0)

    // Labor: 100 * 1.25 = 125
    // Materials: 200
    // Subtotal: 325
    expect(result.laborSubtotal).toBe(100)
    expect(result.materialsSubtotal).toBe(200)
    expect(result.subtotal).toBe(325)
    expect(result.tax).toBe(26) // 325 * 0.08
    expect(result.total).toBe(351)
  })

  it('handles non-taxable items', () => {
    const lines: EstimateLine[] = [
      { ...baseLine, is_taxable: true, qty: 1, unit_price: 100, line_total: 100 },
      { ...baseLine, is_taxable: false, qty: 1, unit_price: 100, line_total: 100 },
    ]

    const result = calculateEstimateTotals(lines, 0, 0, 0.08, 0)

    expect(result.subtotal).toBe(200)
    expect(result.tax).toBe(8) // Only first item is taxable
    expect(result.total).toBe(208)
  })
})
