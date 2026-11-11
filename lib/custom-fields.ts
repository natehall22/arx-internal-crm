/**
 * Custom fields per company — pure and client-safe: the types, the definition rules and the ONE value validator.
 * Definitions: `custom_field_definitions` (migration 202611110020). Values: jsonb `custom_fields` on the record itself
 * (customers, properties, production_jobs), keyed by the definition id, so renaming a field never loses data.
 * Database side: lib/custom-fields-db.ts. Owners manage the list at Settings → Custom fields (/admin/custom-fields).
 */
import { formatDate, formatNumber } from '@/lib/format'

export const CUSTOM_FIELD_ENTITIES = ['customer', 'property', 'job'] as const
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number]

export const CUSTOM_FIELD_ENTITY_LABELS: Record<CustomFieldEntity, string> = {
  customer: 'Customers',
  property: 'Properties',
  job: 'Jobs',
}

export const CUSTOM_FIELD_TYPES = ['text', 'number', 'date', 'yes_no', 'dropdown'] as const
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number]

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  yes_no: 'Yes / No',
  dropdown: 'Dropdown',
}

export const CUSTOM_FIELD_LIMITS = { label: 60, option: 60, options: 50, text: 2000, perEntity: 50 } as const

export type CustomFieldDefinition = {
  id: string
  entity: CustomFieldEntity
  label: string
  field_type: CustomFieldType
  options: string[]
  required: boolean
  sort: number
  active: boolean
  /** Field roles (setters, canvassers, inside sales) see this customer / property field. Off by default. */
  visible_to_field: boolean
}

export type CustomFieldValue = string | number | boolean
export type CustomFieldValues = Record<string, CustomFieldValue>

export const CUSTOM_FIELD_DEFINITION_COLUMNS = 'id, entity, label, field_type, options, required, sort, active, visible_to_field'

export function isCustomFieldEntity(v: unknown): v is CustomFieldEntity {
  return typeof v === 'string' && (CUSTOM_FIELD_ENTITIES as readonly string[]).includes(v)
}

export function isCustomFieldType(v: unknown): v is CustomFieldType {
  return typeof v === 'string' && (CUSTOM_FIELD_TYPES as readonly string[]).includes(v)
}

/** A row from the table (options is jsonb; anything odd becomes []). */
export function definitionFromRow(row: Record<string, unknown>): CustomFieldDefinition | null {
  if (!isCustomFieldEntity(row.entity) || !isCustomFieldType(row.field_type) || typeof row.id !== 'string') return null
  const options = Array.isArray(row.options) ? (row.options as unknown[]).filter((o): o is string => typeof o === 'string') : []
  return {
    id: row.id,
    entity: row.entity,
    label: String(row.label ?? ''),
    field_type: row.field_type,
    options,
    required: row.required === true,
    sort: Number(row.sort) || 0,
    active: row.active !== false,
    visible_to_field: row.visible_to_field === true,
  }
}

export function orderedDefinitions(defs: CustomFieldDefinition[]): CustomFieldDefinition[] {
  return [...defs].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
}

export function cleanFieldLabel(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, ' ').trim()
  return s && s.length <= CUSTOM_FIELD_LIMITS.label ? s : null
}

/** Dropdown choices: trimmed, blanks dropped, no case-insensitive duplicates, ≤ 50 of ≤ 60 chars. null = invalid. */
export function cleanFieldOptions(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of v) {
    if (typeof raw !== 'string') return null
    const s = raw.replace(/\s+/g, ' ').trim()
    if (!s) continue
    if (s.length > CUSTOM_FIELD_LIMITS.option) return null
    const k = s.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out.length <= CUSTOM_FIELD_LIMITS.options ? out : null
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A real calendar date "YYYY-MM-DD" (no time, no zone — a date field is a day, never an instant). */
export function isCalendarDate(s: string): boolean {
  const m = DATE_RE.exec(s)
  if (!m) return false
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  return d <= days
}

/** "Empty" for a field: missing, null, or blank text. `false` is a real answer for Yes/No. */
export function isBlankValue(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
}

/**
 * Check one typed value against its field. Returns the value to store (normalized) or an error.
 * Numbers may arrive as text from a form ("1,250.5" is accepted).
 */
export function cleanFieldValue(def: CustomFieldDefinition, v: unknown): { ok: true; value: CustomFieldValue } | { ok: false; error: string } {
  const name = def.label
  switch (def.field_type) {
    case 'text': {
      if (typeof v !== 'string') return { ok: false, error: `${name} must be text` }
      const s = v.trim()
      if (s.length > CUSTOM_FIELD_LIMITS.text) return { ok: false, error: `${name} can be at most ${CUSTOM_FIELD_LIMITS.text} characters` }
      return { ok: true, value: s }
    }
    case 'number': {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/,/g, '').trim()) : NaN
      if (!Number.isFinite(n) || Math.abs(n) > 1e12) return { ok: false, error: `${name} must be a number` }
      return { ok: true, value: n }
    }
    case 'date': {
      if (typeof v !== 'string' || !isCalendarDate(v.trim())) return { ok: false, error: `${name} must be a date` }
      return { ok: true, value: v.trim() }
    }
    case 'yes_no': {
      if (typeof v === 'boolean') return { ok: true, value: v }
      if (v === 'true' || v === 'yes') return { ok: true, value: true }
      if (v === 'false' || v === 'no') return { ok: true, value: false }
      return { ok: false, error: `${name} must be yes or no` }
    }
    case 'dropdown': {
      if (typeof v !== 'string') return { ok: false, error: `Pick a choice for ${name}` }
      const s = v.trim()
      const match = def.options.find((o) => o.toLowerCase() === s.toLowerCase())
      if (!match) return { ok: false, error: `“${s}” is not a choice for ${name}` }
      return { ok: true, value: match }
    }
  }
}

export type ValuePatchResult =
  | { ok: true; set: CustomFieldValues; remove: string[] }
  | { ok: false; error: string; fieldId?: string }

/** A value sent back unchanged from what is stored (form strings vs stored number / boolean). */
export function sameAsStored(raw: unknown, stored: unknown): boolean {
  if (isBlankValue(stored)) return isBlankValue(raw)
  if (typeof stored === 'boolean') return raw === stored || raw === (stored ? 'yes' : 'no') || raw === String(stored)
  if (typeof stored === 'number') return raw === stored || (typeof raw === 'string' && raw.trim() !== '' && Number(raw.replace(/,/g, '')) === stored)
  return typeof raw === 'string' ? raw.trim() === String(stored) : raw === stored
}

/**
 * The ONE validator for saving values. `patch` = { [definition id]: value | null }; null / blank clears the value.
 * - Only ACTIVE fields of this entity may be written (a turned-off field keeps its stored value, read-only).
 * - A value equal to what is stored is skipped (untouched), so only fields that actually changed are validated.
 * - Required: after the merge, every active required field must have a value. Fields not in the patch count with their
 *   current value, so the form (which always sends every field) is what enforces it; a single-field save on an old
 *   record that is missing some other required value is refused with that field's name.
 */
export function validateValuePatch(
  defs: CustomFieldDefinition[],
  entity: CustomFieldEntity,
  current: Record<string, unknown> | null | undefined,
  patch: unknown
): ValuePatchResult {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, error: 'Nothing to save' }
  const active = new Map(defs.filter((d) => d.entity === entity && d.active).map((d) => [d.id, d]))
  const set: CustomFieldValues = {}
  const remove: string[] = []
  const stored = current ?? {}
  for (const [id, raw] of Object.entries(patch as Record<string, unknown>)) {
    // Sent back exactly as stored = untouched: kept as-is, never re-validated (a dropdown choice removed from the list
    // since must not stop someone saving the OTHER fields).
    if (id in stored && sameAsStored(raw, stored[id])) continue
    const def = active.get(id)
    if (!def) return { ok: false, error: 'One of these fields was turned off or removed. Reload and try again.', fieldId: id }
    if (isBlankValue(raw)) {
      remove.push(id)
      continue
    }
    const r = cleanFieldValue(def, raw)
    if (!r.ok) return { ok: false, error: r.error, fieldId: id }
    set[id] = r.value
  }
  if (Object.keys(set).length === 0 && remove.length === 0) return { ok: false, error: 'Nothing to save' }
  const after = { ...(current ?? {}) } as Record<string, unknown>
  for (const id of remove) delete after[id]
  Object.assign(after, set)
  for (const def of Array.from(active.values())) {
    if (def.required && isBlankValue(after[def.id])) return { ok: false, error: `${def.label} is required`, fieldId: def.id }
  }
  return { ok: true, set, remove }
}

/** How a stored value reads on a page ("—" when blank). Dates are calendar days (lib/format never zone-shifts a bare day). */
export function displayFieldValue(def: Pick<CustomFieldDefinition, 'field_type'>, v: unknown): string {
  if (isBlankValue(v)) return '—'
  if (def.field_type === 'yes_no') return v === true ? 'Yes' : v === false ? 'No' : String(v)
  if (def.field_type === 'number' && typeof v === 'number') return formatNumber(v)
  if (def.field_type === 'date' && typeof v === 'string' && isCalendarDate(v)) return formatDate(v)
  return String(v)
}

/** Fields to show on a record: active ones, plus turned-off ones that still hold a value (read-only), in order. */
export function fieldsToShow(defs: CustomFieldDefinition[], entity: CustomFieldEntity, values: Record<string, unknown> | null | undefined): CustomFieldDefinition[] {
  return orderedDefinitions(defs.filter((d) => d.entity === entity && (d.active || !isBlankValue(values?.[d.id]))))
}

/**
 * What a viewer may see. Field roles (isFieldRole: setters, canvassers, inside sales) get only customer / property fields
 * marked `visible_to_field` — the same deny-first rule as money and production. Everyone else gets every field.
 */
export function definitionsForViewer(defs: CustomFieldDefinition[], fieldRole: boolean): CustomFieldDefinition[] {
  return fieldRole ? defs.filter((d) => d.entity !== 'job' && d.visible_to_field) : defs
}

/** Stored values limited to the fields a viewer may see (unknown / hidden keys dropped). */
export function valuesForViewer(values: Record<string, unknown> | null | undefined, visible: CustomFieldDefinition[]): Record<string, unknown> {
  const ids = new Set(visible.map((d) => d.id))
  return Object.fromEntries(Object.entries(values ?? {}).filter(([k]) => ids.has(k)))
}

/**
 * Drop `custom_fields` from a record that is about to leave the server through a generic path (customer search / detail
 * API, the old customer account page). Field values reach people only through the Customer File / job cards, which
 * apply definitionsForViewer.
 */
export function withoutCustomFields<T>(row: T): T {
  if (!row || typeof row !== 'object' || !('custom_fields' in (row as object))) return row
  const { custom_fields: _omit, ...rest } = row as Record<string, unknown>
  return rest as T
}

export type DefinitionChange =
  | { action: 'add'; entity: unknown; label: unknown; field_type: unknown; options?: unknown; required?: unknown; visible_to_field?: unknown }
  | { action: 'update'; id: unknown; label?: unknown; options?: unknown; required?: unknown; visible_to_field?: unknown }
  | { action: 'setActive'; id: unknown; active: unknown }
  | { action: 'reorder'; entity: unknown; order: unknown }
