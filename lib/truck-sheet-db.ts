/**
 * Truck sheet — the database side (server only). Machines for a plan's visits / one visit, and the office's note for a crew's day.
 * Migration 202612010060: the columns and the table are read tolerantly (absent = nothing there, never a broken screen); a SAVE
 * before the migration says so in plain words.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingColumn, isMissingTable } from '@/lib/supabase/errors'
import { orgDb } from '@/lib/supabase/org-db'
import { CREW_NOTE_MAX, cleanCrewNote, cleanEquipmentIds } from '@/lib/truck-sheet'

export const TRUCK_SHEET_NOT_READY = 'Machines and crew notes turn on once the database update for them is applied. Nothing was saved.'

type Fail = { ok: false; status: 400 | 404 | 503 | 500; error: string }
const COLUMN = 'equipment_item_ids'

const asIds = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null)

/** Plans' default machines (`null` = none set). A missing column reads as "none set" for every plan. */
export async function loadPlanEquipment(admin: SupabaseClient, orgId: string, planIds: string[]): Promise<Map<string, string[] | null>> {
  const out = new Map<string, string[] | null>()
  if (planIds.length === 0) return out
  const { data, error } = await orgDb(admin, orgId).from('service_plans').select(`id, ${COLUMN}`).in('id', planIds)
  if (error) {
    if (!isMissingColumn(error, COLUMN)) console.error('[truck-sheet] plan machines failed', error)
    return out
  }
  for (const r of (data ?? []) as Array<Record<string, unknown>>) out.set(String(r.id), asIds(r[COLUMN]))
  return out
}

/** Visits' own machine lists (`null` = use the plan's). */
export async function loadVisitEquipment(admin: SupabaseClient, orgId: string, workOrderIds: string[]): Promise<Map<string, string[] | null>> {
  const out = new Map<string, string[] | null>()
  if (workOrderIds.length === 0) return out
  const { data, error } = await orgDb(admin, orgId).from('work_orders').select(`id, ${COLUMN}`).in('id', workOrderIds)
  if (error) {
    if (!isMissingColumn(error, COLUMN)) console.error('[truck-sheet] visit machines failed', error)
    return out
  }
  for (const r of (data ?? []) as Array<Record<string, unknown>>) out.set(String(r.id), asIds(r[COLUMN]))
  return out
}

/** Machine names for ids (turned-off items too: a plan keeps showing a machine the office later retired). Items of another company are never found. */
export async function loadEquipmentNames(admin: SupabaseClient, orgId: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const want = Array.from(new Set(ids))
  if (want.length === 0) return out
  const { data, error } = await orgDb(admin, orgId).from('pricebook_items').select('id, name').in('id', want)
  if (error) return out
  for (const r of (data ?? []) as Array<{ id: string; name: string }>) out.set(r.id, r.name)
  return out
}

/** Null when every one is this company's machine (price-book item, unit 'hour' — the set the time clock offers, loadEquipmentChoices), else the refusal. */
export async function machinesRefusal(admin: SupabaseClient, orgId: string, ids: string[]): Promise<Fail | null> {
  if (ids.length === 0) return null
  const { data, error } = await orgDb(admin, orgId).from('pricebook_items').select('id, unit').in('id', ids)
  if (error) return { ok: false, status: 500, error: 'Could not check the machines' }
  const rows = (data ?? []) as Array<{ id: string; unit: string }>
  const ok = new Set(rows.filter((r) => r.unit === 'hour').map((r) => r.id))
  return ids.every((i) => ok.has(i)) ? null : { ok: false, status: 400, error: 'Pick machines from the list' }
}

type Saved = { ok: true; ids: string[] | null } | Fail

/** Set a plan's default machines (`null` = none set). Plan must be this company's. */
export async function savePlanEquipment(admin: SupabaseClient, orgId: string, planId: string, input: unknown): Promise<Saved> {
  const clean = cleanEquipmentIds(input)
  if (!clean.ok) return { ok: false, status: 400, error: clean.error }
  const bad = clean.value ? await machinesRefusal(admin, orgId, clean.value) : null
  if (bad) return bad
  const { data, error } = await orgDb(admin, orgId).from('service_plans').update({ [COLUMN]: clean.value }).eq('id', planId).select('id')
  if (error) return writeFail(error, 'plan')
  if (!data || data.length === 0) return { ok: false, status: 404, error: 'Plan not found' }
  return { ok: true, ids: clean.value }
}

/** Set one visit's own machines (`null` = back to the plan's). Only a still-to-do service visit of this company. */
export async function saveVisitEquipment(admin: SupabaseClient, orgId: string, workOrderId: string, input: unknown): Promise<Saved> {
  const clean = cleanEquipmentIds(input)
  if (!clean.ok) return { ok: false, status: 400, error: clean.error }
  const bad = clean.value ? await machinesRefusal(admin, orgId, clean.value) : null
  if (bad) return bad
  const { data, error } = await orgDb(admin, orgId)
    .from('work_orders')
    .update({ [COLUMN]: clean.value })
    .eq('id', workOrderId)
    .eq('work_order_type', 'service_visit')
    .eq('status', 'scheduled')
    .select('id')
  if (error) return writeFail(error, 'visit')
  if (!data || data.length === 0) return { ok: false, status: 404, error: 'Visit not found, or it is already done' }
  return { ok: true, ids: clean.value }
}

function writeFail(error: { code?: string; message?: string }, what: string): Fail {
  if (isMissingColumn(error, COLUMN)) return { ok: false, status: 503, error: TRUCK_SHEET_NOT_READY }
  console.error(`[truck-sheet] ${what} machines save failed`, error)
  return { ok: false, status: 500, error: 'Could not save the machines' }
}

// ---------------------------------------------------------------------------------------------------------------------
// Office note for a crew's day
// ---------------------------------------------------------------------------------------------------------------------

export type CrewDayNote = { note: string; updatedAt: string }

/** The office's note for ONE crew on ONE day, or null. A missing table reads as no note. */
export async function loadCrewDayNote(admin: SupabaseClient, orgId: string, subId: string, day: string): Promise<CrewDayNote | null> {
  const { data, error } = await orgDb(admin, orgId).from('crew_day_notes').select('note, updated_at').eq('sub_id', subId).eq('day', day).maybeSingle()
  if (error) {
    if (!isMissingTable(error)) console.error('[truck-sheet] crew note failed', error)
    return null
  }
  const r = data as { note?: string; updated_at?: string } | null
  return r?.note ? { note: r.note, updatedAt: String(r.updated_at ?? '') } : null
}

/**
 * Write (or clear, with blank text) the note for a crew's day: one row per company + crew + day, a second save replaces it. The
 * crew must be this company's. The note is crew-visible by design (crew phone page and the sheet).
 */
export async function saveCrewDayNote(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  subId: string,
  day: string,
  input: unknown
): Promise<{ ok: true; note: string | null } | Fail> {
  const clean = cleanCrewNote(input)
  if (!clean.ok) return { ok: false, status: 400, error: clean.error }
  const db = orgDb(admin, orgId)
  const { data: sub } = await db.from('sub_contractors').select('id').eq('id', subId).maybeSingle()
  if (!sub) return { ok: false, status: 404, error: 'Crew not found' }
  if (clean.value === null) {
    const { error } = await db.from('crew_day_notes').delete().eq('sub_id', subId).eq('day', day)
    if (error) return noteFail(error)
    return { ok: true, note: null }
  }
  if (clean.value.length > CREW_NOTE_MAX) return { ok: false, status: 400, error: 'That note is too long' }
  const { error } = await db
    .from('crew_day_notes')
    .upsert({ sub_id: subId, day, note: clean.value, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'org_id,sub_id,day' })
  if (error) return noteFail(error)
  return { ok: true, note: clean.value }
}

function noteFail(error: { code?: string; message?: string }): Fail {
  if (isMissingTable(error)) return { ok: false, status: 503, error: TRUCK_SHEET_NOT_READY }
  console.error('[truck-sheet] crew note save failed', error)
  return { ok: false, status: 500, error: 'Could not save the note' }
}

// ---------------------------------------------------------------------------------------------------------------------
// One visit's machines, for the Visits board sheet
// ---------------------------------------------------------------------------------------------------------------------

export type VisitEquipmentView = { visitId: string; planId: string; status: string; own: string[] | null; plan: string[] | null; names: Record<string, string> }

/** A visit's own list, its plan's default and the names of both. Null when it is not this company's service visit. */
export async function loadVisitEquipmentView(admin: SupabaseClient, orgId: string, visitId: string): Promise<VisitEquipmentView | null> {
  const { data } = await orgDb(admin, orgId).from('work_orders').select('id, service_plan_id, status').eq('id', visitId).eq('work_order_type', 'service_visit').maybeSingle()
  const wo = data as { id: string; service_plan_id: string | null; status: string } | null
  if (!wo || !wo.service_plan_id) return null
  const [own, plan] = await Promise.all([loadVisitEquipment(admin, orgId, [wo.id]), loadPlanEquipment(admin, orgId, [wo.service_plan_id])])
  const ownIds = own.get(wo.id) ?? null
  const planIds = plan.get(wo.service_plan_id) ?? null
  const names = await loadEquipmentNames(admin, orgId, [...(ownIds ?? []), ...(planIds ?? [])])
  return { visitId: wo.id, planId: wo.service_plan_id, status: wo.status, own: ownIds, plan: planIds, names: Object.fromEntries(names) }
}
