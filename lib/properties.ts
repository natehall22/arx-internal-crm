/**
 * Properties — the places a customer owns or manages (one customer has many). Pure and client-safe: types, the one-line
 * address format and input cleaning. Database reads/writes: lib/properties-db.ts. Schema: migration 202611110010.
 *
 * "Same address" is decided ONCE, in SQL (`public.property_address_key`, set by trigger, unique per company + customer);
 * this file never re-implements it — a duplicate is the database's unique violation, reported as a 409.
 */

export type Property = {
  id: string
  customer_id: string
  label: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  zip: string | null
  address_text: string
  lat: number | null
  lng: number | null
  notes: string | null
  /** Gate codes, dogs, parking. `null` for viewers who may not see it (field roles) — see `PropertyView.access_hidden`. */
  access_notes: string | null
  active: boolean
  source: 'manual' | 'auto' | 'backfill' | 'import'
  custom_fields: Record<string, unknown>
  created_at: string
  updated_at: string
}

export const PROPERTY_COLUMNS =
  'id, customer_id, label, address_line1, address_line2, city, state, zip, address_text, lat, lng, notes, access_notes, active, source, custom_fields, created_at, updated_at'

export const PROPERTY_LIMITS = { label: 80, line: 200, city: 100, state: 50, zip: 20, notes: 4000, access: 2000 } as const

/** What a person types. Every field optional on edit; line1 (or a full address_text) required on create. */
export type PropertyInput = {
  label?: string | null
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  lat?: number | null
  lng?: number | null
  notes?: string | null
  access_notes?: string | null
  active?: boolean
}

type AddressParts = Pick<Property, 'address_line1' | 'address_line2' | 'city' | 'state' | 'zip'>

/** "12 Oak St, Suite 4, Concord, NC 28025" — parts that are blank are skipped. Empty string when every part is blank. */
export function formatPropertyAddress(p: Partial<AddressParts>): string {
  const t = (v: string | null | undefined) => (typeof v === 'string' ? v.trim() : '')
  const stateZip = [t(p.state), t(p.zip)].filter(Boolean).join(' ')
  return [t(p.address_line1), t(p.address_line2), t(p.city), stateZip].filter(Boolean).join(', ')
}

/** Short name for pickers and headings: "Main office · 12 Oak St, Concord" or just the address. */
export function propertyDisplayName(p: Pick<Property, 'label' | 'address_text'>): string {
  const label = p.label?.trim()
  return label ? `${label} · ${p.address_text}` : p.address_text
}

export type CleanResult<T> = { ok: true; value: T } | { ok: false; error: string }

function cleanText(v: unknown, max: number, name: string): CleanResult<string | null> | null {
  if (v === undefined) return null
  if (v === null) return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false, error: `${name} must be text` }
  const s = v.replace(/\s+$/g, '').replace(/^\s+/g, '')
  if (s.length > max) return { ok: false, error: `${name} can be at most ${max} characters` }
  return { ok: true, value: s === '' ? null : s }
}

function cleanCoord(v: unknown, min: number, max: number, name: string): CleanResult<number | null> | null {
  if (v === undefined) return null
  if (v === null || v === '') return { ok: true, value: null }
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n < min || n > max) return { ok: false, error: `${name} is not a valid coordinate` }
  return { ok: true, value: n }
}

/**
 * Validate a create/edit body into a column patch. Only keys present in `body` are returned (edit = partial).
 * `address_text` is always recomputed from the parts when any part changes; on create the parts must give an address.
 * `existing` = the current row on edit (so a partial edit of `city` still rebuilds the full line). A backfilled row has only
 * `address_text` (no parts): its edit form starts line 1 with that text and sends every part, so the line is rebuilt whole.
 */
export function cleanPropertyInput(
  body: unknown,
  mode: 'create' | 'edit',
  existing?: Partial<AddressParts>
): CleanResult<Record<string, unknown>> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Nothing to save' }
  const b = body as Record<string, unknown>
  const L = PROPERTY_LIMITS
  const patch: Record<string, unknown> = {}
  const texts: Array<[keyof PropertyInput, number, string]> = [
    ['label', L.label, 'Name'],
    ['address_line1', L.line, 'Street address'],
    ['address_line2', L.line, 'Address line 2'],
    ['city', L.city, 'City'],
    ['state', L.state, 'State'],
    ['zip', L.zip, 'ZIP'],
    ['notes', L.notes, 'Notes'],
    ['access_notes', L.access, 'Gate / access notes'],
  ]
  for (const [key, max, name] of texts) {
    const r = cleanText(b[key], max, name)
    if (!r) continue
    if (!r.ok) return r
    patch[key] = r.value
  }
  const lat = cleanCoord(b.lat, -90, 90, 'Latitude')
  if (lat) {
    if (!lat.ok) return lat
    patch.lat = lat.value
  }
  const lng = cleanCoord(b.lng, -180, 180, 'Longitude')
  if (lng) {
    if (!lng.ok) return lng
    patch.lng = lng.value
  }
  if (b.active !== undefined) {
    if (typeof b.active !== 'boolean') return { ok: false, error: 'active must be true or false' }
    if (mode === 'create' && b.active === false) return { ok: false, error: 'A new property starts on' }
    patch.active = b.active
  }

  const partKeys = ['address_line1', 'address_line2', 'city', 'state', 'zip'] as const
  const partsChanged = partKeys.some((k) => k in patch)
  if (mode === 'create' || partsChanged) {
    const merged: Partial<AddressParts> = {}
    for (const k of partKeys) merged[k] = (k in patch ? patch[k] : existing?.[k]) as string | null | undefined
    const line = formatPropertyAddress(merged)
    if (!merged.address_line1 || !line) return { ok: false, error: 'Enter the street address' }
    if (line.length > 500) return { ok: false, error: 'That address is too long' }
    patch.address_text = line
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: 'Nothing to save' }
  return { ok: true, value: patch }
}

/** Postgres / PostgREST "that table or column is not there yet" (migration 202611110010 not applied). */
export function isPropertiesNotReadyError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const msg = String(error.message ?? '')
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    (/(properties|property_id|custom_fields|custom_field_definitions)/.test(msg) && /does not exist|could not find/i.test(msg))
  )
}

export const PROPERTIES_NOT_READY = 'Properties turn on once the database update for them is applied.'

/**
 * How the Customer File shows a customer's properties, so a company that never uses them sees nothing new:
 *  'full' — a Properties card: the customer has 2+ properties, a property carries anything beyond its address (name,
 *           notes, access notes, field values), a property is turned off, or the company has property fields;
 *  'link' — only a small "Add another property" link, for people who may edit (the everyday one-home customer);
 *  'none' — nothing (not set up yet, or a viewer who may not edit and there is nothing beyond the address to show).
 */
export function propertiesDisplayMode(input: { ready: boolean; properties: Property[]; hasPropertyFields: boolean; canEdit: boolean }): 'full' | 'link' | 'none' {
  if (!input.ready) return 'none'
  const ps = input.properties
  const rich = (p: Property) =>
    !!(p.label || p.notes || p.access_notes) || !p.active || Object.values(p.custom_fields ?? {}).some((v) => v !== null && v !== '')
  if (ps.length >= 2 || ps.some(rich) || input.hasPropertyFields) return 'full'
  return input.canEdit ? 'link' : 'none'
}

/** Google Maps search link for a property (coordinates when known, else the address). */
export function propertyMapHref(p: Pick<Property, 'lat' | 'lng' | 'address_text'>): string {
  const q = p.lat !== null && p.lng !== null ? `${p.lat},${p.lng}` : p.address_text
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}
