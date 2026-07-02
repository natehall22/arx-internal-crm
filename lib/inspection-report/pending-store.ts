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
