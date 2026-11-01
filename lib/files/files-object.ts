/**
 * The `files` Supabase storage bucket — how the app links to an object in it.
 *
 * Phase 1 of making the bucket private (2026-11): every read goes through an authorized route that redirects to a short-lived
 * signed URL, instead of the bucket's public URL. The bucket itself is still public and writers still store full public URLs
 * (`order_form_contracts.pdf_url`, `job_change_orders.pdf_url`, `proposals.cover_image_url`, `orgs.logo_url`), so this module
 * turns whatever is stored — a full public URL or a bare path — back into a storage path.
 *
 * - Staff + subs:  `filesObjectHref(urlOrPath)` → `/api/files/object?path=…` (auth + org/sub check, then a 10-minute signed URL).
 * - Customers:     `customerSignedDocPath(kind, token)` → `/api/files/signed/<kind>/<token>` (signing token, signed docs only).
 *
 * Client-safe: no server imports. `signFilesObject` takes the service client as an argument so this file never pulls the
 * service-role client into a browser bundle.
 *
 * TODO (before the bucket is flipped private): the org logo (`orgs.logo_url` / `orgs.settings.logo_url`, read by
 * components/Nav.tsx, app/admin/settings/page.tsx and the browser-side proposal PDF) is still read by its public URL. It is not
 * sensitive; move it to a public assets bucket rather than signing it on every page load.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveAppUrl } from '@/lib/job-trades'

/** NOTE: not `FILES_BUCKET` in lib/files/storage.ts — that one is the private `project-files` bucket. */
export const FILES_OBJECT_BUCKET = 'files'

/** Signed URLs handed out by the read routes live this long. */
export const FILES_SIGNED_URL_TTL_SECONDS = 60 * 10

const MAX_PATH_LENGTH = 1024
const STORAGE_OBJECT_PATH_RE = /^\/storage\/v1\/(?:object|render\/image)\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/

/** A storage path we are willing to sign: relative, no empty / dot segments, no control characters or backslashes. */
export function isSafeFilesPath(path: string): boolean {
  if (!path || path.length > MAX_PATH_LENGTH) return false
  if (/[\u0000-\u001f\u007f\\]/.test(path)) return false
  const segments = path.split('/')
  return segments.every((s) => s.length > 0 && s !== '.' && s !== '..')
}

function configuredSupabaseOrigin(supabaseUrl: string | null | undefined): string | null {
  if (!supabaseUrl) return null
  try {
    return new URL(supabaseUrl).origin
  } catch {
    return null
  }
}

/**
 * Storage path of a `files`-bucket object from a stored value: a full Supabase storage URL (public / sign / render, any query
 * string such as `?t=` dropped, percent-encoding decoded) or a bare path (passed through, query dropped). Null for empty input,
 * other buckets, foreign hosts, site-relative URLs and anything unsafe.
 */
export function filesPathFromStoredUrl(
  urlOrPath: string | null | undefined,
  supabaseUrl: string | null | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL
): string | null {
  const raw = String(urlOrPath ?? '').trim()
  if (!raw) return null

  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return null
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    const origin = configuredSupabaseOrigin(supabaseUrl)
    if (origin ? url.origin !== origin : !url.hostname.endsWith('.supabase.co')) return null
    const m = STORAGE_OBJECT_PATH_RE.exec(url.pathname)
    if (!m || m[1] !== FILES_OBJECT_BUCKET) return null
    let decoded: string
    try {
      decoded = m[2].split('/').map((s) => decodeURIComponent(s)).join('/')
    } catch {
      return null
    }
    return isSafeFilesPath(decoded) ? decoded : null
  }

  if (raw.startsWith('/') || raw.startsWith('//')) return null
  const path = raw.split(/[?#]/)[0]
  return isSafeFilesPath(path) ? path : null
}

/** Same-origin link to a `files` object through the authorized read route, or null when the value is not one. */
export function filesObjectHref(urlOrPath: string | null | undefined): string | null {
  const path = filesPathFromStoredUrl(urlOrPath)
  return path ? `/api/files/object?path=${encodeURIComponent(path)}` : null
}

/**
 * Link for a stored document that has both a path column and a stored URL (contracts, change orders). Prefers the path; when
 * the stored URL points somewhere other than the `files` bucket (e.g. the old `contracts`-bucket upload fallback) it is
 * returned unchanged, as today, because the path alone does not say which bucket it is in.
 */
export function filesDocHref(storagePath: string | null | undefined, storedUrl: string | null | undefined): string | null {
  const url = String(storedUrl ?? '').trim()
  if (url && /^https?:\/\//i.test(url) && !filesPathFromStoredUrl(url)) return url
  return filesObjectHref(storagePath) ?? filesObjectHref(url)
}

/* ------------------------------------------------------------------------ *
 * Which part of the bucket a path is in (pure; the read route adds the DB checks)
 * ------------------------------------------------------------------------ */

export type FilesPathClass =
  /** org/<orgId>/<area>/… — `area` is the third segment (`contracts`, `change-orders`, `projects`, `logo.png`, …). */
  | { kind: 'org'; orgId: string; area: string; segments: string[] }
  /** proposals/<orgId>/<proposalId>/<image> — proposal cover / inspection images. */
  | { kind: 'proposal_image'; orgId: string }
  /** change-orders/<id>/<file>.pdf — pre-org-prefix change orders. */
  | { kind: 'legacy_change_order' }
  /** <orgId>/jobs/<jobId>/job-packet-<ts>.pdf — written by the two job-packet routes. */
  | { kind: 'job_packet'; orgId: string; jobId: string }
  /** work-orders/<workOrderId>/<photo> — sub completion photos that fell back to this bucket (work_order_photos.storage_path = `files/<path>`). */
  | { kind: 'work_order_photo' }
  /** Anything else (old `<uuid>/<file>` uploads): readable only through a `files` table row. */
  | { kind: 'other' }

export function classifyFilesPath(path: string): FilesPathClass {
  const s = path.split('/')
  if (s[0] === 'org' && s.length >= 3) return { kind: 'org', orgId: s[1], area: s[2], segments: s }
  if (s[0] === 'proposals' && s.length >= 4) return { kind: 'proposal_image', orgId: s[1] }
  if (s[0] === 'change-orders' && s.length >= 3) return { kind: 'legacy_change_order' }
  if (s.length === 4 && s[1] === 'jobs' && s[3].startsWith('job-packet-')) return { kind: 'job_packet', orgId: s[0], jobId: s[2] }
  if (s[0] === 'work-orders' && s.length >= 3) return { kind: 'work_order_photo' }
  return { kind: 'other' }
}

/**
 * Field roles (setters, canvassers, inside sales / call center) never see production or money (CLAUDE.md, 2026-10-24) and are
 * barred from contracts, proposals and design PDFs. Under org/<org>/ they may read only opportunity attachments that are not
 * contracts or design PDFs, and the org logo. Proposal images are photos of the house, not pricing. Everything else is denied.
 */
export function fieldRoleMayReadFilesPath(c: FilesPathClass): boolean {
  if (c.kind === 'proposal_image') return true
  if (c.kind !== 'org') return false
  if (c.segments.length === 3 && c.area.startsWith('logo.')) return true
  if (c.area === 'opportunities') {
    const sub = c.segments[4]
    return c.segments.length >= 5 && sub !== 'contracts' && sub !== 'design'
  }
  return false
}

/* ------------------------------------------------------------------------ *
 * Customer download links (signing token, no login)
 * ------------------------------------------------------------------------ */

export const SIGNED_DOC_KINDS = ['contract', 'change-order'] as const
export type SignedDocKind = (typeof SIGNED_DOC_KINDS)[number]

export function isSignedDocKind(v: string): v is SignedDocKind {
  return (SIGNED_DOC_KINDS as readonly string[]).includes(v)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX64_RE = /^[0-9a-f]{64}$/i

/** Cheap shape check before any DB query: contract tokens are UUIDs, change-order tokens 32 random bytes as hex. */
export function isPlausibleSigningToken(kind: SignedDocKind, token: string): boolean {
  return kind === 'contract' ? UUID_RE.test(token) : HEX64_RE.test(token)
}

export function customerSignedDocPath(kind: SignedDocKind, token: string): string {
  return `/api/files/signed/${kind}/${encodeURIComponent(token)}`
}

/** Absolute form for customer emails. */
export function customerSignedDocUrl(kind: SignedDocKind, token: string, appUrl?: string | null): string {
  return `${resolveAppUrl(appUrl).replace(/\/$/, '')}${customerSignedDocPath(kind, token)}`
}

/* ------------------------------------------------------------------------ *
 * Server: sign
 * ------------------------------------------------------------------------ */

/** Short-lived signed URL for a `files` object. Pass the service client (server only). Null when it cannot be signed. */
export async function signFilesObject(
  admin: SupabaseClient,
  path: string,
  ttlSeconds: number = FILES_SIGNED_URL_TTL_SECONDS
): Promise<string | null> {
  if (!isSafeFilesPath(path)) return null
  const { data, error } = await admin.storage.from(FILES_OBJECT_BUCKET).createSignedUrl(path, ttlSeconds)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}
