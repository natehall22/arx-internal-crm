/**
 * Browser side of a service-visit photo: register → straight to storage → finalize, through the same three steps as
 * job photos (`UploadSteps`, lib/job-photo-queue.ts). `base` is the visit's photo API: `/api/ops/visits/<id>/photos`
 * (office, signed in) or `/api/crew/day/<token>/visits/<id>/photos` (crew phone link). Client only.
 */
import type { UploadSteps } from '@/lib/job-photo-queue'
import { shrinkImage } from '@/lib/photo-shrink'
import { createClientBrowser } from '@/lib/supabase/client'

async function post(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Upload failed — try again')
  return data
}

export function visitPhotoUploadSteps(base: string, photoTag?: string): UploadSteps {
  const supabase = createClientBrowser()
  return {
    async register(_id, filename) {
      const b = await post(`${base}/register`, { filename })
      return { photoId: String(b.photoId), storagePath: String(b.storagePath), bucket: String(b.bucket), signedUploadToken: String(b.signedUploadToken) }
    },
    async upload(reg, blob, mime) {
      const { error } = await supabase.storage.from(reg.bucket).uploadToSignedUrl(reg.storagePath, reg.signedUploadToken, blob, { contentType: mime || 'application/octet-stream' })
      if (error) throw new Error(error.message)
    },
    async finalize(_id, body) {
      return post(`${base}/finalize`, { photoId: body.photoId, mime_type: body.mime_type, file_size: body.file_size, ...(photoTag ? { photo_tag: photoTag } : {}) })
    },
  }
}

/** Upload photos one after another; stops at the first failure and says which. Returns how many went up. */
export async function uploadVisitPhotos(base: string, files: File[]): Promise<{ uploaded: number; error: string | null }> {
  const steps = visitPhotoUploadSteps(base)
  let uploaded = 0
  for (const file of files) {
    try {
      const blob = await shrinkImage(file)
      const mime = blob.type || file.type || 'image/jpeg'
      const name = mime === 'image/jpeg' && !/\.jpe?g$/i.test(file.name) ? `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg` : file.name || 'photo.jpg'
      const reg = await steps.register('', name)
      await steps.upload(reg, blob, mime)
      await steps.finalize('', { photoId: reg.photoId, photo_tag: 'visit', mime_type: mime, file_size: blob.size, work_order_id: null })
      uploaded += 1
    } catch (e) {
      return { uploaded, error: e instanceof Error ? e.message : 'Upload failed — try again' }
    }
  }
  return { uploaded, error: null }
}

/**
 * Upload photos under one tag (the daily log: tag `daily_log`) and hand back their ids. `base` is a job photo API with
 * `/register` and `/finalize` under it: `/api/ops/jobs/<id>/photos` (office) or `/api/crew/<token>/photos` (crew link).
 * Stops at the first failure; ids of the ones that went up are still returned.
 */
export async function uploadTaggedPhotos(base: string, files: File[], tag: string): Promise<{ ids: string[]; error: string | null }> {
  const steps = visitPhotoUploadSteps(base, tag)
  const ids: string[] = []
  for (const file of files) {
    try {
      const blob = await shrinkImage(file)
      const mime = blob.type || file.type || 'image/jpeg'
      const name = mime === 'image/jpeg' && !/\.jpe?g$/i.test(file.name) ? `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg` : file.name || 'photo.jpg'
      const reg = await steps.register('', name)
      await steps.upload(reg, blob, mime)
      await steps.finalize('', { photoId: reg.photoId, photo_tag: tag, mime_type: mime, file_size: blob.size, work_order_id: null })
      ids.push(reg.photoId)
    } catch (e) {
      return { ids, error: e instanceof Error ? e.message : 'Upload failed — try again' }
    }
  }
  return { ids, error: null }
}
