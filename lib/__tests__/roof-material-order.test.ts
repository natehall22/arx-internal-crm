import { roofCapBundlesFromLf, roofWasteAndOrder } from '@/lib/roof-material-order'

describe('roof material order (Greenway-class hip roof)', () => {
  it('28.13 sq + granular waste → ~33 order squares / 99 field bundles', () => {
    const o = roofWasteAndOrder({
      total_squares: 28.13,
      facet_count: 7,
      valleys_lf: 68,
      hips_lf: 109,
      ridges_lf: 112,
      avg_pitch_multiplier: 1.054,
    })
    expect(o.field.totalSquaresWithWaste).toBeGreaterThan(31)
    expect(o.field.fieldBundles).toBe(99)
    expect(o.field.recommendedOrderSquares).toBe(33)
  })

  it('cap order is in squares (2.21 sq), bundles are warehouse secondary', () => {
    const o = roofWasteAndOrder({
      total_squares: 28.13,
      facet_count: 7,
      valleys_lf: 68,
      hips_lf: 109,
      ridges_lf: 112,
      avg_pitch_multiplier: 1.054,
    })
    expect(o.caps!.combinedCapSq).toBe(2.21)
    const bundles = roofCapBundlesFromLf(112, 109)
    expect(bundles.totalCapBundles).toBe(10)
  })
})
