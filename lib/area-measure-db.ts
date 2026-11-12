/**
 * Measure yard — server side: who may measure for what, the company settings, and the ONE writer of `area_measurements`.
 * (Pure rules: lib/area-measure.ts. Migration 202611230020, not applied until an owner does it.)
 *
 * Access: a measurement hangs off a customer, a property, a deal (opportunity) or a lead. A person may READ / WRITE it when
 * they may open that record (the same rules as the Customer File: `resolveCustomerAccess`, `canOpenDeal`), and may WRITE only
 * when they are not a field role (setters, canvassers, inside sales). A reference that is not this company's is "not found".
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  AREA_MEASURE_SETTINGS_KEY,
  computeTotals,
  resolveAreaMeasureSettings,
  type AreaMeasureSettings,
  type AreaShape,
  type AreaTotals,
} from '@/lib/area-measure'
import { resolveCustomerAccess } from '@/lib/customer-file/customer-access'
import { mergeOrgSettings } from '@/lib/org-settings'
import { orgDb } from '@/lib/supabase/org-db'
import { canOpenDeal } from '@/lib/threads/api'
import { loadDeal } from '@/lib/threads/get-thread'
import { isFieldRole, type ThreadViewer } from '@/lib/threads/visibility'

export type AreaMeasureRefs = {
  customerId?: string | null
  propertyId?: string | null
  opportunityId?: string | null
  leadId?: string | null
}

/** What a measurement is attached to, after every reference was checked against the viewer's company and permissions. */
export type AreaMeasureTarget = {
  customerId: string | null
  propertyId: string | null
  opportunityId: string | null
  leadId: string | null
  /** Where the map opens when the person typed nothing: property, deal, lead, then customer address. */
  address: string | null
  lat: number | null
  lng: number | null
  canWrite: boolean
}

export type TargetResult = { ok: true; target: AreaMeasureTarget } | { ok: false; status: 400 | 403 | 404; error: string }

const NOT_FOUND = { ok: false, status: 404, error: 'Not found' } as const

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64

/** Pure: may this viewer save a measurement at all (not a field role)? */
export function canWriteAreaMeasure(viewer: ThreadViewer): boolean {
  return !isFieldRole(viewer)
}

const toNum = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/**
 * Check every reference and say what the viewer may do with it. Unknown / other-company / not-yours = 404 (existence is
 * not leaked). Nothing given = 400. The deal's own customer and lead fill in what was not passed; a passed id that
 * disagrees with the deal is a 400.
 */
export async function resolveAreaMeasureTarget(admin: SupabaseClient, viewer: ThreadViewer, refs: AreaMeasureRefs): Promise<TargetResult> {
  const ids = [refs.customerId, refs.propertyId, refs.opportunityId, refs.leadId]
  if (ids.some((v) => v !== undefined && v !== null && v !== '' && !isId(v))) return { ok: false, status: 400, error: 'Bad reference' }
  let customerId = refs.customerId || null
  let propertyId = refs.propertyId || null
  let opportunityId = refs.opportunityId || null
  let leadId = refs.leadId || null
  if (!customerId && !propertyId && !opportunityId && !leadId) return { ok: false, status: 400, error: 'Open the measure tool from a customer, deal or lead to save' }
  const db = orgDb(admin, viewer.orgId)
  let address: string | null = null
  let lat: number | null = null
  let lng: number | null = null
  let canRead = true
  let dealLeadId: string | null = null

  if (opportunityId) {
    const deal = await loadDeal(admin, viewer.orgId, opportunityId)
    if (!deal || !canOpenDeal(viewer, deal)) return NOT_FOUND
    if (customerId && deal.customer_id && customerId !== deal.customer_id) return { ok: false, status: 400, error: 'That deal belongs to another customer' }
    if (leadId && deal.lead_id && leadId !== deal.lead_id) return { ok: false, status: 400, error: 'That deal belongs to another lead' }
    dealLeadId = deal.lead_id
    customerId = customerId ?? deal.customer_id
    leadId = leadId ?? deal.lead_id
    address = deal.address_text
  }

  if (propertyId) {
    const { data: p } = await db.from('properties').select('id, customer_id, address_text, lat, lng, active').eq('id', propertyId).maybeSingle()
    if (!p) return NOT_FOUND
    if (customerId && p.customer_id !== customerId) return NOT_FOUND
    customerId = customerId ?? (p.customer_id as string)
    // A property's own address and pin beat the deal's (a customer can have many properties).
    address = (p.address_text as string | null) ?? address
    lat = toNum(p.lat)
    lng = toNum(p.lng)
  }

  if (customerId) {
    const access = await resolveCustomerAccess(admin, viewer, customerId)
    if (!access?.read) return NOT_FOUND
    if (!address) {
      const { data: c } = await db.from('customers').select('address_text').eq('id', customerId).maybeSingle()
      address = (c?.address_text as string | null) ?? null
    }
  }

  if (leadId) {
    const { data: lead } = await db.from('leads').select('id, owner_user_id, address_text, lat, lng').eq('id', leadId).maybeSingle()
    if (!lead) return NOT_FOUND
    // A lead is readable by the people who see the whole company, its owner, or anyone who may open the deal it belongs to.
    // Access to a customer does NOT open that customer's other leads: a lead named beside a customer must be the viewer's own.
    const companyWide = viewer.ownerLike || viewer.jobBoard || viewer.managerLike
    const viaDeal = !!opportunityId && dealLeadId === leadId
    if (!companyWide && lead.owner_user_id !== viewer.userId && !viaDeal) canRead = false
    if (!address) address = (lead.address_text as string | null) ?? null
    if (lat === null) lat = toNum(lead.lat)
    if (lng === null) lng = toNum(lead.lng)
  }
  if (!canRead) return NOT_FOUND

  return { ok: true, target: { customerId, propertyId, opportunityId, leadId, address, lat, lng, canWrite: canWriteAreaMeasure(viewer) } }
}

// ---- settings ----
export async function loadAreaMeasureSettings(admin: SupabaseClient, orgId: string): Promise<AreaMeasureSettings> {
  const { data } = await admin.from('orgs').select(`stored:settings->${AREA_MEASURE_SETTINGS_KEY}`).eq('id', orgId).maybeSingle()
  return resolveAreaMeasureSettings((data as { stored?: unknown } | null)?.stored)
}

/** The ONE writer of the company's materials settings (owners only — the route checks): a per-key merge at path ['areaMeasure']. */
export async function saveAreaMeasureSettings(admin: SupabaseClient, orgId: string, patch: Partial<AreaMeasureSettings>): Promise<{ error: string | null }> {
  return mergeOrgSettings(admin, orgId, { ...patch }, { path: [AREA_MEASURE_SETTINGS_KEY] })
}

// ---- measurements ----
export type AreaMeasurementRow = {
  id: string
  customer_id: string | null
  property_id: string | null
  opportunity_id: string | null
  lead_id: string | null
  address_text: string | null
  lat: number | null
  lng: number | null
  shapes: AreaShape[]
  lawn_sqft: number
  bed_sqft: number
  cutout_sqft: number
  line_feet: number
  totals: AreaTotals | Record<string, never>
  settings: Partial<AreaMeasureSettings>
  created_by: string | null
  created_at: string
}

const COLUMNS = 'id, customer_id, property_id, opportunity_id, lead_id, address_text, lat, lng, shapes, lawn_sqft, bed_sqft, cutout_sqft, line_feet, totals, settings, created_by, created_at'

function asRow(r: Record<string, unknown>): AreaMeasurementRow {
  const n = (v: unknown) => toNum(v) ?? 0
  return {
    ...(r as unknown as AreaMeasurementRow),
    lat: toNum(r.lat),
    lng: toNum(r.lng),
    lawn_sqft: n(r.lawn_sqft),
    bed_sqft: n(r.bed_sqft),
    cutout_sqft: n(r.cutout_sqft),
    line_feet: n(r.line_feet),
  }
}

/** Is the "table not there yet" error (migration not applied)? Then screens show nothing and the save says so. */
export function isAreaMeasureNotReady(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const message = error.message ?? ''
  return error.code === '42P01' || error.code === 'PGRST205' || (/area_measurements/.test(message) && /does not exist|schema cache/.test(message))
}

export const AREA_MEASURE_NOT_READY = 'Measure yard needs a database update first. Nothing was saved.'

/**
 * Every measurement of a customer / property / deal / lead, newest first (history included). Pass the refs that
 * `resolveAreaMeasureTarget` returned. A customer's list includes measurements saved against its deals, leads and properties.
 */
export async function loadAreaMeasurements(
  admin: SupabaseClient,
  orgId: string,
  where: { customerId?: string | null; propertyId?: string | null; opportunityId?: string | null; leadId?: string | null },
  limit = 50
): Promise<{ ready: boolean; rows: AreaMeasurementRow[] }> {
  const db = orgDb(admin, orgId)
  let q = db.from('area_measurements').select(COLUMNS).order('created_at', { ascending: false }).limit(Math.min(Math.max(limit, 1), 200))
  if (where.propertyId) q = q.eq('property_id', where.propertyId)
  else if (where.customerId) q = q.eq('customer_id', where.customerId)
  else if (where.opportunityId) q = q.eq('opportunity_id', where.opportunityId)
  else if (where.leadId) q = q.eq('lead_id', where.leadId)
  else return { ready: true, rows: [] }
  const { data, error } = await q
  if (error) {
    if (isAreaMeasureNotReady(error)) return { ready: false, rows: [] }
    throw new Error(error.message)
  }
  return { ready: true, rows: ((data ?? []) as Array<Record<string, unknown>>).map(asRow) }
}

export type SaveInput = {
  target: AreaMeasureTarget
  shapes: AreaShape[]
  address: string | null
  lat: number | null
  lng: number | null
  createdBy: string
}

/**
 * Save a measurement as a NEW row (older ones are kept). Totals are recomputed here from the shapes with the company's
 * own settings — never taken from the request.
 */
export async function saveAreaMeasurement(
  admin: SupabaseClient,
  orgId: string,
  input: SaveInput
): Promise<{ ok: true; row: AreaMeasurementRow } | { ok: false; status: 500 | 503; error: string }> {
  const settings = await loadAreaMeasureSettings(admin, orgId)
  const totals = computeTotals(input.shapes, settings)
  const t = input.target
  const { data, error } = await orgDb(admin, orgId)
    .from('area_measurements')
    .insert({
      customer_id: t.customerId,
      property_id: t.propertyId,
      opportunity_id: t.opportunityId,
      lead_id: t.leadId,
      address_text: input.address ? input.address.slice(0, 500) : null,
      lat: input.lat,
      lng: input.lng,
      shapes: input.shapes,
      lawn_sqft: totals.lawnSqft,
      bed_sqft: totals.bedSqft,
      cutout_sqft: totals.cutoutSqft,
      line_feet: totals.lineFeet,
      totals,
      settings,
      created_by: input.createdBy,
    })
    .select(COLUMNS)
    .single()
  if (error || !data) {
    if (isAreaMeasureNotReady(error)) return { ok: false, status: 503, error: AREA_MEASURE_NOT_READY }
    return { ok: false, status: 500, error: 'Could not save the measurement' }
  }
  return { ok: true, row: asRow(data as Record<string, unknown>) }
}
