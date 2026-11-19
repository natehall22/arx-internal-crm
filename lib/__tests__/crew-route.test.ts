/** @jest-environment node */
/** Stop order for a crew's day: numbers go through the plan writer, one per plan, after the finished stops. */
const loadVisits = jest.fn()
const updateServicePlan = jest.fn(async () => ({ ok: true }))
jest.mock('@/lib/service-plans-db', () => ({ loadVisits: (...a: unknown[]) => loadVisits(...a), updateServicePlan: (...a: unknown[]) => updateServicePlan(...(a as [])) }))
jest.mock('@/lib/org-brand', () => ({ getOrgBrand: async () => ({ address: '1 Yard Rd\nTown, ST 00000' }) }))
const geocode = jest.fn(async () => ({ lat: 35, lng: -81 }))
jest.mock('@/lib/lead-map-pin', () => ({ geocodeAddressToLatLng: (...a: unknown[]) => geocode(...(a as [])) }))
import { orderCrewDay } from '@/lib/crew-route'

const v = (id: string, planId: string, lng: number, over: Record<string, unknown> = {}) => ({ id, planId, lat: 35, lng, status: 'scheduled', routePosition: null, ...over })
const run = (mode: 'best' | 'set', order?: string[]) => orderCrewDay({} as never, 'org', 'user', { subId: 'crew', day: '2026-11-20', mode, order })

beforeEach(() => {
  loadVisits.mockReset()
  updateServicePlan.mockClear()
})

test('best order: nearest stop first from the office, numbered through the plan writer', async () => {
  loadVisits.mockResolvedValue([v('far', 'pf', -80.5), v('near', 'pn', -80.9), v('mid', 'pm', -80.7)])
  const r = await run('best')
  expect(r).toMatchObject({ ok: true, order: ['near', 'mid', 'far'], startKnown: true })
  if (r.ok) expect(r.afterMiles).toBeLessThan(r.beforeMiles)
  expect(updateServicePlan.mock.calls.map((c) => [(c as unknown[])[3], ((c as unknown[])[4] as { route_position: number }).route_position])).toEqual([['pn', 1], ['pm', 2], ['pf', 3]])
})

test('numbers start after the stops already done, and two visits of one plan share a number', async () => {
  loadVisits.mockResolvedValue([v('done', 'pd', -80.9, { status: 'completed', routePosition: 2 }), v('a', 'p1', -80.6), v('b', 'p1', -80.6), v('c', 'p2', -80.8)])
  const r = await run('set', ['c', 'a', 'b'])
  expect(r.ok).toBe(true)
  expect(updateServicePlan.mock.calls.map((c) => [(c as unknown[])[3], ((c as unknown[])[4] as { route_position: number }).route_position])).toEqual([['p2', 3], ['p1', 4]])
})

test('a plan that already has its number is not saved again', async () => {
  loadVisits.mockResolvedValue([v('a', 'p1', -80.6, { routePosition: 1 }), v('b', 'p2', -80.8, { routePosition: 2 })])
  await run('set', ['a', 'b'])
  expect(updateServicePlan).not.toHaveBeenCalled()
})

test('a manual order must be exactly the stops still there', async () => {
  loadVisits.mockResolvedValue([v('a', 'p1', -80.6), v('b', 'p2', -80.8)])
  expect(await run('set', ['a'])).toMatchObject({ ok: false, status: 409 })
  expect(await run('set', ['a', 'zzz'])).toMatchObject({ ok: false, status: 409 })
  expect(await run('set', ['a', 'a'])).toMatchObject({ ok: false, status: 409 })
  expect(updateServicePlan).not.toHaveBeenCalled()
})

test('under two stops left: nothing to order; a failed save is reported, not hidden', async () => {
  loadVisits.mockResolvedValue([v('a', 'p1', -80.6)])
  expect(await run('best')).toMatchObject({ ok: false, status: 400 })
  loadVisits.mockResolvedValue([v('a', 'p1', -80.6), v('b', 'p2', -80.8)])
  updateServicePlan.mockResolvedValueOnce({ ok: false } as never)
  jest.spyOn(console, 'error').mockImplementation(() => {})
  expect(await run('set', ['b', 'a'])).toMatchObject({ ok: false, status: 500 })
})
