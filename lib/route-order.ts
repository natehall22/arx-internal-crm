/**
 * Best order for a crew's day: nearest neighbour from the start, then 2-opt until no swap shortens the trip. Pure and free (no map
 * service, no API cost): straight-line miles between the stops' saved coordinates, from the company's address when it is known.
 * It is an ESTIMATE of the trip — roads are longer than straight lines — good for comparing one order with another, not for billing.
 * The path is open (it does not come back to the yard). A stop with no coordinates cannot be placed, so it keeps its place at the end.
 */
import { distanceMetersR6371 } from '@/lib/roof-measure-geometry'

export type RoutePoint = { lat: number; lng: number }
export type RouteStop<T = unknown> = { id: string; lat: number | null; lng: number | null; data?: T }

const METERS_PER_MILE = 1609.344

export function milesBetween(a: RoutePoint, b: RoutePoint): number {
  return distanceMetersR6371(a, b) / METERS_PER_MILE
}

type Placed<T = unknown> = RouteStop<T> & RoutePoint
const placed = <T>(s: RouteStop<T>): s is Placed<T> => s.lat != null && s.lng != null && Number.isFinite(s.lat) && Number.isFinite(s.lng)

/** Miles of the trip: start (if any) → each stop with coordinates, in the order given. Stops without coordinates add nothing. */
export function tripMiles<T>(start: RoutePoint | null, stops: Array<RouteStop<T>>): number {
  let total = 0
  let at: RoutePoint | null = start
  for (const s of stops) {
    if (!placed(s)) continue
    if (at) total += milesBetween(at, s)
    at = s
  }
  return total
}

function nearestNeighbour<T>(start: RoutePoint | null, pts: Array<Placed<T>>, first: number): Array<Placed<T>> {
  const left = [...pts]
  const out: Array<Placed<T>> = []
  let at: RoutePoint | null = start
  if (!start) out.push(...left.splice(first, 1))
  if (!start) at = out[0]
  while (left.length) {
    let best = 0
    let bestD = Infinity
    left.forEach((p, i) => {
      const d = at ? milesBetween(at, p) : 0
      if (d < bestD - 1e-12) {
        bestD = d
        best = i
      }
    })
    const [next] = left.splice(best, 1)
    out.push(next)
    at = next
  }
  return out
}

/** 2-opt on an open path: reverse a stretch while that shortens the trip. The start (when given) stays first and fixed. */
function twoOpt<T>(start: RoutePoint | null, order: Array<Placed<T>>): Array<Placed<T>> {
  const o = [...order]
  let improved = true
  let guard = 0
  while (improved && guard++ < 50) {
    improved = false
    for (let i = 0; i < o.length - 1; i++) {
      for (let j = i + 1; j < o.length; j++) {
        const before = i === 0 ? start : o[i - 1]
        const a = o[i]
        const b = o[j]
        const after = j + 1 < o.length ? o[j + 1] : null
        const cur = (before ? milesBetween(before, a) : 0) + (after ? milesBetween(b, after) : 0)
        const swapped = (before ? milesBetween(before, b) : 0) + (after ? milesBetween(a, after) : 0)
        if (swapped < cur - 1e-9) {
          o.splice(i, j - i + 1, ...o.slice(i, j + 1).reverse())
          improved = true
        }
      }
    }
  }
  return o
}

/**
 * The order to drive. With a start point the first stop is whichever is best from it; without one, every stop is tried as the first
 * and the shortest trip wins (a day's stops are few). Same input → same output (ties go to the earlier stop).
 */
export function bestOrder<T>(start: RoutePoint | null, stops: Array<RouteStop<T>>): Array<RouteStop<T>> {
  const pts = stops.filter(placed)
  const rest = stops.filter((s) => !placed(s))
  if (pts.length < 2) return [...pts, ...rest]
  const candidates = start ? [twoOpt(start, nearestNeighbour(start, pts, 0))] : pts.map((_, first) => twoOpt(null, nearestNeighbour(null, pts, first)))
  let best = candidates[0]
  let bestMiles = tripMiles(start, best)
  for (const c of candidates.slice(1)) {
    const m = tripMiles(start, c)
    if (m < bestMiles - 1e-9) {
      best = c
      bestMiles = m
    }
  }
  return [...best, ...rest]
}

/** Google Maps directions through every stop in order (the last is the destination). Up to 9 stops in one link, the app's own limit. */
export const MAPS_MAX_STOPS = 9
export function directionsHref(stops: Array<{ lat: number | null; lng: number | null; address: string | null }>): string | null {
  const where = stops.map((s) => (s.lat != null && s.lng != null ? `${s.lat},${s.lng}` : (s.address ?? '').trim())).filter(Boolean).slice(0, MAPS_MAX_STOPS)
  if (where.length === 0) return null
  const q = new URLSearchParams({ api: '1', travelmode: 'driving', destination: where[where.length - 1] })
  if (where.length > 1) q.set('waypoints', where.slice(0, -1).join('|'))
  return `https://www.google.com/maps/dir/?${q.toString().replace(/%2C/g, ',').replace(/%7C/g, '|')}`
}
