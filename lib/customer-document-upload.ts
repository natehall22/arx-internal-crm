'use client'

/**
 * THE browser upload of one customer document: register (signed upload URL) → straight to storage → finalize (the
 * `documents` row). Used by the Customer File Documents card and Move from Jobber's file step. Returns the new document id.
 */
import { multipartFilenameForUpload } from '@/lib/files/storage'
import { createClientBrowser } from '@/lib/supabase/client'

export async function uploadCustomerDocument(
  customerId: string,
  file: File,
  opts: { category: string; title?: string | null; propertyId?: string | null; fallbackName?: string }
): Promise<string> {
  const json = async (url: string, body: unknown) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Upload failed')
    return data
  }
  const reg = await json(`/api/customers/${customerId}/documents`, {
    filename: multipartFilenameForUpload(file, opts.fallbackName ?? 'document'),
    propertyId: opts.propertyId || null,
  })
  const { error } = await createClientBrowser()
    .storage.from(String(reg.bucket))
    .uploadToSignedUrl(String(reg.storagePath), String(reg.signedUploadToken), file, { contentType: file.type || 'application/octet-stream' })
  if (error) throw new Error(error.message)
  const done = await json(`/api/customers/${customerId}/documents/finalize`, {
    documentId: reg.documentId,
    category: opts.category,
    title: opts.title ?? (file.name.replace(/\.[^.]+$/, '') || file.name),
    propertyId: opts.propertyId || null,
    mime_type: file.type || null,
    file_size: file.size,
  })
  return String(done.id ?? reg.documentId)
}
