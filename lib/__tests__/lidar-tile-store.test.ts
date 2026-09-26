import { decodeTilePoints, encodeTilePoints } from '@/lib/lidar/tile-store'
import { ncFtToWgs84, wgs84ToNcFt } from '@/lib/lidar/nc-state-plane'

describe('lidar tile store', () => {
  it('round-trips building points to 0.05 ft', () => {
    const xyz = Float64Array.from([1555000.0, 595000.0, 675.01, 1557499.97, 597499.99, 855.44, 1556123.456, 596789.012, 700.5])
    const back = decodeTilePoints(encodeTilePoints(xyz)).xyz
    expect(back.length).toBe(xyz.length)
    for (let i = 0; i < xyz.length; i++) expect(Math.abs(back[i] - xyz[i])).toBeLessThanOrEqual(0.025 + 1e-6)
  })

  it('handles an empty tile and rejects foreign data', () => {
    expect(decodeTilePoints(encodeTilePoints(new Float64Array())).xyz.length).toBe(0)
    expect(() => decodeTilePoints(require('zlib').gzipSync(Buffer.from('nope')))).toThrow(/ARXL/)
  })

  it('refuses extents that overflow the format instead of wrapping', () => {
    expect(() => encodeTilePoints(Float64Array.from([0, 0, 0, 5000, 0, 0]))).toThrow(/uint16/)
  })
})

describe('NC State Plane', () => {
  it('round-trips a Concord address within a centimetre', () => {
    const [x, y] = wgs84ToNcFt(35.43764490274893, -80.63291698773156)
    // Kison Ct sits in the tile spanning x 1513…1515k ft, y 617…620k ft
    expect(x).toBeGreaterThan(1_500_000)
    expect(x).toBeLessThan(1_530_000)
    const ll = ncFtToWgs84(x, y)
    expect(Math.abs(ll.lat - 35.43764490274893)).toBeLessThan(1e-7)
    expect(Math.abs(ll.lng + 80.63291698773156)).toBeLessThan(1e-7)
  })
})
