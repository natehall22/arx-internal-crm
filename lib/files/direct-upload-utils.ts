import type { SupabaseClient } from '@supabase/supabase-js'

type FileMeta = { size?: number; mimetype?: string }

/**
 * Locate `{recordId}_{sanitizedName}` in a storage folder (after browser direct upload).
 * Uses list `search` prefix to avoid scanning huge folders.
 */
export async function findStorageObjectByRecordPrefix(
  supabase: SupabaseClient,
  bucket: string,
  folderPath: string,
  recordId: string
): Promise<{
  storagePath: string
  objectName: string
  size: number | null
  mimeType: string | null
  displayFilename: string
} | null> {
  const keyPrefix = `${recordId}_`
  let items =
    (
      await supabase.storage.from(bucket).list(folderPath, {
        search: keyPrefix,
        limit: 50,
      })
    ).data ?? null
  let obj = items?.find((i) => i.name.startsWith(keyPrefix)) ?? null
  // Some storage backends ignore `search` for UUID-like prefixes; fall back to a bounded scan.
  if (!obj) {
    const { data: wide, error: wideErr } = await supabase.storage.from(bucket).list(folderPath, {
      limit: 1000,
    })
    if (wideErr || !wide?.length) return null
    obj = wide.find((i) => i.name.startsWith(keyPrefix)) ?? null
  }
  if (!obj) return null
  const meta = (obj.metadata || null) as FileMeta | null
  const size = typeof meta?.size === 'number' ? meta.size : null
  const mimeType = typeof meta?.mimetype === 'string' ? meta.mimetype : null
  return {
    storagePath: `${folderPath}/${obj.name}`,
    objectName: obj.name,
    size,
    mimeType,
    displayFilename: obj.name.slice(keyPrefix.length) || 'file',
  }
}
