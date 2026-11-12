/** Stored PDFs for send-any-PDF (server only): the private `files` bucket, one object per upload, fingerprinted. */
import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import { sha256Hex } from '@/lib/signing/hash'
import { readPdfInfo, type PdfInfo } from '@/lib/signing/requests/pdf'

export async function storeUploadedPdf(admin: SupabaseClient, orgId: string, bytes: Uint8Array): Promise<{ ok: true; path: string; sha256: string; info: PdfInfo } | { ok: false; error: string; status: number }> {
  const info = await readPdfInfo(bytes)
  if (!info.ok) return { ok: false, error: info.error, status: 400 }
  const path = `org/${orgId}/signing/uploads/${randomUUID()}.pdf`
  const { error } = await admin.storage.from('files').upload(path, Buffer.from(bytes), { contentType: 'application/pdf', upsert: false })
  if (error) return { ok: false, error: 'Could not store the document. Please try again.', status: 500 }
  return { ok: true, path, sha256: sha256Hex(Buffer.from(bytes)), info: info.info }
}

export async function readStoredPdf(admin: SupabaseClient, path: string): Promise<Buffer | null> {
  const { data, error } = await admin.storage.from('files').download(path)
  if (error || !data) return null
  return Buffer.from(await (data as Blob).arrayBuffer())
}

/** A PDF as a download/stream response body (same-origin, so the page's PDF reader needs no storage CORS). */
export function pdfResponse(bytes: Buffer, filename: string, inline = true): Response {
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/[^\w .-]+/g, '_')}"`,
      'Cache-Control': 'private, no-store, max-age=0',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
