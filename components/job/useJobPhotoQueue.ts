'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { multipartFilenameForUpload } from '@/lib/files/storage'
import { enqueuePhotos, flushPhotoQueue, indexedDbPhotoStore, memoryPhotoStore, type UploadSteps } from '@/lib/job-photo-queue'
import { createClientBrowser } from '@/lib/supabase/client'

async function json(res: Response) {
  return res.json().catch(() => ({}))
}

/**
 * Photos for one job that survive a bad signal (lib/job-photo-queue.ts). `add` saves them on the phone first, then uploads;
 * anything that could not go waits and is retried when the phone is back online, the tab is shown again, or every 30 seconds.
 * `onUploaded` fires after at least one photo reached the server so the caller can refresh its list.
 */
export function useJobPhotoQueue(jobId: string, onUploaded: () => void) {
  const store = useMemo(() => (typeof indexedDB === 'undefined' ? memoryPhotoStore() : indexedDbPhotoStore()), [])
  const steps = useMemo<UploadSteps>(() => {
    const supabase = createClientBrowser()
    return {
      async register(id, filename) {
        const res = await fetch(`/api/ops/jobs/${id}/photos/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename }) })
        const body = await json(res)
        if (!res.ok) throw new Error(body.error || 'Failed to start upload')
        return { photoId: String(body.photoId), storagePath: String(body.storagePath), bucket: String(body.bucket), signedUploadToken: String(body.signedUploadToken) }
      },
      async upload(reg, blob, mime) {
        const { error } = await supabase.storage.from(reg.bucket).uploadToSignedUrl(reg.storagePath, reg.signedUploadToken, blob, { contentType: mime || 'application/octet-stream' })
        if (error) throw new Error(error.message)
      },
      async finalize(id, body) {
        const res = await fetch(`/api/ops/jobs/${id}/photos/finalize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const out = await json(res)
        if (!res.ok) throw new Error(out.error || 'Failed to save photo')
        return out
      },
    }
  }, [])

  const [pending, setPending] = useState(0)
  const [flushing, setFlushing] = useState(false)
  const busy = useRef(false)
  const uploadedCb = useRef(onUploaded)
  uploadedCb.current = onUploaded

  const flush = useCallback(async () => {
    if (busy.current) return null
    busy.current = true
    setFlushing(true)
    try {
      const r = await flushPhotoQueue(store, steps, { jobId })
      setPending(r.remaining)
      if (r.uploaded > 0) uploadedCb.current()
      return r
    } finally {
      busy.current = false
      setFlushing(false)
    }
  }, [store, steps, jobId])

  const add = useCallback(
    async (files: File[], meta: { tag: string | null; workOrderId: string | null }) => {
      const usable = files.filter((f) => f.size > 0)
      if (usable.length === 0) return null
      await enqueuePhotos(store, usable.map((file, i) => ({ jobId, file, tag: meta.tag, workOrderId: meta.workOrderId, filename: multipartFilenameForUpload(file, `photo_${i + 1}`) })))
      setPending((await store.list(jobId)).length)
      return flush()
    },
    [store, jobId, flush]
  )

  useEffect(() => {
    void store.list(jobId).then((l) => setPending(l.length)).then(() => flush())
    const onOnline = () => void flush()
    const onVisible = () => { if (document.visibilityState === 'visible') void flush() }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void flush() }, 30_000)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [store, jobId, flush])

  return { pending, flushing, add, flush }
}
