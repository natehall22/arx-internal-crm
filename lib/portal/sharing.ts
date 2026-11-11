/**
 * Which documents and photos the company shows a customer in their portal — ONE writer. Nothing is shared by default.
 * Customer-level documents follow the Customer File's document rule (`editDocuments`); job documents / photos need the
 * job board or owner access (the same people who open the job's Files).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveCustomerAccess } from '@/lib/customer-file/customer-access'
import { orgDb } from '@/lib/supabase/org-db'
import type { ThreadViewer } from '@/lib/threads/visibility'

export type ShareResult = { ok: true; shared: boolean } | { ok: false; status: 400 | 403 | 404 | 409; error: string }

export async function setSharedWithCustomer(admin: SupabaseClient, viewer: ThreadViewer, kind: 'document' | 'photo', id: string, shared: boolean): Promise<ShareResult> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, status: 404, error: 'Not found' }
  const db = orgDb(admin, viewer.orgId)
  const table = kind === 'document' ? 'documents' : 'photos'
  const cols = kind === 'document' ? 'id, customer_id, job_id' : 'id, job_id'
  const { data } = await db.from(table).select(cols).eq('id', id).is('deleted_at', null).maybeSingle()
  const row = data as { id: string; customer_id?: string | null; job_id: string | null } | null
  if (!row) return { ok: false, status: 404, error: 'Not found' }
  if (kind === 'document' && row.customer_id && !row.job_id) {
    const access = await resolveCustomerAccess(admin, viewer, row.customer_id)
    if (!access?.editDocuments) return { ok: false, status: 404, error: 'Not found' }
  } else if (!(viewer.ownerLike || viewer.jobBoard)) {
    return { ok: false, status: 404, error: 'Not found' }
  }
  const { error } = await db.from(table).update({ shared_with_customer: shared }).eq('id', id)
  if (error) return { ok: false, status: 409, error: 'Sharing turns on once the customer portal update is applied.' }
  return { ok: true, shared }
}
