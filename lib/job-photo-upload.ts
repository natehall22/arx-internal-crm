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
 * differ in how they authorize and which job/trade they resolve to. Service
 * visits (no job) use the same two steps through {@link registerVisitPhotoUpload}
 * / {@link finalizeVisitPhotoUpload}: their own folder, `job_id` NULL.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { FILES_BUCKET, buildJobPhotoStoragePath, buildVisitPhotoStoragePath, safeUploadFilename, visitPhotoFolder } from '@/lib/files/storage'
import { signedUploadTokenForPath } from '@/lib/files/signed-upload'
import { findStorageObjectByRecordPrefix } from '@/lib/files/direct-upload-utils'

type Registered = { photoId: string; storagePath: string; bucket: string; signedUploadToken: string } | { error: string; status: number }

async function registerPhoto(admin: SupabaseClient, filename: string, pathFor: (photoId: string, safeName: string) => string): Promise<Registered> {
  if (!filename.trim()) return { error: 'filename is required', status: 400 }
  const photoId = crypto.randomUUID()
  const storagePath = pathFor(photoId, safeUploadFilename(filename, 'photo'))
  const signed = await signedUploadTokenForPath(admin, FILES_BUCKET, storagePath)
  if ('error' in signed) return { error: signed.error, status: 500 }
  return { photoId, storagePath, bucket: FILES_BUCKET, signedUploadToken: signed.token }
}

export async function registerJobPhotoUpload(admin: SupabaseClient, args: { orgId: string; jobId: string; filename: string }): Promise<Registered> {
  return registerPhoto(admin, args.filename, (photoId, filename) => buildJobPhotoStoragePath({ orgId: args.orgId, jobId: args.jobId, photoId, filename }))
}

/** A service visit's photo (no job): its own folder under the visit. */
export async function registerVisitPhotoUpload(admin: SupabaseClient, args: { orgId: string; visitId: string; filename: string }): Promise<Registered> {
  return registerPhoto(admin, args.filename, (photoId, filename) => buildVisitPhotoStoragePath({ orgId: args.orgId, visitId: args.visitId, photoId, filename }))
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
  return finalizePhoto(admin, `${args.orgId}/jobs/${args.jobId}/photos`, { ...args, jobId: args.jobId })
}

/** Records a service visit's photo (`job_id` NULL, `work_order_id` = the visit) once it is in the visit's folder. */
export async function finalizeVisitPhotoUpload(
  admin: SupabaseClient,
  args: { orgId: string; visitId: string; photoId: string; photoTag: string | null; mimeType: string | null; fileSize: number | null; uploadedBy: string | null }
): Promise<{ photo: Record<string, unknown> } | { error: string; status: number }> {
  return finalizePhoto(admin, visitPhotoFolder(args.orgId, args.visitId), { ...args, jobId: null, workOrderId: args.visitId })
}

async function finalizePhoto(
  admin: SupabaseClient,
  folderPath: string,
  args: { orgId: string; jobId: string | null; photoId: string; photoTag: string | null; mimeType: string | null; fileSize: number | null; uploadedBy: string | null; workOrderId?: string | null }
): Promise<{ photo: Record<string, unknown> } | { error: string; status: number }> {
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
      let again = admin.from('photos').select('*').eq('id', args.photoId).eq('org_id', args.orgId)
      again = args.jobId ? again.eq('job_id', args.jobId) : again.is('job_id', null).eq('work_order_id', args.workOrderId ?? '')
      const { data: existing } = await again.maybeSingle()
      if (existing) return { photo: existing }
    }
    await admin.storage.from(FILES_BUCKET).remove([found.storagePath])
    return { error: error?.message || 'Failed to save photo', status: 500 }
  }

  return { photo }
}
