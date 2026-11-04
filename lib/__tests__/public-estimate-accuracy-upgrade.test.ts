import { pitchMultiplierFromDegrees } from '@/lib/public-estimate-pitch'
import { nearbyStructures, type LocalPoint } from '@/lib/lidar/roof-planes'
import { describeEstimateMeasureCheck } from '@/lib/public-estimate-lead'
import { resolvePublicEstimatePricePerSquare, __resetPublicEstimateRateCache } from '@/lib/public-estimate-rate'

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))

describe('pitch multiplier (low-slope fix)', () => {
  it('keeps a real near-flat reading instead of billing it as 6/12', () => {
    expect(pitchMultiplierFromDegrees(1.5)).toBeCloseTo(1.0003, 3)
    expect(pitchMultiplierFromDegrees(0)).toBe(1)
  })
  it('only a missing/garbage pitch falls back to 6/12', () => {
    const sixTwelve = Math.sqrt(1 + 0.25)
    expect(pitchMultiplierFromDegrees(null)).toBeCloseTo(sixTwelve, 6)
    expect(pitchMultiplierFromDegrees(Number.NaN)).toBeCloseTo(sixTwelve, 6)
    expect(pitchMultiplierFromDegrees(85)).toBeCloseTo(sixTwelve, 6)
  })
  it('uses the exact angle (no rounding to whole x/12)', () => {
    expect(pitchMultiplierFromDegrees(30)).toBeCloseTo(1 / Math.cos(Math.PI / 6), 6)
  })
})

/** A filled w×h metre block of points at height z, offset by (ox, oy). */
function block(ox: number, oy: number, w: number, h: number, z = 5): LocalPoint[] {
  const pts: LocalPoint[] = []
  for (let x = 0; x < w; x += 0.5) for (let y = 0; y < h; y += 0.5) pts.push({ x: ox + x, y: oy + y, z })
  return pts
}

describe('nearbyStructures (detached garage flag)', () => {
  it('flags a garage-sized building near the house and ignores a shed', () => {
    const house = block(-6, -5, 12, 10) // under the pin
    const garage = block(10, -3, 7, 7) // ~49 m² (≈530 sq ft), 4 m away
    const shed = block(-6, 9, 3, 3) // 9 m² — ignored
    const found = nearbyStructures([...house, ...garage, ...shed])
    expect(found).toHaveLength(1)
    expect(found[0].footprintSqft).toBeGreaterThan(400)
    expect(found[0].footprintSqft).toBeLessThan(700)
  })
  it('ignores a neighbour-sized house', () => {
    const house = block(-6, -5, 12, 10)
    const neighbour = block(10, -6, 12, 12) // 144 m² — too big to be an outbuilding
    expect(nearbyStructures([...house, ...neighbour])).toHaveLength(0)
  })
  it('ignores a neighbour house cut off at the 35 m clip edge', () => {
    const house = block(-6, -5, 12, 10)
    const clippedNeighbour = block(27, -4, 7.9, 8) // ends at x≈34.9 — touching the clip box
    expect(nearbyStructures([...house, ...clippedNeighbour])).toHaveLength(0)
  })
  it('returns nothing when no building is under the pin', () => {
    expect(nearbyStructures(block(30, 30, 8, 8))).toEqual([])
  })
})

describe('rep-facing measure check lines', () => {
  const base = {
    jti: 't',
    address: '1 Main St',
    lat: 35,
    lng: -80,
    squares_mid: 30,
    squares_low: 28,
    squares_high: 33,
    waste_percent: 16,
    facet_count: 9,
    requires_manual_measure: false,
    expiresAt: 0,
  }
  it('describes lidar confidence, flags and detached structures', () => {
    const lines = describeEstimateMeasureCheck({
      ...base,
      measure_source: 'lidar',
      confidence: 'high',
      lidar_collected_end: '2017-02-21',
      base_squares: 25.9,
      flags: ['possible_detached_structure', 'geocode_range_interpolated'],
      other_structures: [{ footprintSqft: 528, gapFt: 14 }],
    })
    expect(lines[0]).toMatch(/HIGH — in-house lidar \(2017 survey\) · 25.9 sq before waste/)
    expect(lines.join('\n')).toMatch(/detached garage/)
    expect(lines.join('\n')).toMatch(/address pin was approximate/)
    expect(lines.join('\n')).toMatch(/~528 sq ft structure 14 ft from the house/)
  })
  it('is empty for legacy snapshots with no accuracy fields', () => {
    expect(describeEstimateMeasureCheck({ ...base, measure_source: 'solar_mask' })).toEqual([])
  })
})

describe('pricebook rate resolver', () => {
  const OLD_ENV = process.env
  beforeEach(() => {
    process.env = { ...OLD_ENV }
    delete process.env.PUBLIC_ESTIMATE_PRICE_PER_SQUARE
    __resetPublicEstimateRateCache()
  })
  afterAll(() => {
    process.env = OLD_ENV
  })

  function adminReturning(row: unknown, error: unknown = null) {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit']) chain[m] = () => chain
    chain.maybeSingle = async () => ({ data: row, error })
    return { from: () => chain } as never
  }

  it('reads the Asphalt Shingles per-square sell rate', async () => {
    const rate = await resolvePublicEstimatePricePerSquare(adminReturning({ unit_price: '465.00', pricing_unit: 'square' }), 'org')
    expect(rate).toBe(465)
  })
  it('converts a per-sq-ft rate and ignores an out-of-band rate', async () => {
    expect(await resolvePublicEstimatePricePerSquare(adminReturning({ unit_price: '4.65', pricing_unit: 'sqft' }), 'org')).toBe(465)
    __resetPublicEstimateRateCache()
    expect(await resolvePublicEstimatePricePerSquare(adminReturning({ unit_price: '450', pricing_unit: 'lf' }), 'org')).toBe(451.2)
    __resetPublicEstimateRateCache()
    expect(await resolvePublicEstimatePricePerSquare(adminReturning({ unit_price: '45.12', pricing_unit: 'square' }), 'org')).toBe(451.2)
  })
  it('falls back to the default on a read error and never throws', async () => {
    expect(await resolvePublicEstimatePricePerSquare(adminReturning(null, { message: 'boom' }), 'org')).toBe(451.2)
  })
  it('env override wins', async () => {
    process.env.PUBLIC_ESTIMATE_PRICE_PER_SQUARE = '480'
    expect(await resolvePublicEstimatePricePerSquare(adminReturning({ unit_price: '465', pricing_unit: 'square' }), 'org')).toBe(480)
  })
})
