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

/**
 * Safari (esp. iOS) can throw "The string did not match the expected pattern" when posting
 * FormData with File objects whose names contain non-ASCII or problematic Unicode. Use a File
 * with an ASCII-only name while preserving bytes and MIME hints.
 */
export function fileWithSafeName(file: File, fallbackBase: string): File {
  let safe =
    sanitizeFilenameForUpload(file.name) ||
    `${fallbackBase.replace(/[^A-Za-z0-9_-]/g, '_')}.${extensionFromFilename(file.name) || 'bin'}`
  if (safe.length > 200) safe = safe.slice(0, 200)
  if (safe === file.name) return file
  return new File([file], safe, {
    type: file.type || 'application/octet-stream',
    lastModified: file.lastModified,
  })
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

export function buildCostAttachmentStoragePath(args: {
  orgId: string
  jobId: string
  attachmentId: string
  filename: string
}) {
  const finalName = buildStoredFileName(args.attachmentId, args.filename)
  return `${args.orgId}/jobs/${args.jobId}/costs/${finalName}`
}
