/**
 * Move signed documents — what a file may be, and what it is called. Pure and client-safe (the browser and the server
 * apply the SAME rules; the server never trusts what the browser said).
 *
 * Nothing in here is ever run or opened: names are labels only (never a path on disk — storage paths are built from ids,
 * lib/files/storage.ts `buildImportedDocumentStoragePath`), and a "PDF" is a file whose first bytes say so.
 */

export const SIGNED_IMPORT_SOURCES = ['docusign', 'dropbox_sign', 'pandadoc', 'other'] as const
export type SignedImportSource = (typeof SIGNED_IMPORT_SOURCES)[number]

export const SIGNED_IMPORT_SOURCE_LABELS: Record<SignedImportSource, string> = {
  docusign: 'DocuSign',
  dropbox_sign: 'Dropbox Sign',
  pandadoc: 'PandaDoc',
  other: 'another signing tool',
}

export function isSignedImportSource(v: unknown): v is SignedImportSource {
  return typeof v === 'string' && (SIGNED_IMPORT_SOURCES as readonly string[]).includes(v)
}

/** The one line shown on every imported document (counsel's wording is a pre-launch item, docs/signed-documents-import.md). */
export function signedOutsideLabel(source: string | null | undefined): string {
  const tool = isSignedImportSource(source) ? SIGNED_IMPORT_SOURCE_LABELS[source] : SIGNED_IMPORT_SOURCE_LABELS.other
  return `Signed in ${tool}, outside this system. Any certificate is the original tool’s.`
}

export const MAX_PDF_BYTES = 25 * 1024 * 1024
export const MAX_CSV_BYTES = 4 * 1024 * 1024
/** One import run holds at most this many PDFs (a big company imports in several runs). */
export const MAX_RUN_PDFS = 3000
/** Files per `register` request. */
export const REGISTER_BATCH = 40

export type ZipLimits = {
  /** Entries looked at in one ZIP (folders and junk included). */
  maxEntries: number
  /** Bytes of ONE file after unzipping. Counted while it unzips, never taken from the ZIP's own header (headers can lie). */
  maxEntryBytes: number
  /** Bytes unzipped in total, counting the ones thrown away half way — bounds the work a bomb can make us do. */
  maxWorkBytes: number
  /** Bytes of the PDFs and CSVs kept from one ZIP. */
  maxKeptBytes: number
}
export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 20_000,
  maxEntryBytes: MAX_PDF_BYTES,
  maxWorkBytes: 4 * 1024 * 1024 * 1024,
  maxKeptBytes: 2 * 1024 * 1024 * 1024,
}

export type EntryKind = 'pdf' | 'csv'

/** Files every tool leaves in a ZIP that mean nothing: not shown, not counted. */
export function isZipJunk(path: string): boolean {
  const p = path.replace(/\\/g, '/')
  const base = p.split('/').pop() ?? ''
  return p.endsWith('/') || /(^|\/)__MACOSX\//.test(p) || base.startsWith('._') || base === '.DS_Store' || base.toLowerCase() === 'thumbs.db' || base.toLowerCase() === 'desktop.ini'
}

/**
 * Is this entry name safe to use as a LABEL? Refuses `..` segments, absolute paths, drive letters, NUL / control
 * characters and absurd lengths (the "zip slip" shapes). We never write a ZIP entry to a disk path at all; refusing the
 * name anyway means a hostile ZIP is reported, not half-read.
 */
export function unsafeEntryReason(path: string): string | null {
  if (path.length === 0 || path.length > 512) return 'name too long'
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return 'unsafe name'
  const p = path.replace(/\\/g, '/')
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.startsWith('//')) return 'unsafe path'
  if (p.split('/').some((seg) => seg === '..')) return 'unsafe path'
  return null
}

/** What the file name says it is (ZIP inside ZIP and everything else is refused with a reason a person can read). */
export function entryKind(path: string): { kind: EntryKind } | { skip: string } {
  const ext = /\.([a-z0-9]{1,6})$/i.exec(path.trim())?.[1]?.toLowerCase() ?? ''
  if (ext === 'pdf') return { kind: 'pdf' }
  if (ext === 'csv') return { kind: 'csv' }
  if (ext === 'zip') return { skip: 'a ZIP inside a ZIP — add it on its own' }
  if (ext === 'xlsx' || ext === 'xls') return { skip: 'a spreadsheet — save it as CSV first' }
  return { skip: ext ? `a .${ext} file — only PDFs are brought over` : 'not a PDF' }
}

/** Shown name: the last part of the path, tidied, never longer than 200. */
export function displayName(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? path
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || 'document.pdf'
}

/** The folder part of a ZIP path ('' for a loose file) — used only to pair a certificate with the agreement beside it. */
export function dirOf(path: string): string {
  const p = path.replace(/\\/g, '/')
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i).slice(0, 300)
}

/** A PDF starts with "%PDF-" (a few tools put up to 1 KB of junk before it, which PDF readers accept). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 1024)
  for (let i = 0; i + 5 <= n; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) return true
  }
  return false
}

export const SHA256_RE = /^[0-9a-f]{64}$/
