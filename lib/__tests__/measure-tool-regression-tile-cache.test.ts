/** Regression: the decoded-tile LRU in lib/lidar/building-points.ts returns what an uncached read would. */
import { encodeTilePoints } from '@/lib/lidar/tile-store'
import { wgs84ToNcFt } from '@/lib/lidar/nc-state-plane'

const LAT = 35.4875
const LNG = -80.6217

function tileBytes(seed: number) {
  const [px, py] = wgs84ToNcFt(LAT, LNG)
  const xyz = new Float64Array(300)
  for (let i = 0; i < 100; i++) {
    xyz[i * 3] = px + ((i * 7 + seed) % 60) - 30
    xyz[i * 3 + 1] = py + ((i * 13 + seed) % 60) - 30
    xyz[i * 3 + 2] = 700 + seed + (i % 10)
  }
  return new Uint8Array(encodeTilePoints(xyz))
}

function fakeAdmin(tiles: Array<{ id: string; path: string }>, bytes: Record<string, Uint8Array | 'error'>) {
  const downloads: string[] = []
  const admin: any = {
    from: () => {
      const q: any = { select: () => q, lte: () => q, gte: () => q }
      q.then = (res: any) => res({ data: tiles.map((t) => ({ id: t.id, status: 'ready', storage_path: t.path, collected_end: '2017-03-01' })), error: null })
      return q
    },
    storage: {
      from: () => ({
        download: async (p: string) => {
          downloads.push(p)
          const b = bytes[p]
          if (b === 'error' || !b) return { data: null, error: new Error('dl failed') }
          return { data: { arrayBuffer: async () => b.slice().buffer }, error: null }
        },
      }),
    },
  }
  return { admin, downloads }
}

describe('lidar decoded-tile cache', () => {
  beforeEach(() => jest.resetModules())

  it('second read returns identical points without re-downloading', async () => {
    const { loadBuildingPointsNear } = await import('@/lib/lidar/building-points')
    const { admin, downloads } = fakeAdmin([{ id: 'a', path: 'p/a' }], { 'p/a': tileBytes(1) })
    const r1 = await loadBuildingPointsNear(admin, LAT, LNG)
    // Callers mutate the returned points freely; that must not leak into the cache.
    if (r1.status === 'ok') r1.points.forEach((p) => { p.x += 999 })
    const r2 = await loadBuildingPointsNear(admin, LAT, LNG)
    const r1fresh = await (await (jest.resetModules(), import('@/lib/lidar/building-points'))).loadBuildingPointsNear(fakeAdmin([{ id: 'a', path: 'p/a' }], { 'p/a': tileBytes(1) }).admin, LAT, LNG)
    expect(downloads).toEqual(['p/a'])
    expect(r2).toEqual(r1fresh)
  })

  it('different paths never collide; download errors are thrown and not cached', async () => {
    const { loadBuildingPointsNear } = await import('@/lib/lidar/building-points')
    const bytes: Record<string, Uint8Array | 'error'> = { 'p/a': tileBytes(1), 'p/b': 'error' }
    const a = fakeAdmin([{ id: 'a', path: 'p/a' }], bytes)
    const b = fakeAdmin([{ id: 'b', path: 'p/b' }], bytes)
    const ra = await loadBuildingPointsNear(a.admin, LAT, LNG)
    await expect(loadBuildingPointsNear(b.admin, LAT, LNG)).rejects.toThrow('dl failed')
    bytes['p/b'] = tileBytes(2)
    const rb = await loadBuildingPointsNear(b.admin, LAT, LNG)
    expect(b.downloads).toEqual(['p/b', 'p/b'])
    expect(rb).not.toEqual(ra)
  })

  it('holds at most 6 tiles (LRU)', async () => {
    const { loadBuildingPointsNear } = await import('@/lib/lidar/building-points')
    const bytes: Record<string, Uint8Array> = {}
    for (let i = 0; i < 8; i++) bytes[`p/${i}`] = tileBytes(i)
    const all = fakeAdmin([], bytes)
    for (let i = 0; i < 8; i++) {
      const one = fakeAdmin([{ id: String(i), path: `p/${i}` }], bytes)
      one.admin.storage = all.admin.storage
      await loadBuildingPointsNear(one.admin, LAT, LNG)
    }
    // p/0 and p/1 evicted; p/7 still cached.
    for (const i of [7, 0]) {
      const one = fakeAdmin([{ id: String(i), path: `p/${i}` }], bytes)
      one.admin.storage = all.admin.storage
      await loadBuildingPointsNear(one.admin, LAT, LNG)
    }
    expect(all.downloads.slice(8)).toEqual(['p/0'])
  })
})
