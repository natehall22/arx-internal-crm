/**
 * Which visit photos a CUSTOMER may see — the ONE rule, used by the customer's "done" email page (`/m/<token>`,
 * lib/customer-messages-db.ts `messagePhotos`) and by the portal (lib/portal/data.ts). A customer sees the photos taken on
 * THEIR OWN service visits (`customerVisitIds`; the /m/ page proves it by its message's visit): not deleted, pictures only.
 *
 * JOB photos (roofing) are the second half of the same rule, `loadCustomerJobPhotos`, and are HIDDEN by default: a job photo
 * reaches the customer only when staff marked that photo "Show to customer" (`photos.shared_with_customer`), or the job has
 * "Show crew photos to customer" on (`production_jobs.portal_show_crew_photos`) AND the photo is one of the crew's four
 * walk-around shots (front / back / left / right) taken on one of the job's trades. Job documents are a separate switch
 * (`documents.shared_with_customer`).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { REQUIRED_FINAL_PHOTO_TAGS } from '@/lib/final-photo-tags'
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

/**
 * Job photos a customer may see (the caller says whose jobs). `crewJobIds` = the jobs whose crew walk-around photos are
 * switched on. Both queries are narrowed to the given jobs; `photoId` narrows to one photo (same rule for list and download).
 * Columns that may not exist yet (migration 202611150010) make a query return nothing, never an error.
 */
export async function loadCustomerJobPhotos(
  admin: SupabaseClient,
  orgId: string,
  jobIds: string[],
  crewJobIds: string[],
  opts: { limit?: number; photoId?: string } = {}
): Promise<VisitPhoto[]> {
  const limit = opts.limit ?? 40
  const db = orgDb(admin, orgId)
  const out = new Map<string, VisitPhoto>()
  const take = (rows: unknown) => {
    for (const p of (rows ?? []) as VisitPhoto[]) {
      if (!p.storage_path || (p.mime_type && !p.mime_type.startsWith('image/'))) continue
      out.set(p.id, p)
    }
  }
  const jobs = Array.from(new Set(jobIds)).slice(0, CHUNK)
  if (jobs.length) {
    let q = db.from('photos').select(COLS).in('job_id', jobs).eq('shared_with_customer', true).is('deleted_at', null)
    if (opts.photoId) q = q.eq('id', opts.photoId)
    take((await q.order('created_at', { ascending: false }).limit(limit)).data)
  }
  const crew = Array.from(new Set(crewJobIds)).filter((id) => jobs.includes(id))
  if (crew.length) {
    let q = db.from('photos').select(COLS).in('job_id', crew).not('work_order_id', 'is', null).in('photo_tag', [...REQUIRED_FINAL_PHOTO_TAGS]).is('deleted_at', null)
    if (opts.photoId) q = q.eq('id', opts.photoId)
    take((await q.order('created_at', { ascending: false }).limit(limit)).data)
  }
  return Array.from(out.values()).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit)
}
