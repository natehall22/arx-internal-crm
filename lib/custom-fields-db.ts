/**
 * Custom fields — database side (server only, service-role client). The ONE writer of `custom_field_definitions`
 * (Settings → Custom fields via /api/admin/custom-fields) and of record values (via /api/custom-fields/values, which
 * checks who may edit the record first). Rules: lib/custom-fields.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  CUSTOM_FIELD_DEFINITION_COLUMNS,
  CUSTOM_FIELD_LIMITS,
  cleanFieldLabel,
  cleanFieldOptions,
  definitionFromRow,
  isCustomFieldEntity,
  isCustomFieldType,
  orderedDefinitions,
  validateValuePatch,
  type CustomFieldDefinition,
  type CustomFieldEntity,
  type DefinitionChange,
} from '@/lib/custom-fields'
import { isPropertiesNotReadyError } from '@/lib/properties'
import { orgDb } from '@/lib/supabase/org-db'

export const CUSTOM_FIELDS_NOT_READY = 'Custom fields turn on once the database update for them is applied.'

/** Table per entity for value reads (writes go through the SQL merge function). */
const VALUE_TABLE: Record<CustomFieldEntity, string> = { customer: 'customers', property: 'properties', job: 'production_jobs' }

export type LoadedDefinitions = { ready: boolean; definitions: CustomFieldDefinition[] }

/** Every definition of the company (active and off), ordered. `ready: false` until migration 202611110020 is applied. */
export async function loadCustomFieldDefinitions(admin: SupabaseClient, orgId: string, entity?: CustomFieldEntity): Promise<LoadedDefinitions> {
  let q = orgDb(admin, orgId).from('custom_field_definitions').select(CUSTOM_FIELD_DEFINITION_COLUMNS)
  if (entity) q = q.eq('entity', entity)
  const { data, error } = await q
  if (error) {
    if (!isPropertiesNotReadyError(error)) console.error('[custom-fields] load failed', error)
    return { ready: false, definitions: [] }
  }
  const defs = ((data ?? []) as Record<string, unknown>[]).map(definitionFromRow).filter((d): d is CustomFieldDefinition => !!d)
  return { ready: true, definitions: orderedDefinitions(defs) }
}

/** A record's stored values ({} when none / not ready). The record must be this company's. */
export async function loadCustomFieldValues(admin: SupabaseClient, orgId: string, entity: CustomFieldEntity, recordId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await orgDb(admin, orgId).from(VALUE_TABLE[entity]).select('id, custom_fields').eq('id', recordId).maybeSingle()
  if (error) {
    if (!isPropertiesNotReadyError(error)) console.error('[custom-fields] values load failed', error)
    return null
  }
  if (!data) return null
  const v = (data as { custom_fields?: unknown }).custom_fields
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export type SaveResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string; fieldId?: string }

/** Validate + atomically merge a value patch onto one record (the caller has already checked the person may edit it). */
export async function saveCustomFieldValues(
  admin: SupabaseClient,
  orgId: string,
  entity: CustomFieldEntity,
  recordId: string,
  patch: unknown
): Promise<SaveResult<Record<string, unknown>>> {
  const { ready, definitions } = await loadCustomFieldDefinitions(admin, orgId, entity)
  if (!ready) return { ok: false, status: 503, error: CUSTOM_FIELDS_NOT_READY }
  const current = await loadCustomFieldValues(admin, orgId, entity, recordId)
  if (current === null) return { ok: false, status: 404, error: 'Not found' }
  const v = validateValuePatch(definitions, entity, current, patch)
  if (!v.ok) return { ok: false, status: 400, error: v.error, fieldId: v.fieldId }
  const { data, error } = await admin.rpc('set_custom_field_values', { p_entity: entity, p_org: orgId, p_id: recordId, p_set: v.set, p_remove: v.remove })
  if (error) {
    console.error('[custom-fields] save failed', error)
    return { ok: false, status: isPropertiesNotReadyError(error) ? 503 : 500, error: isPropertiesNotReadyError(error) ? CUSTOM_FIELDS_NOT_READY : 'Could not save' }
  }
  if (data === null || data === undefined) return { ok: false, status: 404, error: 'Not found' }
  return { ok: true, value: data as Record<string, unknown> }
}

function fail<T>(status: number, error: string): SaveResult<T> {
  return { ok: false, status, error }
}

/**
 * One change to the company's field list (owners only — enforced by the route). Never deletes: "turn off" hides a field
 * and keeps every saved value. The type of a field never changes after it is created (stored values would stop matching).
 */
export async function saveDefinitionChange(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  change: DefinitionChange
): Promise<SaveResult<CustomFieldDefinition[]>> {
  const loaded = await loadCustomFieldDefinitions(admin, orgId)
  if (!loaded.ready) return fail(503, CUSTOM_FIELDS_NOT_READY)
  const defs = loaded.definitions
  const db = orgDb(admin, orgId)
  const byId = (id: unknown) => (typeof id === 'string' ? defs.find((d) => d.id === id) ?? null : null)
  const dupLabel = (entity: CustomFieldEntity, label: string, exceptId?: string) =>
    defs.some((d) => d.entity === entity && d.id !== exceptId && d.label.toLowerCase() === label.toLowerCase())

  let error: { code?: string; message?: string } | null = null
  switch (change.action) {
    case 'add': {
      if (!isCustomFieldEntity(change.entity)) return fail(400, 'Pick what the field is for')
      if (!isCustomFieldType(change.field_type)) return fail(400, 'Pick a field type')
      const label = cleanFieldLabel(change.label)
      if (!label) return fail(400, `Enter a name up to ${CUSTOM_FIELD_LIMITS.label} characters`)
      if (dupLabel(change.entity, label)) return fail(409, `${label} is already a field`)
      if (defs.filter((d) => d.entity === change.entity).length >= CUSTOM_FIELD_LIMITS.perEntity) return fail(400, `Up to ${CUSTOM_FIELD_LIMITS.perEntity} fields each`)
      let options: string[] = []
      if (change.field_type === 'dropdown') {
        const o = cleanFieldOptions(change.options ?? [])
        if (!o || o.length === 0) return fail(400, 'Add at least one choice for the dropdown')
        options = o
      }
      if (change.required !== undefined && typeof change.required !== 'boolean') return fail(400, 'required must be true or false')
      const sort = Math.max(0, ...defs.filter((d) => d.entity === change.entity).map((d) => d.sort)) + 10
      ;({ error } = await db.from('custom_field_definitions').insert({
        entity: change.entity, label, field_type: change.field_type, options, required: change.required === true, sort, active: true,
        created_by: userId, updated_by: userId,
      }))
      break
    }
    case 'update': {
      const def = byId(change.id)
      if (!def) return fail(404, 'That field is not on the list')
      const patch: Record<string, unknown> = { updated_by: userId, updated_at: new Date().toISOString() }
      if (change.label !== undefined) {
        const label = cleanFieldLabel(change.label)
        if (!label) return fail(400, `Enter a name up to ${CUSTOM_FIELD_LIMITS.label} characters`)
        if (dupLabel(def.entity, label, def.id)) return fail(409, `${label} is already a field`)
        patch.label = label
      }
      if (change.options !== undefined) {
        if (def.field_type !== 'dropdown') return fail(400, 'Only a dropdown has choices')
        const o = cleanFieldOptions(change.options)
        if (!o || o.length === 0) return fail(400, 'Keep at least one choice')
        patch.options = o
      }
      if (change.required !== undefined) {
        if (typeof change.required !== 'boolean') return fail(400, 'required must be true or false')
        patch.required = change.required
      }
      if (Object.keys(patch).length === 2) return fail(400, 'Nothing to save')
      ;({ error } = await db.from('custom_field_definitions').update(patch).eq('id', def.id))
      break
    }
    case 'setActive': {
      const def = byId(change.id)
      if (!def) return fail(404, 'That field is not on the list')
      if (typeof change.active !== 'boolean') return fail(400, 'active must be true or false')
      ;({ error } = await db.from('custom_field_definitions').update({ active: change.active, updated_by: userId, updated_at: new Date().toISOString() }).eq('id', def.id))
      break
    }
    case 'reorder': {
      if (!isCustomFieldEntity(change.entity)) return fail(400, 'Pick what the fields are for')
      const entity = change.entity
      const mine = defs.filter((d) => d.entity === entity)
      const order = Array.isArray(change.order) ? change.order : null
      if (!order || order.length !== mine.length || new Set(order).size !== mine.length || !order.every((id) => mine.some((d) => d.id === id))) {
        return fail(400, 'The list changed. Reload and try again.')
      }
      for (let i = 0; i < order.length; i++) {
        const { error: e } = await db.from('custom_field_definitions').update({ sort: (i + 1) * 10, updated_by: userId }).eq('id', order[i] as string).eq('entity', entity)
        if (e) {
          error = e
          break
        }
      }
      break
    }
    default:
      return fail(400, 'Unknown change')
  }
  if (error) {
    if (error.code === '23505') return fail(409, 'A field with that name is already on the list')
    console.error('[custom-fields] definition save failed', error)
    return fail(500, 'Could not save')
  }
  const after = await loadCustomFieldDefinitions(admin, orgId)
  return { ok: true, value: after.definitions }
}
