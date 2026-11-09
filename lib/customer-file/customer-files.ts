import { FILES_OBJECT_BUCKET, isSafeFilesPath, storageSafeFileName } from '@/lib/files/files-object'

/**
 * Files added straight to a customer (Customer account → Files tab). Pure and client-safe; the server access check is
 * ./customer-files-access.ts. Upload is browser → private `files` bucket through a
 * one-time signed upload URL (same pattern as job documents and photos, so big PDFs skip the server body limit), then a
 * `files` row that stores the storage PATH, never a URL. Reads go through GET /api/files/object like every other file.
 *
 * Path: org/<orgId>/customers/<customerId>/<fileId>_<safe name>. `classifyFilesPath` files it under area "customers", which
 * field roles may not read (fieldRoleMayReadFilesPath), so the read rule and the upload rule agree.
 */
export { FILES_OBJECT_BUCKET as CUSTOMER_FILES_BUCKET }

/** Per file. Checked in the browser before upload and again on finalize from the stored object's size. */
export const CUSTOMER_FILE_MAX_BYTES = 50 * 1024 * 1024

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

export function customerFilesFolder(orgId: string, customerId: string): string {
  return `org/${orgId}/customers/${customerId}`
}

export function customerFileStoragePath(args: { orgId: string; customerId: string; fileId: string; fileName: string }): string {
  return `${customerFilesFolder(args.orgId, args.customerId)}/${args.fileId}_${storageSafeFileName(args.fileName)}`
}

/** True only for a path this customer's register step could have issued for this file id. */
export function isCustomerFilePathFor(path: string, args: { orgId: string; customerId: string; fileId: string }): boolean {
  if (!isSafeFilesPath(path)) return false
  const prefix = `${customerFilesFolder(args.orgId, args.customerId)}/${args.fileId}_`
  return path.startsWith(prefix) && path.length > prefix.length && !path.slice(prefix.length).includes('/')
}

/** `files.tag` is an enum (photo | document | proposal | contract | other); uploads here are photos or documents. */
export function customerFileTag(mimeType: string | null | undefined, fileName: string): 'photo' | 'document' {
  if (String(mimeType ?? '').startsWith('image/')) return 'photo'
  return /\.(heic|heif|jpe?g|png|gif|webp|bmp|tiff?)$/i.test(fileName) ? 'photo' : 'document'
}

/** Display name kept on the row (the storage key uses the sanitized one). */
export function customerFileDisplayName(name: unknown): string {
  const s = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return (s || 'file').slice(0, 255)
}
