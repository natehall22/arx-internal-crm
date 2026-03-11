export const FILES_BUCKET = 'project-files'

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim()
  const withoutPath = trimmed.replace(/[\\/]/g, '_')
  return withoutPath
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9._-]/g, '')
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
