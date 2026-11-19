/**
 * Stop order for ONE crew's day (Visits board → "Best order", drag / up-down reorder). The stop number is `service_plans.route_position`
 * (see lib/service-plans-db.ts: the visits board, the crew's phone page and the printed sheet all sort by it), so this only decides the
 * order and then writes through the existing plan writer, `updateServicePlan` — no second place stores a stop number.
 *
 * A stop number belongs to the PLAN, not to one day: a plan that visits this crew every Tuesday keeps its number on every Tuesday.
 * Numbering starts after the stops already done that day, so finished visits stay above the ones still to do.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { geocodeAddressToLatLng } from '@/lib/lead-map-pin'
import { getOrgBrand } from '@/lib/org-brand'
import { bestOrder, tripMiles, type RoutePoint, type RouteStop } from '@/lib/route-order'
import { loadVisits, updateServicePlan, type VisitView } from '@/lib/service-plans-db'

export type CrewRouteResult =
  | { ok: true; beforeMiles: number; afterMiles: number; startKnown: boolean; withoutLocation: number; order: string[]; changedPlans: number }
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
  userId: string,
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

  // Number the stops: after whatever is already done that day; one number per plan (two visits of a plan share it).
  const base = visits.filter((v) => v.status !== 'scheduled').reduce((m, v) => Math.max(m, v.routePosition ?? 0), 0)
  const numberOf = new Map<string, number>()
  for (const s of next) {
    const planId = (s.data as VisitView).planId
    if (!numberOf.has(planId)) numberOf.set(planId, base + numberOf.size + 1)
  }
  if (numberOf.size > 999 - base) return { ok: false, status: 400, error: 'Too many stops to number' }
  const currentNumber = new Map(open.map((v) => [v.planId, v.routePosition]))
  let changedPlans = 0
  for (const [planId, n] of Array.from(numberOf)) {
    if (currentNumber.get(planId) === n) continue
    const saved = await updateServicePlan(admin, orgId, userId, planId, { route_position: n }, null)
    if (!('ok' in saved) || !saved.ok) {
      console.error('[crew-route] could not number a stop', planId, saved)
      return { ok: false, status: 500, error: 'Could not save the order. Reload and check it.' }
    }
    changedPlans += 1
  }
  return {
    ok: true,
    beforeMiles: tripMiles(start, current),
    afterMiles: tripMiles(start, next),
    startKnown: !!start,
    withoutLocation: open.filter((v) => v.lat == null || v.lng == null).length,
    order: next.map((s) => s.id),
    changedPlans,
  }
}
