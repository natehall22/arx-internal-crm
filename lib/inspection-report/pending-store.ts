/**
 * IndexedDB stash for photo bytes that haven't reached the server yet.
 *
 * Mobile Safari doesn't reliably fire beforeunload and evicts backgrounded tabs, so
 * in-memory bytes alone would silently lose a rep's photos on a bad-signal roof. The
 * standalone builder kept everything in IndexedDB; this preserves that safety net for
 * exactly the window where it matters — between capture and upload confirmation.
 */

const DB_NAME = 'arx-report-pending'
const STORE = 'photos'

interface PendingPhoto {
  key: string // `${reportId}/${photoId}`
  reportId: string
  photoId: string
  bytes: Uint8Array
  width: number | null
  height: number | null
}

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1)
    r.onupgradeneeded = () => {
      const db = r.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' })
        store.createIndex('reportId', 'reportId')
      }
    }
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

export async function stashPendingPhoto(
  reportId: string,
  photoId: string,
  bytes: Uint8Array,
  width: number | null,
  height: number | null
): Promise<void> {
  try {
    const db = await open()
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite')
      const rec: PendingPhoto = { key: `${reportId}/${photoId}`, reportId, photoId, bytes, width, height }
      tx.objectStore(STORE).put(rec)
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    })
  } catch (e) {
    console.warn('pending-store stash failed', e) // non-fatal: memory copy still exists
  }
}

export async function removePendingPhoto(reportId: string, photoId: string): Promise<void> {
  try {
    const db = await open()
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(`${reportId}/${photoId}`)
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    })
  } catch {
    // non-fatal — a leftover stash re-uploads idempotently next visit
  }
}

export async function listPendingPhotos(
  reportId: string
): Promise<{ photoId: string; bytes: Uint8Array; width: number | null; height: number | null }[]> {
  try {
    const db = await open()
    return await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly')
      const rq = tx.objectStore(STORE).index('reportId').getAll(reportId)
      rq.onsuccess = () =>
        res(
          (rq.result as PendingPhoto[]).map((p) => ({
            photoId: p.photoId,
            bytes: p.bytes,
            width: p.width,
            height: p.height,
          }))
        )
      rq.onerror = () => rej(rq.error)
    })
  } catch {
    return []
  }
}

/** Every stashed photo on this phone, any report (the domain hand-off sends them all before leaving this address). */
export async function listAllPendingPhotos(): Promise<
  { reportId: string; photoId: string; bytes: Uint8Array; width: number | null; height: number | null }[]
> {
  if (typeof indexedDB === 'undefined') return []
  const db = await open()
  return await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly')
    const rq = tx.objectStore(STORE).getAll()
    rq.onsuccess = () =>
      res(
        (rq.result as PendingPhoto[]).map((p) => ({
          reportId: p.reportId,
          photoId: p.photoId,
          bytes: p.bytes,
          width: p.width,
          height: p.height,
        }))
      )
    rq.onerror = () => rej(rq.error)
  })
}

/**
 * The ONE upload request for a report photo (the builder's queue and the domain hand-off both use it). The server is
 * idempotent on the photo id, so a re-send after a dropped response returns the photo that already landed.
 */
export function uploadReportPhoto(
  reportId: string,
  photo: { photoId: string; bytes: Uint8Array; width: number | null; height: number | null }
): Promise<Response> {
  const fd = new FormData()
  fd.set('id', photo.photoId)
  fd.set('file', new Blob([photo.bytes as BlobPart], { type: 'image/jpeg' }), `${photo.photoId}.jpg`)
  if (photo.width) fd.set('width', String(photo.width))
  if (photo.height) fd.set('height', String(photo.height))
  return fetch(`/api/inspection-reports/${reportId}/photos`, { method: 'POST', body: fd })
}
