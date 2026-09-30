import { dedupeReportFeatures, type WeatherGeoFeature } from '@/lib/weather-storage'

const report = (lng: number, lat: number, date: string, magnitude = 0, damage = true, layer = 'wind'): WeatherGeoFeature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: { kind: 'report', layer, magnitude, damage, date },
})

describe('dedupeReportFeatures', () => {
  it('collapses a corrected re-issue at the same spot and day', () => {
    const out = dedupeReportFeatures([
      report(-80.39, 35.4, '2025-08-01T18:00:00.000Z'),
      report(-80.39, 35.4, '2025-08-01T19:30:00.000Z'),
    ])
    expect(out).toHaveLength(1)
  })
  it('keeps reports on different days or at different spots', () => {
    const out = dedupeReportFeatures([
      report(-80.39, 35.4, '2025-08-01'),
      report(-80.39, 35.4, '2025-08-02'),
      report(-80.4, 35.4, '2025-08-01'),
    ])
    expect(out).toHaveLength(3)
  })
  it('keeps the largest magnitude and any damage flag', () => {
    const [one] = dedupeReportFeatures([
      report(-80.5, 35.3, '2026-07-05', 0, false),
      report(-80.5, 35.3, '2026-07-05', 62, true),
    ])
    expect(one.properties.magnitude).toBe(62)
    expect(one.properties.damage).toBe(true)
  })
  it('never merges hail with wind, and leaves warnings/swaths alone', () => {
    const warning: WeatherGeoFeature = { type: 'Feature', geometry: null, properties: { kind: 'warning' } }
    const out = dedupeReportFeatures([
      report(-80.5, 35.3, '2026-07-05', 1, false, 'hail'),
      report(-80.5, 35.3, '2026-07-05', 0, true, 'wind'),
      warning,
      warning,
    ])
    expect(out).toHaveLength(4)
  })
})
