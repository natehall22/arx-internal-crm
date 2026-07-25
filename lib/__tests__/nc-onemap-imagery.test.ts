import { parseArcGisDate, propertyBounds } from '@/lib/nc-onemap-imagery'

describe('NC OneMap imagery helpers', () => {
  it('builds finite property bounds around the requested coordinate', () => {
    const bounds = propertyBounds(35.2271, -80.8431)
    expect(bounds.north).toBeGreaterThan(35.2271)
    expect(bounds.south).toBeLessThan(35.2271)
    expect(bounds.east).toBeGreaterThan(-80.8431)
    expect(bounds.west).toBeLessThan(-80.8431)
  })

  it('parses ArcGIS epoch dates and rejects invalid values', () => {
    expect(parseArcGisDate(1456531200000)).toBe('2016-02-27')
    expect(parseArcGisDate('not-a-date')).toBeNull()
    expect(parseArcGisDate(null)).toBeNull()
  })
})
