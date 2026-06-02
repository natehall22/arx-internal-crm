import {
  ROOF_MEASURE_EDIT_ZOOM_TARGET,
  ROOF_MEASURE_MAP_MAX_ZOOM,
  boundsFromPoints,
  expandBounds,
  resolveEditZoom,
  roundedZoomForDetectKey,
} from '@/lib/roof-measure-map-zoom'

describe('roof-measure-map-zoom', () => {
  it('resolveEditZoom prefers 22+ when imagery allows', () => {
    expect(resolveEditZoom(23)).toBe(23)
    expect(resolveEditZoom(22)).toBe(22)
    expect(resolveEditZoom(null)).toBe(ROOF_MEASURE_EDIT_ZOOM_TARGET)
  })

  it('resolveEditZoom respects low max zoom locations', () => {
    expect(resolveEditZoom(20)).toBe(20)
    expect(resolveEditZoom(19)).toBe(19)
  })

  it('resolveEditZoom never exceeds map cap', () => {
    expect(resolveEditZoom(99)).toBe(ROOF_MEASURE_MAP_MAX_ZOOM)
  })

  it('boundsFromPoints and expandBounds pad tiny facets', () => {
    const bounds = boundsFromPoints([
      { lat: 35.1, lng: -80.2 },
      { lat: 35.10001, lng: -80.19999 },
    ])
    expect(bounds).not.toBeNull()
    const expanded = expandBounds(bounds!)
    expect(expanded.north).toBeGreaterThan(bounds!.north)
    expect(expanded.south).toBeLessThan(bounds!.south)
  })

  it('roundedZoomForDetectKey stabilizes fractional zoom', () => {
    expect(roundedZoomForDetectKey(21.4)).toBe(21)
    expect(roundedZoomForDetectKey(21.6)).toBe(22)
  })
})
