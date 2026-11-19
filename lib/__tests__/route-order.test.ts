import { bestOrder, directionsHref, tripMiles, type RouteStop } from '@/lib/route-order'

// Stops on a line going east, given out of order, plus one with no coordinates.
const at = (id: string, lng: number): RouteStop => ({ id, lat: 35, lng })
const zigzag = [at('c', -80.6), at('a', -80.9), at('d', -80.5), at('b', -80.8), { id: 'nocoords', lat: null, lng: null }]

describe('bestOrder', () => {
  test('from a start in the west it drives west to east, and the stop with no coordinates stays last', () => {
    const out = bestOrder({ lat: 35, lng: -81 }, zigzag).map((s) => s.id)
    expect(out).toEqual(['a', 'b', 'c', 'd', 'nocoords'])
  })
  test('with no start it still finds the short trip (either end first)', () => {
    const out = bestOrder(null, zigzag).map((s) => s.id).filter((x) => x !== 'nocoords')
    expect(['abcd', 'dcba']).toContain(out.join(''))
  })
  test('never longer than the order it was given, and the same answer every time', () => {
    const start = { lat: 35, lng: -81 }
    const mess = Array.from({ length: 14 }, (_, i) => ({ id: `s${i}`, lat: 35 + ((i * 7) % 11) / 50, lng: -80.5 - ((i * 5) % 13) / 40 }))
    const out = bestOrder(start, mess)
    expect(tripMiles(start, out)).toBeLessThanOrEqual(tripMiles(start, mess) + 1e-9)
    expect(bestOrder(start, mess).map((s) => s.id)).toEqual(out.map((s) => s.id))
    expect(out).toHaveLength(mess.length)
  })
  test('fewer than two placed stops: nothing to order', () => {
    expect(bestOrder(null, [at('x', -80), { id: 'y', lat: null, lng: null }]).map((s) => s.id)).toEqual(['x', 'y'])
    expect(bestOrder(null, [])).toEqual([])
  })
})

describe('tripMiles', () => {
  test('about 69 miles per degree of latitude; stops without coordinates add nothing', () => {
    const m = tripMiles({ lat: 35, lng: -80 }, [{ id: 'a', lat: 36, lng: -80 }, { id: 'n', lat: null, lng: null }])
    expect(m).toBeGreaterThan(68.5)
    expect(m).toBeLessThan(69.5)
  })
})

describe('directionsHref', () => {
  test('last stop is the destination, the rest are waypoints, in order', () => {
    const href = directionsHref([{ lat: 35.1, lng: -80.1, address: null }, { lat: null, lng: null, address: '12 Oak St, Concord' }, { lat: 35.3, lng: -80.3, address: null }])!
    expect(href).toContain('destination=35.3,-80.3')
    expect(href).toContain('waypoints=35.1,-80.1|12+Oak+St')
    expect(directionsHref([])).toBeNull()
  })
})
