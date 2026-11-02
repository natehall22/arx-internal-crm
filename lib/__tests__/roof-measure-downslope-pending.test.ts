import { isDownslopePending } from '@/lib/roof-measure-drain-overlay'

const square = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 0.0001 },
  { lat: 0.0001, lng: 0.0001 },
  { lat: 0.0001, lng: 0 },
]
// Medium confidence → every section "needs review" per needsDrainReview.
const ctx = { measurementConfidence: 'medium' as const }

describe('isDownslopePending', () => {
  it('auto downslope on a section needing review is pending', () => {
    expect(isDownslopePending({ id: 'a', points: square, drain_azimuth_source: 'footprint_auto' }, ctx)).toBe(true)
  })

  it('a manual arrow clears it', () => {
    expect(isDownslopePending({ id: 'a', points: square, drain_azimuth_source: 'manual' }, ctx)).toBe(false)
  })

  it('lidar-measured downslope clears it', () => {
    expect(
      isDownslopePending({ id: 'a', points: square, drain_azimuth_source: 'dsm', drain_azimuth_degrees: 180 }, ctx)
    ).toBe(false)
  })

  it('lidar source with no measured angle is still pending', () => {
    expect(
      isDownslopePending({ id: 'a', points: square, drain_azimuth_source: 'dsm', drain_azimuth_degrees: null }, ctx)
    ).toBe(true)
  })

  it('a high-confidence simple section is not pending', () => {
    expect(
      isDownslopePending(
        { id: 'a', points: square, drain_azimuth_source: 'footprint_auto' },
        { measurementConfidence: 'high' }
      )
    ).toBe(false)
  })
})
