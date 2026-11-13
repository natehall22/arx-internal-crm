/**
 * Server side of the crew's checklist (rules: lib/visit-checklist.ts). ONE writer: a tap on one of the visit's services.
 * Only the crew the visit is assigned to, only while the visit is still to do, only a service on the list; two phones on the
 * same crew link tapping at once are kept apart by a compare-and-set on `updated_at` (retried).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { SERVICE_STEP, SERVICE_VISIT_TYPE } from '@/lib/service-plans'
import { orgDb } from '@/lib/supabase/org-db'
import { readChecklist, readServiceLines, tapChecklist, visitChecklist, type ChecklistItem } from '@/lib/visit-checklist'

export type TapResult = { ok: true; checklist: ChecklistItem[] } | { ok: false; status: 400 | 404 | 409; error: string }

const TRIES = 4

export async function tapVisitChecklist(admin: SupabaseClient, orgId: string, subId: string, visitId: string, label: unknown, done: unknown): Promise<TapResult> {
  const db = orgDb(admin, orgId)
  for (let attempt = 0; attempt < TRIES; attempt++) {
    const { data: row } = await db
      .from('work_orders')
      .select('id, status, updated_at, visit_step, service_plan_id, visit_checklist')
      .eq('id', visitId)
      .eq('work_order_type', SERVICE_VISIT_TYPE)
      .eq('assigned_sub_id', subId)
      .maybeSingle()
    const r = row as { id: string; status: string; updated_at: string; visit_step: string | null; service_plan_id: string | null; visit_checklist: unknown } | null
    if (!r) return { ok: false, status: 404, error: 'Visit not found' }
    if (r.status !== 'scheduled') return { ok: false, status: 409, error: 'This visit is already closed' }
    if ((r.visit_step ?? SERVICE_STEP) !== SERVICE_STEP || !r.service_plan_id) return { ok: false, status: 400, error: 'This visit has no checklist' }
    const { data: plan } = await db.from('service_plans').select('service_lines').eq('id', r.service_plan_id).maybeSingle()
    const current = visitChecklist(readServiceLines((plan as { service_lines?: unknown } | null)?.service_lines), readChecklist(r.visit_checklist), true)
    const next = tapChecklist(current, label, done)
    if (!next.ok) return { ok: false, status: 400, error: next.error }
    const { data: saved, error } = await db.from('work_orders').update({ visit_checklist: next.value }).eq('id', visitId).eq('updated_at', r.updated_at).select('id')
    if (error) {
      console.error('[visit-checklist] save failed', error)
      return { ok: false, status: 409, error: 'Could not save that tap' }
    }
    if (saved && saved.length > 0) return { ok: true, checklist: next.value }
    // Someone else changed the visit between the read and the write: read again and apply this tap on top.
  }
  return { ok: false, status: 409, error: 'Someone else just changed this visit — try again' }
}
