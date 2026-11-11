/**
 * Which documents the company shows a customer in their portal — ONE writer. Nothing is shared by default. Customer-level
 * documents follow the Customer File's document rule (`editDocuments`); job documents need the job board or owner access
 * (the same people who open the job's Files). Photos have no switch: a customer sees only their own visits' photos
 * (lib/customer-visit-photos.ts). JOB photos are hidden too until staff mark one ("Show to customer", `setPhotoShared`) or switch on a
 * job's crew walk-around set ("Show crew photos to customer", `setJobCrewPhotosShared`) — same people as job documents.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveCustomerAccess } from '@/lib/customer-file/customer-access'
import { orgDb } from '@/lib/supabase/org-db'
import type { ThreadViewer } from '@/lib/threads/visibility'

export type ShareResult = { ok: true; shared: boolean } | { ok: false; status: 400 | 403 | 404 | 409; error: string }

export async function setSharedWithCustomer(admin: SupabaseClient, viewer: ThreadViewer, id: string, shared: boolean): Promise<ShareResult> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, status: 404, error: 'Not found' }
  const db = orgDb(admin, viewer.orgId)
  const { data } = await db.from('documents').select('id, customer_id, job_id').eq('id', id).is('deleted_at', null).maybeSingle()
  const row = data as { id: string; customer_id: string | null; job_id: string | null } | null
  if (!row) return { ok: false, status: 404, error: 'Not found' }
  if (row.customer_id && !row.job_id) {
    const access = await resolveCustomerAccess(admin, viewer, row.customer_id)
    if (!access?.editDocuments) return { ok: false, status: 404, error: 'Not found' }
  } else if (!(viewer.ownerLike || viewer.jobBoard)) {
    return { ok: false, status: 404, error: 'Not found' }
  }
  const { error } = await db.from('documents').update({ shared_with_customer: shared }).eq('id', id)
  if (error) return { ok: false, status: 409, error: 'Sharing turns on once the customer portal update is applied.' }
  return { ok: true, shared }
}

const UUID = /^[0-9a-f-]{36}$/i

/** Show (or stop showing) ONE job photo to the customer. */
export async function setPhotoShared(admin: SupabaseClient, viewer: ThreadViewer, photoId: string, shared: boolean): Promise<ShareResult> {
  if (typeof photoId !== 'string' || !UUID.test(photoId) || !(viewer.ownerLike || viewer.jobBoard)) return { ok: false, status: 404, error: 'Not found' }
  const db = orgDb(admin, viewer.orgId)
  const { data } = await db.from('photos').select('id, job_id').eq('id', photoId).is('deleted_at', null).maybeSingle()
  if (!(data as { job_id?: string | null } | null)?.job_id) return { ok: false, status: 404, error: 'Not found' }
  const { error } = await db.from('photos').update({ shared_with_customer: shared }).eq('id', photoId)
  if (error) return { ok: false, status: 409, error: 'Sharing turns on once the customer portal update is applied.' }
  return { ok: true, shared }
}

/** One tap per job: the crew's four walk-around photos on this job are (or are not) shown to the customer. */
export async function setJobCrewPhotosShared(admin: SupabaseClient, viewer: ThreadViewer, jobId: string, shared: boolean): Promise<ShareResult> {
  if (typeof jobId !== 'string' || !UUID.test(jobId) || !(viewer.ownerLike || viewer.jobBoard)) return { ok: false, status: 404, error: 'Not found' }
  const db = orgDb(admin, viewer.orgId)
  const { data } = await db.from('production_jobs').select('id').eq('id', jobId).maybeSingle()
  if (!data) return { ok: false, status: 404, error: 'Not found' }
  const { error } = await db.from('production_jobs').update({ portal_show_crew_photos: shared }).eq('id', jobId)
  if (error) return { ok: false, status: 409, error: 'Sharing turns on once the customer portal update is applied.' }
  return { ok: true, shared }
}

/** Is this job's crew photo set shown to the customer? (false before the migration) */
export async function crewPhotosShared(admin: SupabaseClient, orgId: string, jobId: string): Promise<boolean> {
  const { data, error } = await orgDb(admin, orgId).from('production_jobs').select('portal_show_crew_photos').eq('id', jobId).maybeSingle()
  return !error && (data as { portal_show_crew_photos?: boolean } | null)?.portal_show_crew_photos === true
}
