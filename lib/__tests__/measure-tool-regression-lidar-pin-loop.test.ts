/**
 * Regression: the detect-roof lidar pin loop (main @ 48b1402) vs lib/lidar/measure-near.ts.
 * Same mocked loadBuildingPointsNear / measureRoofFromLidar, every scenario must pick the
 * same pin, same roof and the same "lidar wins vs fall through to Solar" outcome.
 */
jest.mock('@/lib/lidar/building-points', () => ({ loadBuildingPointsNear: jest.fn() }))
jest.mock('@/lib/lidar/roof-planes', () => {
  const actual = jest.requireActual('@/lib/lidar/roof-planes')
  return { ...actual, measureRoofFromLidar: jest.fn(), nearbyStructures: jest.fn(() => []) }
})

import { loadBuildingPointsNear } from '@/lib/lidar/building-points'
import { measureRoofFromLidar, nearbyStructures } from '@/lib/lidar/roof-planes'
import { measureLidarRoofNear } from '@/lib/lidar/measure-near'

type LatLng = { lat: number; lng: number }
const load = loadBuildingPointsNear as jest.Mock
const measure = measureRoofFromLidar as jest.Mock
const nearby = nearbyStructures as jest.Mock

// Verbatim from `git show 48b1402:app/api/ai/detect-roof/route.ts`.
function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const earthRadiusMeters = 6371000
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const haversine =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

/** OLD block, verbatim loop; returns what the route would act on. */
async function oldLoop(admin: any, requestedCenter: LatLng, anchor: LatLng | null | undefined) {
  const pins = [requestedCenter]
  if (anchor && distanceMeters(requestedCenter, anchor) > 5 && distanceMeters(requestedCenter, anchor) < 40) pins.push(anchor)
  let lidar: any = null
  let roof: any = null
  let pin = requestedCenter
  for (const candidate of pins) {
    lidar = await loadBuildingPointsNear(admin, candidate.lat, candidate.lng)
    roof = lidar.status === 'ok' ? measureRoofFromLidar(lidar.points) : null
    pin = candidate
    if (roof || lidar.status !== 'ok') break
  }
  const usesLidar = !!(lidar && roof)
  return { usesLidar, roof: usesLidar ? roof : null, pin: usesLidar ? pin : null, collectedEnd: usesLidar ? lidar.collectedEnd : null }
}

/** NEW block as in HEAD's detect-roof route. */
async function newLoop(admin: any, requestedCenter: LatLng, anchor: LatLng | null | undefined) {
  const lidar = await measureLidarRoofNear(admin, requestedCenter, anchor ?? null)
  const roof = lidar.status === 'ok' ? lidar.roof : null
  const pin = lidar.status === 'ok' ? lidar.pin : requestedCenter
  const usesLidar = lidar.status === 'ok' && !!roof
  return { usesLidar, roof: usesLidar ? roof : null, pin: usesLidar ? pin : null, collectedEnd: usesLidar ? (lidar as any).collectedEnd : null }
}

const REQ: LatLng = { lat: 35.4875, lng: -80.6217 }
const offsetNorth = (m: number): LatLng => ({ lat: REQ.lat + m / 111_195, lng: REQ.lng })

type Step = { status: 'ok' | 'not_ingested' | 'no_coverage'; roof: boolean }
const ROOF_A = { planes: [{ id: 'A' }], totals: {} }
const ROOF_B = { planes: [{ id: 'B' }], totals: {} }

function arrange(steps: Step[]) {
  load.mockReset()
  measure.mockReset()
  steps.forEach((s, i) => {
    load.mockImplementationOnce(async () => ({
      status: s.status,
      points: s.status === 'ok' ? [{ x: i, y: 0, z: 0 }] : [],
      collectedEnd: s.status === 'ok' ? `201${6 + i}-03-01` : null,
      tiles: [`t${i}`],
    }))
  })
  measure.mockImplementation((pts: any[]) => {
    const idx = pts[0].x as number
    return steps[idx]?.roof ? (idx === 0 ? ROOF_A : ROOF_B) : null
  })
}

const ok = (roof: boolean): Step => ({ status: 'ok', roof })
const bad = (status: 'not_ingested' | 'no_coverage'): Step => ({ status, roof: false })

const anchors: Array<[string, LatLng | null | undefined]> = [
  ['no anchor', null],
  ['undefined anchor', undefined],
  ['anchor 3 m', offsetNorth(3)],
  ['anchor 20 m', offsetNorth(20)],
  ['anchor 60 m', offsetNorth(60)],
]
const sequences: Array<[string, Step[]]> = [
  ['pin1 roof', [ok(true), ok(true)]],
  ['pin1 ok no roof, pin2 roof', [ok(false), ok(true)]],
  ['pin1 ok no roof, pin2 ok no roof', [ok(false), ok(false)]],
  ['pin1 ok no roof, pin2 not_ingested', [ok(false), bad('not_ingested')]],
  ['pin1 not_ingested', [bad('not_ingested'), ok(true)]],
  ['pin1 no_coverage', [bad('no_coverage'), ok(true)]],
]

describe('detect-roof lidar pin loop: main vs measureLidarRoofNear', () => {
  for (const [aName, anchor] of anchors) {
    for (const [sName, steps] of sequences) {
      it(`${aName} / ${sName}`, async () => {
        arrange(steps)
        const before = await oldLoop({}, REQ, anchor)
        const oldCalls = load.mock.calls.map((c) => [c[1], c[2]])
        arrange(steps)
        const after = await newLoop({}, REQ, anchor)
        const newCalls = load.mock.calls.map((c) => [c[1], c[2]])
        expect(after).toEqual(before)
        expect(newCalls).toEqual(oldCalls)
      })
    }
  }

  it('errors from loadBuildingPointsNear propagate (route catch → Solar) on both', async () => {
    load.mockReset()
    load.mockRejectedValueOnce(new Error('storage down'))
    await expect(oldLoop({}, REQ, null)).rejects.toThrow('storage down')
    load.mockRejectedValueOnce(new Error('storage down'))
    await expect(newLoop({}, REQ, null)).rejects.toThrow('storage down')
  })

  it('a throwing nearbyStructures must not turn a lidar roof into a Solar fallback', async () => {
    arrange([ok(true)])
    nearby.mockImplementationOnce(() => { throw new Error('boom') })
    const after = await newLoop({}, REQ, null).catch(() => ({ usesLidar: false }))
    expect(after.usesLidar).toBe(true)
  })

  // Anchor rule boundary: old used R = 6,371,000 m. Find a distance that sits between the
  // two radii's readings of 40 m and confirm both sides agree on including the anchor.
  it.each([4.99995, 5.00003, 39.99975, 39.99997, 39.99999, 40.00003])('anchor boundary %p m agrees', async (m) => {
    const anchor = offsetNorth(m)
    arrange([ok(false), ok(true)])
    const before = await oldLoop({}, REQ, anchor)
    arrange([ok(false), ok(true)])
    const after = await newLoop({}, REQ, anchor)
    expect(after).toEqual(before)
  })
})
