import { buildMaterialsOrderList } from '@/lib/materials-order-list'

// Numbers from job 26-0028 (Randy Hart): 19.1 sq sold total (waste incl.),
// hip 81 LF, valley 27 LF, eave 168 LF, no ridge/rakes.
const hartLinear = {
  ridges_lf: null,
  valleys_lf: 27,
  hips_lf: 81,
  eaves_lf: 168,
  rakes_lf: null,
  flashing_lf: null,
  step_flashing_lf: null,
  wall_flashing_lf: null,
  drip_edge_lf: null,
}

describe('buildMaterialsOrderList', () => {
  const items = buildMaterialsOrderList({
    totalSquaresWithWaste: 19.1,
    linear: hartLinear,
  })
  const byKey = Object.fromEntries(items.map((i) => [i.key, i]))

  it('orders field shingles rounded up to full bundles', () => {
    expect(byKey.field_shingles.status).toBe('ready')
    expect(byKey.field_shingles.qty).toContain('58 bundles') // ceil(19.1 * 3)
  })

  it('matches the sold-scope card starter math (168 LF → 2 bundles)', () => {
    expect(byKey.starter.status).toBe('ready')
    expect(byKey.starter.qty).toBe('2 bundles')
    expect(byKey.starter.detail).toContain('5% safety cushion')
  })

  it('adds starter safety cushion for borderline LF totals', () => {
    const borderline = buildMaterialsOrderList({
      totalSquaresWithWaste: 10,
      linear: { ...hartLinear, eaves_lf: 122, rakes_lf: null },
    })
    expect(borderline.find((i) => i.key === 'starter')!.qty).toBe('2 bundles')
  })

  it('matches the sold-scope card cap math (81 LF → 0.81 sq, 4 bundles)', () => {
    expect(byKey.hip_ridge_cap.qty).toContain('0.81 sq')
    expect(byKey.hip_ridge_cap.qty).toContain('4 bundles')
  })

  it('omits ridge vent when there is no ridge', () => {
    expect(byKey.ridge_vent).toBeUndefined()
  })

  it('computes underlayment rolls from total squares', () => {
    expect(byKey.underlayment.qty).toBe('2 rolls') // ceil(19.1 / 10)
  })

  it('surfaces valley ice & water as confirm-only (ARX convention)', () => {
    expect(byKey.ice_water_valleys.status).toBe('confirm')
    expect(byKey.ice_water_valleys.qty).toContain('1 roll')
  })

  it('marks drip edge confirm-only (not ordered on every job)', () => {
    expect(byKey.drip_edge.status).toBe('confirm')
    expect(byKey.drip_edge.qty).toContain('17 sticks') // ceil(168 / 10)
  })

  it('always includes pipe boots as a manual row', () => {
    expect(byKey.pipe_boots.status).toBe('manual')
  })

  it('subtracts 3 ft per ridge end for ridge vent', () => {
    const withRidge = buildMaterialsOrderList({
      totalSquaresWithWaste: 20,
      linear: { ...hartLinear, ridges_lf: 46 },
    })
    const vent = withRidge.find((i) => i.key === 'ridge_vent')!
    expect(vent.qty).toContain('40 LF') // 46 - 6
    expect(vent.qty).toContain('10 pieces') // ceil(40 / 4)
  })

  it('falls back to a single ridge run when segment count implies implausible setback', () => {
    const suspect = buildMaterialsOrderList({
      totalSquaresWithWaste: 20,
      linear: { ...hartLinear, ridges_lf: 30 },
      ridgeSegmentCount: 4, // 24 ft setback > half of 30 LF → distrust
    })
    const vent = suspect.find((i) => i.key === 'ridge_vent')!
    expect(vent.qty).toContain('24 LF') // 30 - 6, single-run fallback
  })

  it('auto-computes ice & water for low-slope area', () => {
    const lowSlope = buildMaterialsOrderList({
      totalSquaresWithWaste: 20,
      linear: hartLinear,
      lowSlopeAreaSqft: 350,
      lowSlopeFacetCount: 1,
    })
    const iw = lowSlope.find((i) => i.key === 'ice_water_low_slope')!
    expect(iw.status).toBe('ready')
    expect(iw.qty).toBe('2 rolls') // ceil(350 / 200)
  })

  it('flags missing squares instead of guessing', () => {
    const noSq = buildMaterialsOrderList({ totalSquaresWithWaste: null, linear: hartLinear })
    expect(noSq.find((i) => i.key === 'field_shingles')!.status).toBe('confirm')
  })
})
