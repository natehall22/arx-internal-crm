/**
 * Which visit photos a CUSTOMER may see — the ONE rule, used by the customer's "done" email page (`/m/<token>`,
 * lib/customer-messages-db.ts `messagePhotos`) and by the portal (lib/portal/data.ts). A customer sees the photos taken on
 * THEIR OWN service visits (`customerVisitIds`; the /m/ page proves it by its message's visit): not deleted, pictures only. Job
 * documents and job photos are never part of it (the portal shows a job document only when staff switch "Show to customer" on).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { SERVICE_VISIT_TYPE } from '@/lib/service-plans'
import { orgDb } from '@/lib/supabase/org-db'

export type VisitPhoto = { id: string; work_order_id: string; storage_path: string; mime_type: string | null; filename: string | null; caption: string | null; created_at: string }

const COLS = 'id, work_order_id, storage_path, mime_type, filename, caption, created_at'
const CHUNK = 100

/** The ids of a customer's own service visits (newest first, capped). */
export async function customerVisitIds(admin: SupabaseClient, orgId: string, customerId: string, limit = 300): Promise<string[]> {
  const { data } = await orgDb(admin, orgId).from('work_orders').select('id').eq('customer_id', customerId).eq('work_order_type', SERVICE_VISIT_TYPE).order('scheduled_date', { ascending: false }).limit(limit)
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
}

/**
 * Photos on these visits (the caller says whose visits they are). `photoId` narrows to one photo — the same rule, so a
 * download can only ever return what the list would have shown.
 */
export async function loadCustomerVisitPhotos(admin: SupabaseClient, orgId: string, visitIds: string[], opts: { limit?: number; photoId?: string } = {}): Promise<VisitPhoto[]> {
  const limit = opts.limit ?? 40
  const db = orgDb(admin, orgId)
  const out: VisitPhoto[] = []
  for (let i = 0; i < visitIds.length && out.length < limit; i += CHUNK) {
    let q = db.from('photos').select(COLS).in('work_order_id', visitIds.slice(i, i + CHUNK)).is('deleted_at', null)
    if (opts.photoId) q = q.eq('id', opts.photoId)
    const { data } = await q.order('created_at', { ascending: false }).limit(limit)
    for (const p of (data ?? []) as VisitPhoto[]) {
      if (!p.storage_path || (p.mime_type && !p.mime_type.startsWith('image/'))) continue
      out.push(p)
    }
  }
  return out.slice(0, limit)
}
