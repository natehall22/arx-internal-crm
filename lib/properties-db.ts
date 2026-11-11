/**
 * Properties — database side (server only, service-role client through orgDb). The ONE app writer of `properties`
 * (Customer File → Properties via /api/customers/[id]/properties and /api/properties/[id]); the only other writers are
 * the SQL insert fill (`ensure_property`, migration 202611110010) and the backfill data fix. Who may call: the routes
 * check lib/customer-file/customer-access.ts first.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  PROPERTIES_NOT_READY,
  PROPERTY_COLUMNS,
  cleanPropertyInput,
  isPropertiesNotReadyError,
  type Property,
} from '@/lib/properties'
import { orgDb } from '@/lib/supabase/org-db'

export type PropertiesLoad = { ready: boolean; properties: Property[] }

function fromRow(row: Record<string, unknown>, showAccessNotes: boolean): Property {
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
  const cf = row.custom_fields
  return {
    id: String(row.id),
    customer_id: String(row.customer_id),
    label: (row.label as string | null) ?? null,
    address_line1: (row.address_line1 as string | null) ?? null,
    address_line2: (row.address_line2 as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    state: (row.state as string | null) ?? null,
    zip: (row.zip as string | null) ?? null,
    address_text: String(row.address_text ?? ''),
    lat: num(row.lat),
    lng: num(row.lng),
    notes: (row.notes as string | null) ?? null,
    access_notes: showAccessNotes ? ((row.access_notes as string | null) ?? null) : null,
    active: row.active !== false,
    source: (row.source as Property['source']) ?? 'manual',
    custom_fields: cf && typeof cf === 'object' && !Array.isArray(cf) ? (cf as Record<string, unknown>) : {},
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  }
}

/** A customer's properties (active first, then by name/address). `ready: false` until the migration is applied. */
export async function loadCustomerProperties(
  admin: SupabaseClient,
  orgId: string,
  customerId: string,
  opts: { includeInactive?: boolean; accessNotes: boolean }
): Promise<PropertiesLoad> {
  let q = orgDb(admin, orgId).from('properties').select(PROPERTY_COLUMNS).eq('customer_id', customerId)
  if (!opts.includeInactive) q = q.eq('active', true)
  const { data, error } = await q
  if (error) {
    if (!isPropertiesNotReadyError(error)) console.error('[properties] load failed', error)
    return { ready: false, properties: [] }
  }
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => fromRow(r, opts.accessNotes))
  rows.sort((a, b) => Number(b.active) - Number(a.active) || (a.label ?? a.address_text).localeCompare(b.label ?? b.address_text))
  return { ready: true, properties: rows }
}

/** One property of this company (any customer), or null. */
export async function loadProperty(admin: SupabaseClient, orgId: string, propertyId: string, accessNotes: boolean): Promise<Property | null> {
  if (typeof propertyId !== 'string' || !propertyId) return null
  const { data, error } = await orgDb(admin, orgId).from('properties').select(PROPERTY_COLUMNS).eq('id', propertyId).maybeSingle()
  if (error) {
    if (!isPropertiesNotReadyError(error)) console.error('[properties] load one failed', error)
    return null
  }
  return data ? fromRow(data as Record<string, unknown>, accessNotes) : null
}

export type PropertySave = { ok: true; property: Property } | { ok: false; status: number; error: string }

function saveError(error: { code?: string; message?: string }): PropertySave {
  if (error.code === '23505') return { ok: false, status: 409, error: 'This customer already has a property at that address (it may be turned off — turn it back on instead).' }
  if (isPropertiesNotReadyError(error)) return { ok: false, status: 503, error: PROPERTIES_NOT_READY }
  if (error.code === '23514') return { ok: false, status: 400, error: 'Check the address and try again' }
  console.error('[properties] save failed', error)
  return { ok: false, status: 500, error: 'Could not save the property' }
}

export async function createProperty(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  customerId: string,
  body: unknown,
  opts: { accessNotes: boolean }
): Promise<PropertySave> {
  const clean = cleanPropertyInput(body, 'create')
  if (!clean.ok) return { ok: false, status: 400, error: clean.error }
  const values = { ...clean.value }
  // Someone who may not see access notes may not write them either.
  if (!opts.accessNotes) delete values.access_notes
  const { data, error } = await orgDb(admin, orgId)
    .from('properties')
    .insert({ ...values, customer_id: customerId, source: 'manual', active: true, created_by: userId, updated_by: userId })
    .select(PROPERTY_COLUMNS)
    .single()
  if (error) return saveError(error)
  return { ok: true, property: fromRow(data as Record<string, unknown>, opts.accessNotes) }
}

export async function updateProperty(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  existing: Property,
  body: unknown,
  opts: { accessNotes: boolean }
): Promise<PropertySave> {
  const clean = cleanPropertyInput(body, 'edit', existing)
  if (!clean.ok) return { ok: false, status: 400, error: clean.error }
  const values = { ...clean.value }
  if (!opts.accessNotes) delete values.access_notes
  if (Object.keys(values).length === 0) return { ok: false, status: 400, error: 'Nothing to save' }
  const { data, error } = await orgDb(admin, orgId)
    .from('properties')
    .update({ ...values, updated_by: userId })
    .eq('id', existing.id)
    .eq('customer_id', existing.customer_id)
    .select(PROPERTY_COLUMNS)
    .maybeSingle()
  if (error) return saveError(error)
  if (!data) return { ok: false, status: 404, error: 'Not found' }
  return { ok: true, property: fromRow(data as Record<string, unknown>, opts.accessNotes) }
}
