/** Stored PDFs for send-any-PDF (server only): the private `files` bucket, one object per upload, fingerprinted. */
import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import { NextResponse } from 'next/server'

import { signFilesObject } from '@/lib/files/files-object'
import { sha256Hex } from '@/lib/signing/hash'
import { readPdfInfo, type PdfInfo } from '@/lib/signing/requests/pdf'
import { LIMITS } from '@/lib/signing/requests/types'

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer' }

const UPLOAD_UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/**
 * PDFs go from the browser STRAIGHT to storage (Vercel caps a function body at ~4.5 MB; our cap is LIMITS.maxPdfBytes): the server
 * hands out a one-time signed upload URL for a path inside the company's own folder, then `adoptUploadedPdf` checks what arrived.
 */
export async function createUploadSlot(admin: SupabaseClient, orgId: string): Promise<{ ok: true; path: string; signedUrl: string; token: string } | { ok: false; error: string }> {
  const path = `org/${orgId}/signing/uploads/${randomUUID()}.pdf`
  const { data, error } = await admin.storage.from('files').createSignedUploadUrl(path)
  if (error || !data?.signedUrl) return { ok: false, error: 'Could not start the upload. Please try again.' }
  return { ok: true, path, signedUrl: data.signedUrl, token: data.token }
}

export type AdoptedPdf = { ok: true; path: string; sha256: string; info: PdfInfo } | { ok: false; error: string; status: number }

/** After the browser uploaded to a slot: the path must be this company's slot, and the bytes must be a real PDF within the size and page caps. A bad object is removed. */
export async function adoptUploadedPdf(admin: SupabaseClient, orgId: string, rawPath: unknown): Promise<AdoptedPdf> {
  const path = typeof rawPath === 'string' ? rawPath : ''
  if (!new RegExp(`^org/${orgId}/signing/uploads/${UPLOAD_UUID}\\.pdf$`).test(path)) return { ok: false, error: 'Upload the document again', status: 400 }
  const bytes = await readStoredPdf(admin, path)
  if (!bytes) return { ok: false, error: 'The upload did not arrive. Please try again.', status: 400 }
  const bad = async (error: string, status: number): Promise<AdoptedPdf> => { await admin.storage.from('files').remove([path]); return { ok: false, error, status } }
  if (bytes.length > LIMITS.maxPdfBytes) return bad(`That PDF is larger than ${Math.round(LIMITS.maxPdfBytes / 1048576)} MB`, 413)
  const info = await readPdfInfo(new Uint8Array(bytes))
  if (!info.ok) return bad(info.error, 400)
  return { ok: true, path, sha256: sha256Hex(bytes), info: info.info }
}

export async function readStoredPdf(admin: SupabaseClient, path: string): Promise<Buffer | null> {
  const { data, error } = await admin.storage.from('files').download(path)
  if (error || !data) return null
  return Buffer.from(await (data as Blob).arrayBuffer())
}

/** Hand the browser a short-lived signed storage URL (no PDF through a function body: size caps). */
export async function redirectToStored(admin: SupabaseClient, path: string | null, inline = true): Promise<Response> {
  const url = path ? await signFilesObject(admin, path, 120, inline ? undefined : { download: true }) : null
  if (!url) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: PRIVATE_HEADERS })
  return new Response(null, { status: 302, headers: { Location: url, ...PRIVATE_HEADERS } })
}
