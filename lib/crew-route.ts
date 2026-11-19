/**
 * Stop order for ONE crew's day (Visits board → "Best order", drag / up-down reorder). The stop number is `work_orders.stop_order` on the
 * visit itself (migration 202611300193); a visit without one falls back to its plan's `service_plans.route_position`, which stays the
 * default for newly generated visits. The board, the crew's phone page and the printed sheet all sort by the same resolved number
 * (lib/service-plans-db.ts `viewsFor`). The whole day is written by ONE batched statement (`set_visit_stop_order`) — no plan edits, no
 * history rows — and a visit moved to another day or crew loses its number (`visitPatch`).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { geocodeAddressToLatLng } from '@/lib/lead-map-pin'
import { getOrgBrand } from '@/lib/org-brand'
import { bestOrder, tripMiles, type RoutePoint, type RouteStop } from '@/lib/route-order'
import { loadVisits, type VisitView } from '@/lib/service-plans-db'

export type CrewRouteResult =
  | { ok: true; beforeMiles: number; afterMiles: number; startKnown: boolean; withoutLocation: number; order: string[]; changedStops: number }
  | { ok: false; status: number; error: string }

// The company address never changes within a server's life in practice; one lookup per address, not one per tap.
const startCache = new Map<string, RoutePoint | null>()

/** The company's address (the org row) as a map point; null when it has none or cannot be found (the order then starts from the best stop). */
export async function loadRouteStart(admin: SupabaseClient, orgId: string): Promise<RoutePoint | null> {
  const address = (await getOrgBrand(admin, orgId)).address.replace(/\s*\n+\s*/g, ', ').trim()
  if (!address) return null
  const key = `${orgId}|${address}`
  if (startCache.has(key)) return startCache.get(key) ?? null
  const found = await geocodeAddressToLatLng(address)
  // A failed lookup is not remembered (a missing key or a hiccup should not stick).
  if (found) startCache.set(key, found)
  return found
}

type Stop = RouteStop<VisitView>

export async function orderCrewDay(
  admin: SupabaseClient,
  orgId: string,
  o: { subId: string; day: string; mode: 'best' | 'set'; order?: string[] }
): Promise<CrewRouteResult> {
  const visits = await loadVisits(admin, orgId, { from: o.day, to: o.day, subId: o.subId, accessNotes: false })
  const open = visits.filter((v) => v.status === 'scheduled')
  if (open.length < 2) return { ok: false, status: 400, error: 'Nothing to order: this crew has fewer than two stops left that day' }
  const start = await loadRouteStart(admin, orgId)
  const asStop = (v: VisitView): Stop => ({ id: v.id, lat: v.lat, lng: v.lng, data: v })
  const current = open.map(asStop)
  let next: Stop[]
  if (o.mode === 'best') {
    next = bestOrder(start, current)
  } else {
    const wanted = o.order ?? []
    const byId = new Map(current.map((s) => [s.id, s]))
    // The list the person arranged must be exactly the stops still there (someone may have marked one done meanwhile).
    if (wanted.length !== current.length || new Set(wanted).size !== wanted.length || wanted.some((id) => !byId.has(id))) {
      return { ok: false, status: 409, error: 'This day changed. Reload and try again.' }
    }
    next = wanted.map((id) => byId.get(id) as Stop)
  }

  // Number the whole day in ONE statement: stops already done keep their place at the top (in the order the board shows them),
  // then the stops still to do in the new order. The number lives on each visit, so another day of the same plan is untouched.
  const done = visits.filter((v) => v.status !== 'scheduled')
  const ids = [...done.map((v) => v.id), ...next.map((s) => s.id)]
  if (ids.length > 999) return { ok: false, status: 400, error: 'Too many stops to number' }
  const { data: written, error } = await admin.rpc('set_visit_stop_order', { p_org_id: orgId, p_ids: ids, p_start: 1 })
  if (error) {
    console.error('[crew-route] could not number the day', error)
    return { ok: false, status: 500, error: 'Could not save the order. Reload and check it.' }
  }
  const changedStops = typeof written === 'number' ? written : 0
  return {
    ok: true,
    beforeMiles: tripMiles(start, current),
    afterMiles: tripMiles(start, next),
    startKnown: !!start,
    withoutLocation: open.filter((v) => v.lat == null || v.lng == null).length,
    order: next.map((s) => s.id),
    changedStops,
  }
}
