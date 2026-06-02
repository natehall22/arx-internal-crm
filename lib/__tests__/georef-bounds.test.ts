import {
  boundsFromPoints,
  imagePixelToLatLng,
  initialViewScaleForFacet,
  latLngToImagePixel,
} from '@/lib/georef-bounds'

const bounds = { north: 35.1, south: 35.099, east: -80.2, west: -80.201 }
const w = 1000
const h = 1000

describe('georef-bounds', () => {
  it('roundtrips lat/lng through image pixels', () => {
    const lat = 35.0995
    const lng = -80.2005
    const px = latLngToImagePixel(lat, lng, bounds, w, h)
    const back = imagePixelToLatLng(px.x, px.y, bounds, w, h)
    expect(back.lat).toBeCloseTo(lat, 5)
    expect(back.lng).toBeCloseTo(lng, 5)
  })

  it('maps corners correctly', () => {
    const nw = latLngToImagePixel(bounds.north, bounds.west, bounds, w, h)
    expect(nw.x).toBeCloseTo(0, 3)
    expect(nw.y).toBeCloseTo(0, 3)
    const se = latLngToImagePixel(bounds.south, bounds.east, bounds, w, h)
    expect(se.x).toBeCloseTo(w, 3)
    expect(se.y).toBeCloseTo(h, 3)
  })

  it('initialViewScaleForFacet returns zoom >= 2 for small facet', () => {
    const facet = [
      { lat: 35.09952, lng: -80.20052 },
      { lat: 35.09952, lng: -80.20048 },
      { lat: 35.09948, lng: -80.20048 },
      { lat: 35.09948, lng: -80.20052 },
    ]
    const scale = initialViewScaleForFacet(facet, bounds, w, h, 800, 600)
    expect(scale).toBeGreaterThanOrEqual(2)
    expect(boundsFromPoints(facet)).not.toBeNull()
  })
})
