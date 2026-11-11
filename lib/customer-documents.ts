/**
 * Customer-level documents: contracts, agreements, insurance certificates, site maps — anything filed on a CUSTOMER (and
 * optionally one of their properties) with no job. Stored exactly like job documents (table `documents`, bucket
 * project-files, the same register → direct upload → finalize flow), with `job_id` NULL and `customer_id` set; the path
 * is `buildCustomerDocumentStoragePath` (lib/files/storage.ts). Server only. Access: lib/customer-file/customer-access.ts
 * (`documents` / `editDocuments`), checked by the routes under /api/customers/[id]/documents.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export { CUSTOMER_DOCUMENT_CATEGORIES, isCustomerDocumentCategory } from '@/lib/customer-document-categories'
import { isPropertiesNotReadyError } from '@/lib/properties'
import { orgDb } from '@/lib/supabase/org-db'

export function customerDocumentFolder(orgId: string, customerId: string): string {
  return `${orgId}/customers/${customerId}/documents`
}

export type CustomerDocument = {
  id: string
  title: string | null
  filename: string
  category: string
  mime_type: string | null
  file_size: number | null
  property_id: string | null
  /** Shown to the customer in their portal (migration 202611120060). */
  shared_with_customer: boolean
  created_at: string
}

const COLS = 'id, title, filename, category, mime_type, file_size, created_at'

/** The customer's own documents (no job), newest first. property_id is read only once the properties migration is in. */
export async function loadCustomerDocuments(admin: SupabaseClient, orgId: string, customerId: string): Promise<CustomerDocument[]> {
  const base = () =>
    orgDb(admin, orgId).from('documents')
  const run = (cols: string) =>
    base().select(cols).eq('customer_id', customerId).is('job_id', null).is('deleted_at', null).order('created_at', { ascending: false }).limit(200)
  // Newest columns first; each older shape is what a database without the later migration answers with.
  let { data, error } = await run(`${COLS}, property_id, shared_with_customer`)
  if (error) ({ data, error } = await run(`${COLS}, property_id`))
  if (error && isPropertiesNotReadyError(error)) ({ data, error } = await run(COLS))
  if (error) {
    console.error('[customer-documents] load failed', error)
    return []
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    title: (r.title as string | null) ?? null,
    filename: String(r.filename ?? 'file'),
    category: String(r.category ?? 'misc'),
    mime_type: (r.mime_type as string | null) ?? null,
    file_size: typeof r.file_size === 'number' ? r.file_size : null,
    property_id: (r.property_id as string | null) ?? null,
    shared_with_customer: r.shared_with_customer === true,
    created_at: String(r.created_at ?? ''),
  }))
}

/** One live customer-level document of this customer (for download), or null. */
export async function findCustomerDocument(admin: SupabaseClient, orgId: string, customerId: string, documentId: string): Promise<{ id: string; storage_path: string } | null> {
  if (typeof documentId !== 'string' || !documentId) return null
  const { data } = await orgDb(admin, orgId)
    .from('documents')
    .select('id, storage_path')
    .eq('id', documentId)
    .eq('customer_id', customerId)
    .is('job_id', null)
    .is('deleted_at', null)
    .maybeSingle()
  const row = data as { id: string; storage_path: string | null } | null
  return row?.storage_path ? { id: row.id, storage_path: row.storage_path } : null
}
