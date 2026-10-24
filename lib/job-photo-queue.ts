/**
 * Job photos survive a bad signal. A photo is saved on the phone FIRST (IndexedDB) and then uploaded
 * (register -> storage -> finalize, the same three steps as before); if the network is down the photo waits and is retried when
 * the phone is back online or the page is opened again. Finalize is idempotent, so a retry after a dropped response is safe.
 * The store and the three network steps are injected so the logic is tested without a browser.
 */
export type QueuedPhoto = {
  id: string
  jobId: string
  tag: string | null
  workOrderId: string | null
  filename: string
  mime: string | null
  size: number
  createdAt: number
  attempts: number
  lastError: string | null
  blob: Blob
}

export interface PhotoQueueStore {
  put(item: QueuedPhoto): Promise<void>
  list(jobId?: string): Promise<QueuedPhoto[]>
  remove(id: string): Promise<void>
  update(id: string, patch: Partial<Pick<QueuedPhoto, 'attempts' | 'lastError'>>): Promise<void>
}

export type UploadSteps = {
  register(jobId: string, filename: string): Promise<{ photoId: string; storagePath: string; bucket: string; signedUploadToken: string }>
  upload(reg: { storagePath: string; bucket: string; signedUploadToken: string }, blob: Blob, mime: string | null): Promise<void>
  finalize(jobId: string, body: { photoId: string; photo_tag: string | null; mime_type: string | null; file_size: number; work_order_id: string | null }): Promise<unknown>
}

/** After this many failed tries a photo stops retrying on its own and shows as failed (the person can retry or remove it). */
export const MAX_ATTEMPTS = 6

/** True for "no network" style failures: keep the photo and try again later without counting an attempt. */
export function isOfflineError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const msg = error instanceof Error ? error.message : String(error)
  return error instanceof TypeError || /failed to fetch|network|load failed|offline|timed out/i.test(msg)
}

export async function enqueuePhotos(
  store: PhotoQueueStore,
  items: Array<{ jobId: string; file: Blob & { name?: string }; tag: string | null; workOrderId: string | null; filename: string }>,
  now = Date.now()
): Promise<QueuedPhoto[]> {
  const out: QueuedPhoto[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const q: QueuedPhoto = {
      id: `${now}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      jobId: it.jobId, tag: it.tag, workOrderId: it.workOrderId, filename: it.filename,
      mime: it.file.type || null, size: it.file.size, createdAt: now + i, attempts: 0, lastError: null, blob: it.file,
    }
    await store.put(q)
    out.push(q)
  }
  return out
}

export type FlushResult = { uploaded: number; failed: number; remaining: number; offline: boolean }

export async function flushPhotoQueue(
  store: PhotoQueueStore,
  steps: UploadSteps,
  opts: { jobId?: string; onUploaded?: (item: QueuedPhoto, photo: unknown) => void } = {}
): Promise<FlushResult> {
  const items = (await store.list(opts.jobId)).sort((a, b) => a.createdAt - b.createdAt)
  let uploaded = 0
  let failed = 0
  let offline = false
  for (const item of items) {
    if (item.attempts >= MAX_ATTEMPTS) { failed++; continue }
    try {
      const reg = await steps.register(item.jobId, item.filename)
      await steps.upload(reg, item.blob, item.mime)
      const photo = await steps.finalize(item.jobId, { photoId: reg.photoId, photo_tag: item.tag, mime_type: item.mime, file_size: item.size, work_order_id: item.workOrderId })
      await store.remove(item.id)
      uploaded++
      opts.onUploaded?.(item, photo)
    } catch (error) {
      if (isOfflineError(error)) { offline = true; break } // keep everything, stop; try again when back online
      failed++
      await store.update(item.id, { attempts: item.attempts + 1, lastError: error instanceof Error ? error.message : 'Upload failed' })
    }
  }
  const remaining = (await store.list(opts.jobId)).length
  return { uploaded, failed, remaining, offline }
}

export function memoryPhotoStore(): PhotoQueueStore {
  const rows = new Map<string, QueuedPhoto>()
  return {
    async put(item) { rows.set(item.id, item) },
    async list(jobId) { return Array.from(rows.values()).filter((r) => !jobId || r.jobId === jobId) },
    async remove(id) { rows.delete(id) },
    async update(id, patch) { const r = rows.get(id); if (r) rows.set(id, { ...r, ...patch }) },
  }
}

const DB = 'arx-job-photos'
const STORE = 'queue'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const r = run(t.objectStore(STORE))
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
        t.oncomplete = () => db.close()
      })
  )
}

/** The real store, in the browser. */
export function indexedDbPhotoStore(): PhotoQueueStore {
  return {
    put: async (item) => { await tx('readwrite', (s) => s.put(item)) },
    list: async (jobId) => ((await tx('readonly', (s) => s.getAll())) as QueuedPhoto[]).filter((r) => !jobId || r.jobId === jobId),
    remove: async (id) => { await tx('readwrite', (s) => s.delete(id)) },
    update: async (id, patch) => {
      const cur = (await tx('readonly', (s) => s.get(id))) as QueuedPhoto | undefined
      if (cur) await tx('readwrite', (s) => s.put({ ...cur, ...patch }))
    },
  }
}
