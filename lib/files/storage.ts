export const FILES_BUCKET = 'project-files'

/** Safe for storage keys and for Safari FormData uploads (ASCII-only segment). */
export function sanitizeFilenameForUpload(filename: string): string {
  const trimmed = filename.trim()
  const withoutPath = trimmed.replace(/[\\/]/g, '_')
  return withoutPath
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9._-]/g, '')
}

function extensionFromFilename(filename: string): string {
  const i = filename.lastIndexOf('.')
  if (i <= 0 || i >= filename.length - 1) return ''
  const ext = filename
    .slice(i + 1)
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase()
  return ext.length > 0 && ext.length <= 16 ? ext : ''
}

/** Server/client: normalize an original filename for storage keys (same rules as multipart names). */
export function safeUploadFilename(filename: string, fallbackBase: string): string {
  let safe =
    sanitizeFilenameForUpload(filename) ||
    `${fallbackBase.replace(/[^A-Za-z0-9_-]/g, '_')}.${extensionFromFilename(filename) || 'bin'}`
  if (safe.length > 200) safe = safe.slice(0, 200)
  return safe
}

/**
 * ASCII-safe multipart filename for uploads. Use with
 * `formData.append('file', fileOrBlob, multipartFilenameForUpload(...))` — especially on iOS
 * Safari, which can throw "The string did not match the expected pattern" when using
 * `new File([...], name)` + FormData.
 */
export function multipartFilenameForUpload(file: File, fallbackBase: string): string {
  return safeUploadFilename(file.name, fallbackBase)
}

function sanitizeFilename(filename: string): string {
  return sanitizeFilenameForUpload(filename)
}

function buildStoredFileName(recordId: string, originalFilename: string) {
  const safe = sanitizeFilename(originalFilename) || 'file'
  return `${recordId}_${safe}`
}

export function buildJobPhotoStoragePath(args: {
  orgId: string
  jobId: string
  photoId: string
  filename: string
}) {
  const finalName = buildStoredFileName(args.photoId, args.filename)
  return `${args.orgId}/jobs/${args.jobId}/photos/${finalName}`
}

/** A service visit's photos (visits have no job): `<org>/visits/<visit>/photos/<id>-<name>`. */
export function buildVisitPhotoStoragePath(args: { orgId: string; visitId: string; photoId: string; filename: string }) {
  return `${visitPhotoFolder(args.orgId, args.visitId)}/${buildStoredFileName(args.photoId, args.filename)}`
}

export function visitPhotoFolder(orgId: string, visitId: string): string {
  return `${orgId}/visits/${visitId}/photos`
}

export function buildJobDocumentStoragePath(args: {
  orgId: string
  jobId: string
  documentId: string
  filename: string
  folder?: 'documents' | 'contracts' | 'change_orders'
}) {
  const finalName = buildStoredFileName(args.documentId, args.filename)
  const folder = args.folder || 'documents'
  return `${args.orgId}/jobs/${args.jobId}/${folder}/${finalName}`
}

export function buildCustomerDocumentStoragePath(args: {
  orgId: string
  customerId: string
  documentId: string
  filename: string
}) {
  const finalName = buildStoredFileName(args.documentId, args.filename)
  return `${args.orgId}/customers/${args.customerId}/documents/${finalName}`
}

/**
 * A signed document brought over from another signing tool (Move signed documents). It lives under the company's
 * `imports/` folder, NOT a customer folder: the customer is only known after the owner confirms the match, and
 * `documents.storage_path` never changes, so the same path serves a document that is still waiting for a customer.
 */
export function buildImportedDocumentStoragePath(args: { orgId: string; documentId: string; filename: string }) {
  return `${args.orgId}/imports/${buildStoredFileName(args.documentId, args.filename)}`
}

export function buildCostAttachmentStoragePath(args: {
  orgId: string
  jobId: string
  attachmentId: string
  filename: string
}) {
  const finalName = buildStoredFileName(args.attachmentId, args.filename)
  return `${args.orgId}/jobs/${args.jobId}/costs/${finalName}`
}

/**
 * The legacy `job-files` bucket keeps a company's objects under `orgs/<org id>/…`. Server routes read/write it with the
 * service client (no member storage policies), so a key is only ever signed / removed when it sits in the caller's own
 * company folder — a stored or posted key naming another company (or using `..`) is refused.
 */
export function jobFilesKeyInOrg(key: unknown, orgId: string): boolean {
  if (typeof key !== 'string' || !orgId) return false
  if (key.includes('..') || key.includes('\\')) return false
  return key.startsWith(`orgs/${orgId}/`) && key.length > `orgs/${orgId}/`.length
}
