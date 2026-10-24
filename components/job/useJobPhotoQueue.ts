'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { multipartFilenameForUpload } from '@/lib/files/storage'
import { enqueuePhotos, flushPhotoQueue, MAX_ATTEMPTS, indexedDbPhotoStore, memoryPhotoStore, type UploadSteps } from '@/lib/job-photo-queue'
import { createClientBrowser } from '@/lib/supabase/client'

/** One flush at a time per job across every card on the page, so two cards never upload the same photo twice. */
const flushLocks = new Map<string, Promise<unknown>>()
const UPLOADED_EVENT = 'arx-job-photos-uploaded'

async function json(res: Response) {
  return res.json().catch(() => ({}))
}

/**
 * Photos for one job that survive a bad signal (lib/job-photo-queue.ts). `add` saves them on the phone first, then uploads;
 * anything that could not go waits and is retried when the phone is back online, the tab is shown again, or every 30 seconds.
 * `onUploaded` fires after at least one photo reached the server so the caller can refresh its list.
 */
export function useJobPhotoQueue(jobId: string, onUploaded: () => void, enabled = true) {
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
  const [failed, setFailed] = useState<{ count: number; lastError: string | null }>({ count: 0, lastError: null })
  const [flushing, setFlushing] = useState(false)
  const uploadedCb = useRef(onUploaded)
  uploadedCb.current = onUploaded

  const refresh = useCallback(async () => {
    const list = await store.list(jobId)
    setPending(list.length)
    const bad = list.filter((p) => p.attempts >= MAX_ATTEMPTS)
    setFailed({ count: bad.length, lastError: bad[0]?.lastError ?? null })
  }, [store, jobId])

  const flush = useCallback(async () => {
    const prev = flushLocks.get(jobId) ?? Promise.resolve()
    const run = prev.catch(() => undefined).then(async () => {
      setFlushing(true)
      try {
        const r = await flushPhotoQueue(store, steps, { jobId })
        await refresh()
        if (r.uploaded > 0) window.dispatchEvent(new CustomEvent(UPLOADED_EVENT, { detail: jobId }))
        return r
      } finally {
        setFlushing(false)
      }
    })
    flushLocks.set(jobId, run)
    return run
  }, [store, steps, jobId, refresh])

  // Any card's upload refreshes every card's list (one flushed photo may belong to a different card).
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent).detail === jobId) uploadedCb.current() }
    window.addEventListener(UPLOADED_EVENT, on)
    return () => window.removeEventListener(UPLOADED_EVENT, on)
  }, [jobId])

  const add = useCallback(
    async (files: File[], meta: { tag: string | null; workOrderId: string | null }) => {
      const usable = files.filter((f) => f.size > 0)
      if (usable.length === 0) return null
      try {
        await enqueuePhotos(store, usable.map((file, i) => ({ jobId, file, tag: meta.tag, workOrderId: meta.workOrderId, filename: multipartFilenameForUpload(file, `photo_${i + 1}`) })))
      } catch {
        throw new Error('Could not save the photos on this phone (storage is full or blocked). Free some space and try again.')
      }
      await refresh()
      return flush()
    },
    [store, jobId, flush, refresh]
  )

  /** Failed photos: try them again, or throw them away. */
  const retryFailed = useCallback(async () => {
    for (const p of (await store.list(jobId)).filter((x) => x.attempts >= MAX_ATTEMPTS)) await store.update(p.id, { attempts: 0, lastError: null, reg: null })
    return flush()
  }, [store, jobId, flush])
  const removeFailed = useCallback(async () => {
    for (const p of (await store.list(jobId)).filter((x) => x.attempts >= MAX_ATTEMPTS)) await store.remove(p.id)
    await refresh()
  }, [store, jobId, refresh])

  useEffect(() => {
    if (!enabled) return
    void refresh().then(() => flush())
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
  }, [enabled, refresh, flush])

  return { pending, failed, flushing, add, flush, retryFailed, removeFailed }
}
