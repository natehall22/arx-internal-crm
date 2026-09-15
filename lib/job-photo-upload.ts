/**
 * Direct-to-storage job photo upload, in two steps (avoids Vercel's ~4.5MB
 * request body limit — phone photos routinely exceed it):
 *
 *   1. {@link registerJobPhotoUpload} → a photo id + signed upload token; the
 *      browser uploads the file straight to Supabase Storage with it.
 *   2. {@link finalizeJobPhotoUpload} → confirms the object landed in THIS job's
 *      folder and writes the `photos` row.
 *
 * Shared by the ops routes (`/api/ops/jobs/[id]/photos/*`, staff session) and
 * the crew routes (`/api/crew/[token]/photos/*`, trade link) — the callers only
 * differ in how they authorize and which job/trade they resolve to.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { FILES_BUCKET, buildJobPhotoStoragePath, safeUploadFilename } from '@/lib/files/storage'
import { signedUploadTokenForPath } from '@/lib/files/signed-upload'
import { findStorageObjectByRecordPrefix } from '@/lib/files/direct-upload-utils'

export async function registerJobPhotoUpload(
  admin: SupabaseClient,
  args: { orgId: string; jobId: string; filename: string }
): Promise<
  | { photoId: string; storagePath: string; bucket: string; signedUploadToken: string }
  | { error: string; status: number }
> {
  if (!args.filename.trim()) return { error: 'filename is required', status: 400 }

  const photoId = crypto.randomUUID()
  const storagePath = buildJobPhotoStoragePath({
    orgId: args.orgId,
    jobId: args.jobId,
    photoId,
    filename: safeUploadFilename(args.filename, 'photo'),
  })

  const signed = await signedUploadTokenForPath(admin, FILES_BUCKET, storagePath)
  if ('error' in signed) return { error: signed.error, status: 500 }

  return { photoId, storagePath, bucket: FILES_BUCKET, signedUploadToken: signed.token }
}

export async function finalizeJobPhotoUpload(
  admin: SupabaseClient,
  args: {
    orgId: string
    jobId: string
    photoId: string
    photoTag: string | null
    mimeType: string | null
    fileSize: number | null
    /** A staff user id; null for a crew upload through a trade link. */
    uploadedBy: string | null
    /** The trade (work order) the photo documents, when known. */
    workOrderId?: string | null
  }
): Promise<{ photo: Record<string, unknown> } | { error: string; status: number }> {
  const folderPath = `${args.orgId}/jobs/${args.jobId}/photos`
  const found = await findStorageObjectByRecordPrefix(admin, FILES_BUCKET, folderPath, args.photoId)
  if (!found) {
    return { error: 'Upload not found in storage. Try uploading again.', status: 400 }
  }

  const { data: photo, error } = await admin
    .from('photos')
    .insert({
      id: args.photoId,
      org_id: args.orgId,
      job_id: args.jobId,
      work_order_id: args.workOrderId ?? null,
      storage_path: found.storagePath,
      filename: found.displayFilename,
      file_size: found.size ?? args.fileSize,
      mime_type: args.mimeType || found.mimeType,
      photo_tag: args.photoTag || null,
      uploaded_by: args.uploadedBy,
    })
    .select('*')
    .single()

  if (error || !photo) {
    // A duplicate finalize (retry after a dropped response) hits the primary key:
    // the photo is already recorded, so do NOT delete the stored object.
    if (error?.code === '23505') {
      const { data: existing } = await admin
        .from('photos')
        .select('*')
        .eq('id', args.photoId)
        .eq('org_id', args.orgId)
        .eq('job_id', args.jobId)
        .maybeSingle()
      if (existing) return { photo: existing }
    }
    await admin.storage.from(FILES_BUCKET).remove([found.storagePath])
    return { error: error?.message || 'Failed to save photo', status: 500 }
  }

  return { photo }
}
