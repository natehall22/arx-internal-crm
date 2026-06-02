import { staticMapImageBounds } from '@/lib/static-satellite-map'

describe('staticMapImageBounds', () => {
  it('returns bounds enclosing center for a snapshot', () => {
    const lat = 35.25
    const lng = -80.78
    const bounds = staticMapImageBounds(lat, lng, 22, 1280, 1280)
    expect(bounds.north).toBeGreaterThan(lat)
    expect(bounds.south).toBeLessThan(lat)
    expect(bounds.east).toBeGreaterThan(lng)
    expect(bounds.west).toBeLessThan(lng)
  })
})
