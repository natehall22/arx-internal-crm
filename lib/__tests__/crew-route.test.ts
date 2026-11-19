/** @jest-environment node */
/** Stop order for a crew's day: ONE batched write of per-visit numbers, finished stops first, nothing touches the plans. */
const loadVisits = jest.fn()
jest.mock('@/lib/service-plans-db', () => ({ loadVisits: (...a: unknown[]) => loadVisits(...a) }))
jest.mock('@/lib/org-brand', () => ({ getOrgBrand: async () => ({ address: '1 Yard Rd\nTown, ST 00000' }) }))
const geocode = jest.fn(async () => ({ lat: 35, lng: -81 }))
jest.mock('@/lib/lead-map-pin', () => ({ geocodeAddressToLatLng: (...a: unknown[]) => geocode(...(a as [])) }))
import { orderCrewDay } from '@/lib/crew-route'

const rpc = jest.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: 3 as number | null, error: null as unknown }))
const admin = { rpc: (...a: [string, Record<string, unknown>]) => rpc(...a) }
const v = (id: string, planId: string, lng: number, over: Record<string, unknown> = {}) => ({ id, planId, lat: 35, lng, status: 'scheduled', routePosition: null, ...over })
const run = (mode: 'best' | 'set', order?: string[]) => orderCrewDay(admin as never, 'org', { subId: 'crew', day: '2026-11-20', mode, order })

beforeEach(() => {
  loadVisits.mockReset()
  rpc.mockClear()
})

test('best order: nearest stop first from the office, the whole day in one call', async () => {
  loadVisits.mockResolvedValue([v('far', 'pf', -80.5), v('near', 'pn', -80.9), v('mid', 'pm', -80.7)])
  const r = await run('best')
  expect(r).toMatchObject({ ok: true, order: ['near', 'mid', 'far'], startKnown: true, changedStops: 3 })
  if (r.ok) expect(r.afterMiles).toBeLessThan(r.beforeMiles)
  expect(rpc).toHaveBeenCalledTimes(1)
  expect(rpc).toHaveBeenCalledWith('set_visit_stop_order', { p_org_id: 'org', p_ids: ['near', 'mid', 'far'], p_start: 1 })
})

test('finished stops keep the top of the list; two visits of one plan get their own numbers', async () => {
  loadVisits.mockResolvedValue([v('done', 'pd', -80.9, { status: 'completed', routePosition: 2 }), v('a', 'p1', -80.6), v('b', 'p1', -80.6), v('c', 'p2', -80.8)])
  const r = await run('set', ['c', 'a', 'b'])
  expect(r.ok).toBe(true)
  expect(rpc.mock.calls[0][1].p_ids).toEqual(['done', 'c', 'a', 'b'])
})

test('a manual order must be exactly the stops still there (stale list = 409, nothing written)', async () => {
  loadVisits.mockResolvedValue([v('a', 'p1', -80.6), v('b', 'p2', -80.8)])
  expect(await run('set', ['a'])).toMatchObject({ ok: false, status: 409 })
  expect(await run('set', ['a', 'zzz'])).toMatchObject({ ok: false, status: 409 })
  expect(await run('set', ['a', 'a'])).toMatchObject({ ok: false, status: 409 })
  expect(rpc).not.toHaveBeenCalled()
})

test('under two stops left: nothing to order; a failed save is reported, not hidden', async () => {
  loadVisits.mockResolvedValue([v('a', 'p1', -80.6)])
  expect(await run('best')).toMatchObject({ ok: false, status: 400 })
  loadVisits.mockResolvedValue([v('a', 'p1', -80.6), v('b', 'p2', -80.8)])
  rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
  jest.spyOn(console, 'error').mockImplementation(() => {})
  expect(await run('set', ['b', 'a'])).toMatchObject({ ok: false, status: 500 })
})
