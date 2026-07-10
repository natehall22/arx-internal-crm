'use client'

/**
 * Phone-first roof report builder. Ported from the standalone ARX Roof Report Builder,
 * now CRM-native: prefilled from the opportunity, photos + doc autosaved to the server,
 * PDF generated client-side (pdf-lib) and stored for email / share-link delivery.
 *
 * Desire path: the rep's only real work is photos + captions. Everything else is
 * prefilled and collapsed. Uploads queue and retry silently — usable on a roof with
 * one bar of signal; photos upload whenever signal returns.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClientBrowser } from '@/lib/supabase/client'
import {
  ReportDoc,
  ReportSection,
  reportSlug,
} from '@/lib/inspection-report/types'
import { buildReportPdf, orderedPhotoIds, PDF_SIZE_TARGET, PDF_TIERS } from '@/lib/inspection-report/pdf'
import { processFile, reencodeJpeg } from '@/lib/inspection-report/image-client'
import {
  listPendingPhotos,
  removePendingPhoto,
  stashPendingPhoto,
} from '@/lib/inspection-report/pending-store'

const GOLD = '#B0904E'
const CHARCOAL = '#2B2A28'
const CREAM = '#F4ECDC'
const DARKTEXT = '#2c2c2a'
const LINE = '#e3ddcf'

interface PhotoState {
  id: string
  url: string | null // objectURL (local) or signed URL (server)
  width: number | null
  height: number | null
  uploaded: boolean
  failed: boolean
}

interface Props {
  reportId: string
  opportunityId: string
  shareToken: string
  pdfGeneratedAt: string | null
  pdfSizeBytes: number | null
  lastSentTo: string | null
  updatedAt: string
  initialDoc: ReportDoc
  initialPhotos: { id: string; url: string | null; width: number | null; height: number | null }[]
  customerEmail: string | null
}

/** One-tap captions per section flavor — typing on a roof is the enemy. */
function chipsForSection(s: ReportSection): string[] {
  const t = `${s.dividerTitle} ${s.headerLabel}`.toLowerCase()
  if (t.includes('hail'))
    return [
      'Hail impact — circled and measured',
      'Impact measured with tape for diameter',
      'Soft-metal hail bruising',
      'Multiple impacts on this slope',
    ]
  if (t.includes('wind'))
    return [
      'Wind crease along shingle course',
      'Shingle bond broken at crease line',
      'Lifted / displaced shingle',
    ]
  if (t.includes('penetration') || t.includes('pipe') || t.includes('vent') || t.includes('flashing'))
    return ['Pipe boot — weathered and cracked', 'Hail impact on vent', 'Flashing damage']
  if (t.includes('count'))
    return ['Marked impacts on this slope', 'Test square — impacts circled']
  if (t.includes('overview') || t.includes('gutter') || t.includes('age'))
    return [
      'Granule loss consistent with weathering',
      'Granule accumulation in gutter',
      'General roof condition',
    ]
  return ['Documented condition', 'Close-up of damage']
}

const uid = () => Math.random().toString(36).slice(2, 10)

export default function ReportBuilder(props: Props) {
  const supabase = useMemo(() => createClientBrowser(), [])
  const [doc, setDoc] = useState<ReportDoc>(props.initialDoc)
  const [photos, setPhotos] = useState<Record<string, PhotoState>>(() => {
    const m: Record<string, PhotoState> = {}
    for (const p of props.initialPhotos) {
      m[p.id] = { id: p.id, url: p.url, width: p.width, height: p.height, uploaded: true, failed: false }
    }
    return m
  })
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [busy, setBusy] = useState<string | null>(null)
  const [pdfInfo, setPdfInfo] = useState<{ generatedAt: string; sizeBytes: number | null } | null>(
    props.pdfGeneratedAt ? { generatedAt: props.pdfGeneratedAt, sizeBytes: props.pdfSizeBytes } : null
  )
  const [sentTo, setSentTo] = useState<string | null>(props.lastSentTo)
  const [sendOpen, setSendOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [coverOpen, setCoverOpen] = useState(true)
  const [summaryOpen, setSummaryOpen] = useState(false)

  // ---- refs for async flows ----
  const docRef = useRef(doc)
  docRef.current = doc
  const photosRef = useRef(photos)
  photosRef.current = photos
  const bytesRef = useRef<Map<string, Uint8Array>>(new Map()) // local JPEG bytes (pending + PDF gen cache)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const uploadingRef = useRef(false)
  const lastPdfBytesRef = useRef<Uint8Array | null>(null)
  const aliveRef = useRef(true) // false after unmount — kills zombie autosave retries
  const deletedRef = useRef<Set<string>>(new Set()) // photos deleted while still in the upload queue
  const baseUpdatedAtRef = useRef<string | null>(null) // optimistic-concurrency base for PATCH
  const [missingIds, setMissingIds] = useState<string[]>([])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }, [])

  // ---------------- autosave ----------------
  const savingNowRef = useRef(false)
  const saveDoc = useCallback(async () => {
    if (!aliveRef.current) return // component unmounted — never let a zombie retry win later
    if (savingNowRef.current) return // single-flight; the retry timer re-enters
    savingNowRef.current = true
    setSaveState('saving')
    try {
      const res = await fetch(`/api/inspection-reports/${props.reportId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc: docRef.current, base_updated_at: baseUpdatedAtRef.current }),
      })
      if (res.status === 409) {
        // another device changed this report — reload rather than silently overwrite
        alert('This report was changed on another device. Reloading to pick up the latest version.')
        window.location.reload()
        return
      }
      if (!res.ok) throw new Error('save failed')
      const data = await res.json().catch(() => null)
      if (data?.updated_at) baseUpdatedAtRef.current = data.updated_at
      setSaveState('saved')
    } catch {
      if (!aliveRef.current) return
      setSaveState('error')
      if (retryTimer.current) clearTimeout(retryTimer.current)
      retryTimer.current = setTimeout(() => { void saveDoc() }, 5000) // retry until signal returns
    } finally {
      savingNowRef.current = false
    }
  }, [props.reportId])

  const updateDoc = useCallback(
    (fn: (d: ReportDoc) => ReportDoc) => {
      setDoc((d) => fn(d))
      setSaveState('saving') // honest from the first keystroke, not from the debounce firing
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => { void saveDoc() }, 1200)
    },
    [saveDoc]
  )

  // lifecycle: initialize concurrency base; kill timers, retries and blob URLs on unmount
  useEffect(() => {
    aliveRef.current = true
    baseUpdatedAtRef.current = props.updatedAt
    void import('heic2any').catch(() => {}) // pre-warm the chunk while there's signal
    return () => {
      aliveRef.current = false
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (retryTimer.current) clearTimeout(retryTimer.current)
      for (const p of Object.values(photosRef.current)) {
        if (p.url?.startsWith('blob:')) URL.revokeObjectURL(p.url)
      }
    }
  }, [props.updatedAt])

  // ---------------- photo upload queue ----------------
  const pumpUploads = useCallback(async () => {
    if (uploadingRef.current) return
    uploadingRef.current = true
    try {
      // Sequential (kind to weak connections). `processed` guards against re-picking the
      // same photo: photosRef only refreshes on render, which hasn't happened yet right
      // after setPhotos — without it every photo would upload twice and a missing-bytes
      // entry would spin this loop forever.
      const processed = new Set<string>()
      for (;;) {
        const next = Object.values(photosRef.current).find(
          (p) => !p.uploaded && !p.failed && !processed.has(p.id) && !deletedRef.current.has(p.id)
        )
        if (!next) break
        processed.add(next.id)
        const bytes = bytesRef.current.get(next.id)
        if (!bytes) {
          setPhotos((m) => (m[next.id] ? { ...m, [next.id]: { ...m[next.id], failed: true } } : m))
          continue
        }
        try {
          const fd = new FormData()
          fd.set('id', next.id)
          fd.set('file', new Blob([bytes as BlobPart], { type: 'image/jpeg' }), `${next.id}.jpg`)
          if (next.width) fd.set('width', String(next.width))
          if (next.height) fd.set('height', String(next.height))
          const res = await fetch(`/api/inspection-reports/${props.reportId}/photos`, {
            method: 'POST',
            body: fd,
          })
          if (!res.ok) throw new Error(`upload ${res.status}`)
          void removePendingPhoto(props.reportId, next.id)
          if (deletedRef.current.has(next.id)) {
            // deleted while in flight — remove the row we just created
            void fetch(`/api/inspection-reports/${props.reportId}/photos/${next.id}`, { method: 'DELETE' })
          } else {
            setPhotos((m) => (m[next.id] ? { ...m, [next.id]: { ...m[next.id], uploaded: true } } : m))
          }
        } catch {
          setPhotos((m) => (m[next.id] ? { ...m, [next.id]: { ...m[next.id], failed: true } } : m))
        }
      }
    } finally {
      uploadingRef.current = false
    }
  }, [props.reportId])

  // retry failed uploads on a timer and when connectivity returns
  useEffect(() => {
    const retry = () => {
      let had = false
      setPhotos((m) => {
        const failed = Object.values(m).filter((p) => p.failed && bytesRef.current.has(p.id))
        if (!failed.length) return m
        had = true
        const n = { ...m }
        for (const p of failed) n[p.id] = { ...p, failed: false }
        return n
      })
      if (had) setTimeout(() => void pumpUploads(), 50)
    }
    const iv = setInterval(retry, 10000)
    window.addEventListener('online', retry)
    return () => {
      clearInterval(iv)
      window.removeEventListener('online', retry)
    }
  }, [pumpUploads])

  const pendingCount = Object.values(photos).filter((p) => !p.uploaded).length

  // ---------------- crash recovery + reconciliation (runs once on mount) ----------------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // 1) Restore photos that were captured but never uploaded (tab evicted mid-queue)
      const pending = await listPendingPhotos(props.reportId)
      if (cancelled) return
      const restored: Record<string, PhotoState> = {}
      for (const p of pending) {
        if (photosRef.current[p.photoId]) continue // already on the server
        bytesRef.current.set(p.photoId, p.bytes)
        restored[p.photoId] = {
          id: p.photoId,
          url: URL.createObjectURL(new Blob([p.bytes as BlobPart], { type: 'image/jpeg' })),
          width: p.width,
          height: p.height,
          uploaded: false,
          failed: false,
        }
      }
      if (Object.keys(restored).length) {
        setPhotos((m) => ({ ...restored, ...m }))
        setTimeout(() => void pumpUploads(), 100)
      }
      // 2) Surface doc references whose photo is gone (lost before upload, or purged) —
      //    hiding them silently would let a rep think the report is complete when it isn't
      const known = new Set([...Object.keys(photosRef.current), ...Object.keys(restored)])
      const d = docRef.current
      const referenced = new Set<string>()
      for (const s of d.sections) for (const pid of s.photoIds) referenced.add(pid)
      for (const pid of d.unsorted) referenced.add(pid)
      if (d.cover.heroPhotoId) referenced.add(d.cover.heroPhotoId)
      const missing = Array.from(referenced).filter((pid) => !known.has(pid))
      if (missing.length) setMissingIds(missing)
      // 3) Orphan server photos nothing references (deleted-while-queued leftovers) →
      //    make them visible in Unsorted instead of invisible forever
      const orphans = Object.keys(photosRef.current).filter((pid) => !referenced.has(pid))
      if (orphans.length) {
        updateDoc((dd) => ({ ...dd, unsorted: [...dd.unsorted, ...orphans.filter((o) => !dd.unsorted.includes(o))] }))
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.reportId])

  // unsaved edits or photos still uploading? warn before the tab dies (best-effort —
  // iOS Safari often skips this event, which is why pending bytes also live in IndexedDB)
  const saveStateRef = useRef(saveState)
  saveStateRef.current = saveState
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const uploading = Object.values(photosRef.current).some((p) => !p.uploaded)
      if (uploading || saveStateRef.current !== 'saved') {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  const addFiles = useCallback(
    async (fileList: FileList | null, sectionId: string) => {
      const files = fileList ? Array.from(fileList) : []
      if (!files.length) return
      setBusy(`Processing ${files.length} photo${files.length > 1 ? 's' : ''}…`)
      let done = 0
      let failed = 0
      for (const f of files) {
        try {
          const r = await processFile(f)
          const id = crypto.randomUUID()
          bytesRef.current.set(id, r.bytes)
          void stashPendingPhoto(props.reportId, id, r.bytes, r.width, r.height) // crash safety until upload confirms
          const url = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: 'image/jpeg' }))
          setPhotos((m) => ({
            ...m,
            [id]: { id, url, width: r.width, height: r.height, uploaded: false, failed: false },
          }))
          updateDoc((d) => {
            const sections = d.sections.map((s) =>
              s.id === sectionId ? { ...s, photoIds: [...s.photoIds, id] } : s
            )
            return {
              ...d,
              sections,
              captions: { ...d.captions, [id]: d.captions[id] || '' },
              cover: d.cover.heroPhotoId ? d.cover : { ...d.cover, heroPhotoId: id },
            }
          })
          done++
          setBusy(`Processing photo ${done} of ${files.length}…`)
        } catch (e) {
          console.error('photo process failed', e)
          failed++
        }
      }
      setBusy(null)
      void pumpUploads()
      if (failed) {
        showToast(`${failed} photo${failed > 1 ? 's' : ''} couldn't be read — try adding again`)
      }
    },
    [props.reportId, pumpUploads, showToast, updateDoc]
  )

  const deletePhoto = useCallback(
    (pid: string) => {
      if (!confirm('Delete this photo?')) return
      const p = photosRef.current[pid]
      updateDoc((d) => {
        const captions = { ...d.captions }
        delete captions[pid]
        const rotations = { ...d.rotations }
        delete rotations[pid]
        return {
          ...d,
          sections: d.sections.map((s) => ({ ...s, photoIds: s.photoIds.filter((x) => x !== pid) })),
          unsorted: d.unsorted.filter((x) => x !== pid),
          captions,
          rotations,
          cover: d.cover.heroPhotoId === pid ? { ...d.cover, heroPhotoId: null } : d.cover,
        }
      })
      setPhotos((m) => {
        const n = { ...m }
        delete n[pid]
        return n
      })
      bytesRef.current.delete(pid)
      void removePendingPhoto(props.reportId, pid)
      if (p?.url?.startsWith('blob:')) URL.revokeObjectURL(p.url)
      if (p?.uploaded) {
        // retry once — a dropped DELETE would leave an orphan row that resurfaces on reload
        void fetch(`/api/inspection-reports/${props.reportId}/photos/${pid}`, { method: 'DELETE' }).then(
          (r) => {
            if (!r.ok && r.status !== 404) throw new Error('delete failed')
          }
        ).catch(() => {
          setTimeout(() => {
            void fetch(`/api/inspection-reports/${props.reportId}/photos/${pid}`, { method: 'DELETE' }).catch(() => {})
          }, 8000)
        })
      } else {
        // still in the upload queue (or in flight) — flag it so the queue skips it, and the
        // in-flight completion handler deletes the row it just created
        deletedRef.current.add(pid)
      }
    },
    [props.reportId, updateDoc]
  )

  const movePhoto = useCallback(
    (pid: string, fromSectionId: string, toSectionId: string) => {
      updateDoc((d) => ({
        ...d,
        unsorted: d.unsorted.filter((x) => x !== pid),
        sections: d.sections.map((s) => {
          const without = s.photoIds.filter((x) => x !== pid)
          return s.id === toSectionId ? { ...s, photoIds: [...without, pid] } : { ...s, photoIds: without }
        }),
      }))
    },
    [updateDoc]
  )

  const nudgePhoto = useCallback(
    (pid: string, sectionId: string, dir: -1 | 1) => {
      updateDoc((d) => ({
        ...d,
        sections: d.sections.map((s) => {
          if (s.id !== sectionId) return s
          // reorder within the photos that actually render — swapping with a dead
          // reference (lost/purged photo) would make the arrows appear broken
          const arr = s.photoIds.filter((x) => photosRef.current[x])
          const i = arr.indexOf(pid)
          const j = i + dir
          if (i < 0 || j < 0 || j >= arr.length) return s
          ;[arr[i], arr[j]] = [arr[j], arr[i]]
          return { ...s, photoIds: arr }
        }),
      }))
    },
    [updateDoc]
  )

  // ---------------- PDF generation ----------------
  const getOriginalBytes = useCallback(
    async (pid: string): Promise<Uint8Array | null> => {
      const cached = bytesRef.current.get(pid)
      if (cached) return cached
      const p = photosRef.current[pid]
      if (!p) return null
      const fetchBytes = async (url: string) => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`photo fetch ${res.status}`)
        return new Uint8Array(await res.arrayBuffer())
      }
      try {
        if (!p.url) throw new Error('no signed url') // minting failed at load — try a refresh
        const bytes = await fetchBytes(p.url)
        bytesRef.current.set(pid, bytes)
        return bytes
      } catch {
        // signed URL likely expired — refresh all URLs once and retry
        try {
          const res = await fetch(`/api/inspection-reports/${props.reportId}`)
          if (!res.ok) return null
          const data = await res.json()
          const fresh: Record<string, string | null> = {}
          for (const ph of data.photos || []) fresh[ph.id] = ph.url
          setPhotos((m) => {
            const n = { ...m }
            for (const id in fresh) if (n[id]) n[id] = { ...n[id], url: fresh[id] }
            return n
          })
          if (!fresh[pid]) return null
          const bytes = await fetchBytes(fresh[pid] as string)
          bytesRef.current.set(pid, bytes)
          return bytes
        } catch {
          return null
        }
      }
    },
    [props.reportId]
  )

  const generatePdf = useCallback(async () => {
    const d = docRef.current
    const allIds = Object.keys(photosRef.current)
    // Source photos are purged ~30 days after the PDF is built (the PDF is the record).
    // Rebuilding then would silently replace a full PDF with an empty one — stop that.
    const docReferencesPhotos = d.sections.some((s) => s.photoIds.length > 0)
    if (!allIds.length && docReferencesPhotos && pdfInfo) {
      alert(
        'The source photos for this report have been archived — the saved PDF is the permanent record. Rebuilding now would produce a PDF without photos, so it is disabled. Use View / Share / Email instead.'
      )
      return
    }
    if (!allIds.length && !confirm('No photos added. Generate a cover-only PDF?')) return
    const stillUploading = Object.values(photosRef.current).filter((p) => !p.uploaded)
    if (stillUploading.length) {
      // not blocking — local bytes are used for the PDF; uploads continue in the background
      void pumpUploads()
    }
    try {
      setBusy('Preparing photos…')
      let logoPng: Uint8Array | null = null
      try {
        const lr = await fetch('/brand/arx-report-logo.png')
        if (lr.ok) logoPng = new Uint8Array(await lr.arrayBuffer())
      } catch { /* wordmark fallback */ }

      const photoCount = allIds.length
      const failedPhotoIds = new Set<string>() // photos that couldn't be fetched this build
      let embeddedCount = 0
      let bytes: Uint8Array | null = null
      for (let i = 0; i < PDF_TIERS.length; i++) {
        const t = PDF_TIERS[i]
        setBusy(
          i === 0
            ? `Building PDF (${photoCount} photo${photoCount !== 1 ? 's' : ''})…`
            : `Large report — compressing to fit under 25 MB (pass ${i + 1})…`
        )
        bytes = await buildReportPdf({
          doc: d,
          hasPhoto: (id) => !!photosRef.current[id],
          logoPng,
          quality: t.q,
          maxSide: t.s,
          getPhotoJpeg: async (pid, quality, maxSide) => {
            const orig = await getOriginalBytes(pid)
            if (!orig) {
              failedPhotoIds.add(pid)
              return null
            }
            const rotation = d.rotations[pid] || 0
            if (rotation === 0 && quality >= 0.8 && maxSide >= 1280) return orig
            const re = await reencodeJpeg(orig, rotation, quality, maxSide)
            return re.bytes
          },
        })
        if (bytes.length <= PDF_SIZE_TARGET) break
      }
      if (!bytes) throw new Error('PDF build failed')
      // Never let a degraded build silently replace the saved PDF — the missing photos
      // would be invisible (numbering self-adjusts) and the old file is deleted at finalize.
      embeddedCount = orderedPhotoIds(d, (id) => !!photosRef.current[id] && !failedPhotoIds.has(id)).length
      if (failedPhotoIds.size > 0) {
        setBusy(null)
        const proceed = confirm(
          `${failedPhotoIds.size} photo${failedPhotoIds.size > 1 ? 's' : ''} couldn't be loaded and would be MISSING from this PDF.\n\nBuild it anyway? (Cancel keeps the previously saved PDF.)`
        )
        if (!proceed) return
        setBusy('Saving PDF to the CRM…')
      }
      lastPdfBytesRef.current = bytes

      setBusy('Saving PDF to the CRM…')
      // Register/finalize are tiny JSON calls at the END of a long build — a transient
      // network blip or a one-off auth-validation hiccup must not cost the rep the whole
      // build. Retry briefly, then surface the server's real error (status + body)
      // instead of a generic string.
      const postStage = async (body: Record<string, unknown>): Promise<Response> => {
        let last: Response | null = null
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt) await new Promise((r) => setTimeout(r, attempt * 1500))
          try {
            const res = await fetch(`/api/inspection-reports/${props.reportId}/pdf`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
            if (res.ok) return res
            last = res
            // 4xx (other than auth/timeout/rate-limit) won't change on retry
            if (res.status < 500 && ![401, 408, 429].includes(res.status)) break
          } catch {
            last = null // network error — retry
          }
        }
        if (last) {
          const serverMsg = (await last.json().catch(() => null))?.error
          throw new Error(
            `${serverMsg || 'Request failed'} (HTTP ${last.status})` +
              (last.status === 401
                ? ' — your session may have expired. Refresh the page and hit Build PDF again; your photos and edits are saved.'
                : '')
          )
        }
        throw new Error('Network error — check your connection and hit Build PDF again; your photos and edits are saved.')
      }
      const slug = reportSlug(d)
      const reg = await postStage({ stage: 'register', slug })
      const { bucket, path, token } = await reg.json()
      const { error: upErr } = await supabase.storage
        .from(bucket)
        .uploadToSignedUrl(path, token, new Blob([bytes as BlobPart], { type: 'application/pdf' }), {
          contentType: 'application/pdf',
        })
      if (upErr) throw new Error(upErr.message)
      await postStage({ stage: 'finalize', path, photo_count: embeddedCount })
      setPdfInfo({ generatedAt: new Date().toISOString(), sizeBytes: bytes.length })
      setBusy(null)

      const mb = bytes.length / 1048576
      if (bytes.length > 25 * 1048576) {
        alert(
          `This report is ${mb.toFixed(1)} MB — over Gmail's 25 MB limit even at maximum compression.\n\nIt saved to the CRM fine; send it with the share link instead of an attachment, or split the report.`
        )
      } else {
        showToast(`PDF ready — ${mb.toFixed(1)} MB`)
      }
    } catch (e) {
      setBusy(null)
      console.error(e)
      alert('PDF generation failed: ' + (e instanceof Error ? e.message : 'unknown error'))
    }
  }, [getOriginalBytes, props.reportId, pumpUploads, showToast, supabase])

  // Synchronous window.open inside the tap's call stack — iOS Safari blocks popups opened
  // after an await, so the redirect happens server-side (?redirect=1 → 302 to signed URL).
  const viewPdf = useCallback(() => {
    if (!pdfInfo) {
      showToast('Build the PDF first')
      return
    }
    window.open(`/api/inspection-reports/${props.reportId}/pdf?redirect=1`, '_blank')
  }, [pdfInfo, props.reportId, showToast])

  const sharePdf = useCallback(async () => {
    const bytes = lastPdfBytesRef.current
    const filename = `${reportSlug(docRef.current)}.pdf`
    if (bytes && typeof navigator.share === 'function') {
      try {
        const file = new File([new Blob([bytes as BlobPart])], filename, { type: 'application/pdf' })
        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: filename })
          return
        }
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return
      }
    }
    // no local bytes (PDF built in a previous session) — plain navigation, popup-safe
    viewPdf()
  }, [viewPdf])

  const copyShareLink = useCallback(async () => {
    const url = `${window.location.origin}/r/${props.shareToken}`
    try {
      await navigator.clipboard.writeText(url)
      showToast('Share link copied')
    } catch {
      prompt('Copy this link:', url)
    }
  }, [props.shareToken, showToast])

  // ---------------- derived ----------------
  const totalPhotos = Object.keys(photos).length
  const estMb = useMemo(() => {
    let bytes = 0
    for (const id of Object.keys(photos)) bytes += bytesRef.current.get(id)?.length ?? 300 * 1024
    return bytes / 1048576
  }, [photos])

  const input16 = { fontSize: 16 } as const // iOS: prevents zoom-on-focus

  // ---------------- render ----------------
  return (
    <div className="min-h-screen pb-40" style={{ background: '#1f1e1c' }}>
      {/* top bar */}
      <header
        className="sticky top-0 z-40 flex items-center gap-3 px-4 py-2.5"
        style={{ background: CHARCOAL, borderBottom: `3px solid ${GOLD}` }}
      >
        <a
          href={`/opportunities/${props.opportunityId}`}
          className="rounded-md px-2 py-1 text-sm font-semibold"
          style={{ color: CREAM, border: '1px solid #5a564e' }}
        >
          ‹ Back
        </a>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold tracking-wide" style={{ color: CREAM }}>
            <span style={{ color: GOLD }}>ARX</span> Roof Report
          </div>
          <div className="truncate text-xs" style={{ color: '#cfc6b3' }}>
            {doc.propertyAddressHeader || 'No address'}
          </div>
        </div>
        <div className="text-right text-xs" style={{ color: '#cfc6b3' }}>
          <div>
            {totalPhotos} photo{totalPhotos !== 1 ? 's' : ''} · ~{estMb.toFixed(1)} MB
          </div>
          <div style={{ color: saveState === 'error' ? '#e6a85a' : '#cfc6b3' }}>
            {pendingCount > 0
              ? `${pendingCount} uploading…`
              : saveState === 'saving'
                ? 'Saving…'
                : saveState === 'error'
                  ? 'Offline — will retry'
                  : 'Saved ✓'}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-3 p-3">
        {/* missing photo references — never hide data loss */}
        {missingIds.length > 0 ? (
          <div
            className="rounded-xl p-3 text-sm font-medium"
            style={{ background: '#fdf3e3', border: '1px solid #e6a85a', color: '#7a4a12' }}
          >
            {missingIds.length} photo{missingIds.length > 1 ? 's' : ''} in this report{' '}
            {missingIds.length > 1 ? 'are' : 'is'} no longer available (not uploaded before the app
            closed, or archived after the PDF was saved).
            {pdfInfo ? ' The saved PDF still has every photo it was built with.' : ''}
            <button
              onClick={() => {
                const dead = new Set(missingIds)
                updateDoc((d) => ({
                  ...d,
                  sections: d.sections.map((s) => ({
                    ...s,
                    photoIds: s.photoIds.filter((x) => !dead.has(x)),
                  })),
                  unsorted: d.unsorted.filter((x) => !dead.has(x)),
                }))
                setMissingIds([])
              }}
              className="ml-2 rounded-md px-2.5 py-1 text-xs font-bold"
              style={{ border: '1px solid #e6a85a', color: '#7a4a12' }}
            >
              Clear missing entries
            </button>
          </div>
        ) : null}

        {/* PDF status / actions */}
        {pdfInfo ? (
          <div className="rounded-xl bg-white p-3" style={{ border: `1px solid ${LINE}` }}>
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1 text-sm" style={{ color: DARKTEXT }}>
                <strong>PDF ready</strong>
                {pdfInfo.sizeBytes ? ` — ${(pdfInfo.sizeBytes / 1048576).toFixed(1)} MB` : ''}
                {sentTo ? (
                  <span className="block text-xs" style={{ color: '#8a8576' }}>
                    Last sent to {sentTo}
                  </span>
                ) : null}
              </div>
              <button
                onClick={() => void viewPdf()}
                className="rounded-lg px-3 py-2 text-sm font-semibold"
                style={{ border: `1px solid ${LINE}`, color: DARKTEXT }}
              >
                View
              </button>
              <button
                onClick={() => void copyShareLink()}
                className="rounded-lg px-3 py-2 text-sm font-semibold"
                style={{ border: `1px solid ${LINE}`, color: DARKTEXT }}
              >
                Copy link
              </button>
              <button
                onClick={() => setSendOpen(true)}
                className="rounded-lg px-3 py-2 text-sm font-bold"
                style={{ background: CHARCOAL, color: CREAM }}
              >
                Email it
              </button>
            </div>
          </div>
        ) : null}

        {/* sections — the actual job, first */}
        {doc.sections.map((s, idx) => (
          <SectionCard
            key={s.id}
            section={s}
            index={idx}
            count={doc.sections.length}
            doc={doc}
            photos={photos}
            onAddFiles={(files) => void addFiles(files, s.id)}
            onCaption={(pid, v) => updateDoc((d) => ({ ...d, captions: { ...d.captions, [pid]: v } }))}
            onRotate={(pid) =>
              updateDoc((d) => ({
                ...d,
                rotations: { ...d.rotations, [pid]: ((d.rotations[pid] || 0) + 90) % 360 },
              }))
            }
            onHero={(pid) => updateDoc((d) => ({ ...d, cover: { ...d.cover, heroPhotoId: pid } }))}
            onDelete={deletePhoto}
            onMove={movePhoto}
            onNudge={nudgePhoto}
            onRename={(patch) =>
              updateDoc((d) => ({
                ...d,
                sections: d.sections.map((x) => (x.id === s.id ? { ...x, ...patch } : x)),
              }))
            }
            onNudgeSection={(dir) =>
              updateDoc((d) => {
                const arr = [...d.sections]
                const j = idx + dir
                if (j < 0 || j >= arr.length) return d
                ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
                return { ...d, sections: arr }
              })
            }
            onDeleteSection={() => {
              if (!confirm('Delete section? Its photos move to Unsorted.')) return
              updateDoc((d) => ({
                ...d,
                unsorted: [...d.unsorted, ...s.photoIds],
                sections: d.sections.filter((x) => x.id !== s.id),
              }))
            }}
          />
        ))}

        <button
          onClick={() =>
            updateDoc((d) => ({
              ...d,
              sections: [
                ...d.sections,
                { id: uid(), dividerTitle: 'NEW SECTION', dividerSubtitle: '', headerLabel: 'NEW SECTION', photoIds: [] },
              ],
            }))
          }
          className="w-full rounded-xl py-3 text-sm font-semibold"
          style={{ border: '1px dashed #5a564e', color: '#cfc6b3' }}
        >
          + Add section
        </button>

        {/* unsorted photos (legacy / deleted-section fallout) */}
        {doc.unsorted.filter((pid) => photos[pid]).length > 0 ? (
          <div className="rounded-xl bg-white p-3" style={{ border: `1px solid ${LINE}` }}>
            <div className="mb-2 text-sm font-bold" style={{ color: DARKTEXT }}>
              Unsorted — not in the PDF until moved to a section
            </div>
            {doc.unsorted
              .filter((pid) => photos[pid])
              .map((pid) => (
                <PhotoCard
                  key={pid}
                  pid={pid}
                  sectionId="__unsorted__"
                  doc={doc}
                  photo={photos[pid]}
                  onCaption={(v) => updateDoc((d) => ({ ...d, captions: { ...d.captions, [pid]: v } }))}
                  onRotate={() =>
                    updateDoc((d) => ({
                      ...d,
                      rotations: { ...d.rotations, [pid]: ((d.rotations[pid] || 0) + 90) % 360 },
                    }))
                  }
                  onHero={() => updateDoc((d) => ({ ...d, cover: { ...d.cover, heroPhotoId: pid } }))}
                  onDelete={() => deletePhoto(pid)}
                  onMove={(to) => movePhoto(pid, '__unsorted__', to)}
                  onNudge={() => {}}
                  chips={[]}
                />
              ))}
          </div>
        ) : null}

        {/* cover details — prefilled from the CRM; usually untouched */}
        <div className="rounded-xl bg-white" style={{ border: `1px solid ${LINE}` }}>
          <button
            onClick={() => setCoverOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-bold"
            style={{ color: DARKTEXT }}
          >
            <span>
              Cover page
              {doc.cover.subtitle.trim()
                ? ` — ${doc.cover.subtitle.trim().slice(0, 48)}${doc.cover.subtitle.trim().length > 48 ? '…' : ''}`
                : ' — no subtitle'}
            </span>
            <span>{coverOpen ? '▴' : '▾'}</span>
          </button>
          {coverOpen ? (
            <div className="space-y-3 px-4 pb-4">
              <Field label="Title">
                <textarea
                  rows={2}
                  value={doc.cover.title}
                  onChange={(e) => updateDoc((d) => ({ ...d, cover: { ...d.cover, title: e.target.value } }))}
                  className="w-full rounded-md border p-2"
                  style={{ ...input16, borderColor: LINE, color: DARKTEXT }}
                />
              </Field>
              <Field label="Subtitle (shown on cover PDF — leave blank to hide)">
                <input
                  value={doc.cover.subtitle}
                  onChange={(e) => updateDoc((d) => ({ ...d, cover: { ...d.cover, subtitle: e.target.value } }))}
                  className="w-full rounded-md border p-2"
                  style={{ ...input16, borderColor: LINE, color: DARKTEXT }}
                  placeholder="e.g. Professional Roof Inspection"
                />
              </Field>
              <Field label="Property address (page headers)">
                <input
                  value={doc.propertyAddressHeader}
                  onChange={(e) => updateDoc((d) => ({ ...d, propertyAddressHeader: e.target.value }))}
                  className="w-full rounded-md border p-2"
                  style={{ ...input16, borderColor: LINE, color: DARKTEXT }}
                />
              </Field>
              {doc.cover.infoFields.map((f) => (
                <div key={f.id} className="flex gap-2">
                  <input
                    value={f.label}
                    onChange={(e) =>
                      updateDoc((d) => ({
                        ...d,
                        cover: {
                          ...d.cover,
                          infoFields: d.cover.infoFields.map((x) =>
                            x.id === f.id ? { ...x, label: e.target.value } : x
                          ),
                        },
                      }))
                    }
                    className="w-2/5 rounded-md border p-2"
                    style={{ ...input16, borderColor: LINE, color: DARKTEXT }}
                    placeholder="Label"
                  />
                  <input
                    value={f.value}
                    onChange={(e) =>
                      updateDoc((d) => ({
                        ...d,
                        cover: {
                          ...d.cover,
                          infoFields: d.cover.infoFields.map((x) =>
                            x.id === f.id ? { ...x, value: e.target.value } : x
                          ),
                        },
                      }))
                    }
                    className="flex-1 rounded-md border p-2"
                    style={{ ...input16, borderColor: LINE, color: DARKTEXT }}
                    placeholder="Blank = hidden"
                  />
                </div>
              ))}
              <button
                onClick={() =>
                  updateDoc((d) => ({
                    ...d,
                    cover: { ...d.cover, infoFields: [...d.cover.infoFields, { id: uid(), label: 'New Field', value: '' }] },
                  }))
                }
                className="rounded-md px-3 py-1.5 text-sm"
                style={{ border: `1px solid ${LINE}`, color: DARKTEXT }}
              >
                + Add field
              </button>
              <Field label="Note (bottom of cover)">
                <textarea
                  rows={2}
                  value={doc.cover.note}
                  onChange={(e) => updateDoc((d) => ({ ...d, cover: { ...d.cover, note: e.target.value } }))}
                  className="w-full rounded-md border p-2"
                  style={{ ...input16, borderColor: LINE, color: DARKTEXT }}
                />
              </Field>
            </div>
          ) : null}
        </div>

        {/* summary page */}
        <div className="rounded-xl bg-white" style={{ border: `1px solid ${LINE}` }}>
          <button
            onClick={() => setSummaryOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-bold"
            style={{ color: DARKTEXT }}
          >
            <span>
              Summary page {doc.summary.include ? '— included ✓' : '— off'}
            </span>
            <span>{summaryOpen ? '▴' : '▾'}</span>
          </button>
          {summaryOpen ? (
            <div className="space-y-3 px-4 pb-4">
              <label className="flex items-center gap-2 text-sm font-semibold" style={{ color: DARKTEXT }}>
                <input
                  type="checkbox"
                  checked={doc.summary.include}
                  onChange={(e) => updateDoc((d) => ({ ...d, summary: { ...d.summary, include: e.target.checked } }))}
                  className="h-5 w-5"
                />
                Include summary page in PDF
              </label>
              <Field label="Page title (main heading)">
                <input
                  value={doc.summary.title}
                  onChange={(e) =>
                    updateDoc((d) => ({ ...d, summary: { ...d.summary, title: e.target.value } }))
                  }
                  className="w-full rounded-md border p-2"
                  style={{ ...input16, borderColor: LINE, color: DARKTEXT }}
                  placeholder="Summary & Basis for Inspection"
                />
              </Field>
              <Field label="Page header (top bar on PDF)">
                <input
                  value={doc.summary.headerLabel}
                  onChange={(e) =>
                    updateDoc((d) => ({ ...d, summary: { ...d.summary, headerLabel: e.target.value } }))
                  }
                  className="w-full rounded-md border p-2"
                  style={{ ...input16, borderColor: LINE, color: DARKTEXT }}
                  placeholder="SUMMARY & BASIS FOR INSPECTION"
                />
              </Field>
              {doc.summary.blocks.map((b) => (
                <div key={b.id} className="rounded-lg border p-2" style={{ borderColor: LINE }}>
                  <input
                    value={b.heading}
                    onChange={(e) =>
                      updateDoc((d) => ({
                        ...d,
                        summary: {
                          ...d.summary,
                          blocks: d.summary.blocks.map((x) => (x.id === b.id ? { ...x, heading: e.target.value } : x)),
                        },
                      }))
                    }
                    className="mb-1 w-full rounded-md border p-2 font-semibold"
                    style={{ ...input16, borderColor: LINE, color: DARKTEXT }}
                    placeholder="Heading"
                  />
                  <textarea
                    rows={3}
                    value={b.body}
                    onChange={(e) =>
                      updateDoc((d) => ({
                        ...d,
                        summary: {
                          ...d.summary,
                          blocks: d.summary.blocks.map((x) => (x.id === b.id ? { ...x, body: e.target.value } : x)),
                        },
                      }))
                    }
                    className="w-full rounded-md border p-2"
                    style={{ ...input16, borderColor: LINE, color: DARKTEXT }}
                  />
                </div>
              ))}
              <div className="text-xs font-bold uppercase" style={{ color: '#8a8576' }}>
                Request box
              </div>
              <Field label="Request box title">
                <input
                  value={doc.summary.requestTitle}
                  onChange={(e) =>
                    updateDoc((d) => ({ ...d, summary: { ...d.summary, requestTitle: e.target.value } }))
                  }
                  className="w-full rounded-md border p-2"
                  style={{ ...input16, borderColor: LINE, color: DARKTEXT }}
                  placeholder="Request"
                />
              </Field>
              {doc.summary.requestItems.map((it) => (
                <div key={it.id} className="rounded-lg border p-2" style={{ borderColor: LINE }}>
                  <input
                    value={it.subhead}
                    onChange={(e) =>
                      updateDoc((d) => ({
                        ...d,
                        summary: {
                          ...d.summary,
                          requestItems: d.summary.requestItems.map((x) =>
                            x.id === it.id ? { ...x, subhead: e.target.value } : x
                          ),
                        },
                      }))
                    }
                    className="mb-1 w-full rounded-md border p-2 font-semibold"
                    style={{ ...input16, borderColor: LINE, color: DARKTEXT }}
                    placeholder="Sub-heading"
                  />
                  <textarea
                    rows={3}
                    value={it.body}
                    onChange={(e) =>
                      updateDoc((d) => ({
                        ...d,
                        summary: {
                          ...d.summary,
                          requestItems: d.summary.requestItems.map((x) =>
                            x.id === it.id ? { ...x, body: e.target.value } : x
                          ),
                        },
                      }))
                    }
                    className="w-full rounded-md border p-2"
                    style={{ ...input16, borderColor: LINE, color: DARKTEXT }}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* homeowner's guide (two static pages appended to the PDF) */}
        <div className="rounded-xl bg-white" style={{ border: `1px solid ${LINE}` }}>
          <div className="flex w-full items-center justify-between px-4 py-3">
            <span className="text-sm font-bold" style={{ color: DARKTEXT }}>
              Homeowner&apos;s guide {doc.guide?.include !== false ? '— included ✓' : '— off'}
            </span>
            <label className="flex items-center gap-2 text-sm font-semibold" style={{ color: DARKTEXT }}>
              <input
                type="checkbox"
                checked={doc.guide?.include !== false}
                onChange={(e) => updateDoc((d) => ({ ...d, guide: { include: e.target.checked } }))}
                className="h-5 w-5"
              />
              Include
            </label>
          </div>
          <div className="px-4 pb-3 text-xs" style={{ color: '#8a8576' }}>
            Two educational pages at the end of the PDF: questions to ask any roofer, shingle types
            &amp; impact ratings, red flags, and NC homeowner rights. Turn off for carrier-facing
            reinspection packets.
          </div>
        </div>
      </main>

      {/* bottom action bar */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 p-3"
        style={{ background: 'linear-gradient(transparent, #1f1e1c 30%)' }}
      >
        <div className="mx-auto flex max-w-3xl gap-2">
          <button
            onClick={() => void generatePdf()}
            className="flex-1 rounded-xl py-4 text-base font-bold shadow-lg"
            style={{ background: GOLD, color: CHARCOAL }}
          >
            {pdfInfo ? 'Rebuild PDF' : 'Build PDF'}
          </button>
          {pdfInfo ? (
            <button
              onClick={() => void sharePdf()}
              className="rounded-xl px-5 py-4 text-base font-bold shadow-lg"
              style={{ background: CHARCOAL, color: CREAM, border: `1px solid ${GOLD}` }}
            >
              Share
            </button>
          ) : null}
        </div>
      </div>

      {/* busy overlay */}
      {busy ? (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3"
          style={{ background: 'rgba(31,30,28,.82)', color: CREAM }}
        >
          <div className="px-6 text-center text-base">{busy}</div>
          <div className="h-1.5 w-60 overflow-hidden rounded-full" style={{ background: '#4a463f' }}>
            <div className="h-full w-2/5 animate-pulse rounded-full" style={{ background: GOLD }} />
          </div>
        </div>
      ) : null}

      {/* toast */}
      {toast ? (
        <div
          className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm font-semibold shadow-xl"
          style={{ background: CHARCOAL, color: CREAM, border: `1px solid ${GOLD}` }}
        >
          {toast}
        </div>
      ) : null}

      {sendOpen ? (
        <SendModal
          reportId={props.reportId}
          defaultTo={sentTo || props.customerEmail || ''}
          onClose={() => setSendOpen(false)}
          onSent={(to) => {
            setSentTo(to)
            setSendOpen(false)
            showToast(`Sent to ${to}`)
          }}
        />
      ) : null}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: '#8a8576' }}>
        {label}
      </span>
      {children}
    </label>
  )
}

function SectionCard(props: {
  section: ReportSection
  index: number
  count: number
  doc: ReportDoc
  photos: Record<string, PhotoState>
  onAddFiles: (files: FileList | null) => void
  onCaption: (pid: string, v: string) => void
  onRotate: (pid: string) => void
  onHero: (pid: string) => void
  onDelete: (pid: string) => void
  onMove: (pid: string, from: string, to: string) => void
  onNudge: (pid: string, sectionId: string, dir: -1 | 1) => void
  onRename: (patch: Partial<ReportSection>) => void
  onNudgeSection: (dir: -1 | 1) => void
  onDeleteSection: () => void
}) {
  const { section: s, doc, photos } = props
  const [editOpen, setEditOpen] = useState(false)
  const cameraRef = useRef<HTMLInputElement>(null)
  const libraryRef = useRef<HTMLInputElement>(null)
  const chips = chipsForSection(s)
  const livePhotoIds = s.photoIds.filter((pid) => photos[pid])

  return (
    <div className="overflow-hidden rounded-xl bg-white" style={{ border: `1px solid ${LINE}` }}>
      <div className="flex items-center gap-2 px-3 py-2.5" style={{ background: '#fbfaf6', borderBottom: `1px solid ${LINE}` }}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold" style={{ color: DARKTEXT }}>
            {s.dividerTitle || '(untitled section)'}
          </div>
          <div className="truncate text-xs" style={{ color: '#8a8576' }}>
            {livePhotoIds.length} photo{livePhotoIds.length !== 1 ? 's' : ''}
            {s.dividerSubtitle ? ` · ${s.dividerSubtitle}` : ''}
          </div>
        </div>
        <button
          onClick={() => setEditOpen((v) => !v)}
          className="rounded-md px-2.5 py-1.5 text-xs font-semibold"
          style={{ border: `1px solid ${LINE}`, color: DARKTEXT }}
        >
          {editOpen ? 'Done' : 'Edit'}
        </button>
      </div>

      {editOpen ? (
        <div className="space-y-2 px-3 py-2" style={{ background: '#fbfaf6' }}>
          <input
            value={s.dividerTitle}
            onChange={(e) => props.onRename({ dividerTitle: e.target.value })}
            className="w-full rounded-md border p-2 font-semibold"
            style={{ fontSize: 16, borderColor: LINE, color: DARKTEXT }}
            placeholder="Section name"
          />
          <input
            value={s.dividerSubtitle}
            onChange={(e) => props.onRename({ dividerSubtitle: e.target.value })}
            className="w-full rounded-md border p-2"
            style={{ fontSize: 16, borderColor: LINE, color: DARKTEXT }}
            placeholder="Subtitle"
          />
          <input
            value={s.headerLabel}
            onChange={(e) => props.onRename({ headerLabel: e.target.value })}
            className="w-full rounded-md border p-2"
            style={{ fontSize: 16, borderColor: LINE, color: DARKTEXT }}
            placeholder="Page header"
          />
          <div className="flex gap-2">
            <button onClick={() => props.onNudgeSection(-1)} disabled={props.index === 0} className="rounded-md px-3 py-1.5 text-sm disabled:opacity-40" style={{ border: `1px solid ${LINE}`, color: DARKTEXT }}>
              ↑ Move up
            </button>
            <button onClick={() => props.onNudgeSection(1)} disabled={props.index === props.count - 1} className="rounded-md px-3 py-1.5 text-sm disabled:opacity-40" style={{ border: `1px solid ${LINE}`, color: DARKTEXT }}>
              ↓ Move down
            </button>
            <button onClick={props.onDeleteSection} className="ml-auto rounded-md px-3 py-1.5 text-sm font-semibold" style={{ border: '1px solid #e3c7c2', color: '#b3402f' }}>
              Delete
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-2 p-3">
        {/* the two ways photos arrive: live from the roof, or picked after */}
        <div className="flex gap-2">
          <button
            onClick={() => cameraRef.current?.click()}
            className="flex-1 rounded-lg py-3 text-sm font-bold"
            style={{ background: CHARCOAL, color: CREAM }}
          >
            📷 Camera
          </button>
          <button
            onClick={() => libraryRef.current?.click()}
            className="flex-1 rounded-lg py-3 text-sm font-bold"
            style={{ border: `1.5px solid ${CHARCOAL}`, color: DARKTEXT }}
          >
            🖼 Photo library
          </button>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              props.onAddFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <input
            ref={libraryRef}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            className="hidden"
            onChange={(e) => {
              props.onAddFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>

        {livePhotoIds.map((pid) => (
          <PhotoCard
            key={pid}
            pid={pid}
            sectionId={s.id}
            doc={doc}
            photo={photos[pid]}
            chips={chips}
            onCaption={(v) => props.onCaption(pid, v)}
            onRotate={() => props.onRotate(pid)}
            onHero={() => props.onHero(pid)}
            onDelete={() => props.onDelete(pid)}
            onMove={(to) => props.onMove(pid, s.id, to)}
            onNudge={(dir) => props.onNudge(pid, s.id, dir)}
          />
        ))}
      </div>
    </div>
  )
}

function PhotoCard(props: {
  pid: string
  sectionId: string
  doc: ReportDoc
  photo: PhotoState
  chips: string[]
  onCaption: (v: string) => void
  onRotate: () => void
  onHero: () => void
  onDelete: () => void
  onMove: (toSectionId: string) => void
  onNudge: (dir: -1 | 1) => void
}) {
  const { pid, doc, photo } = props
  const caption = doc.captions[pid] || ''
  const rotation = doc.rotations[pid] || 0
  const isHero = doc.cover.heroPhotoId === pid
  const [moreOpen, setMoreOpen] = useState(false)

  return (
    <div className="rounded-lg border p-2" style={{ borderColor: LINE, background: '#fff' }}>
      <div className="flex gap-2">
        <div className="relative h-24 w-24 flex-none overflow-hidden rounded-md" style={{ background: '#eee' }}>
          {photo.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo.url}
              alt=""
              className="h-full w-full object-cover"
              style={{ transform: `rotate(${rotation}deg)` }}
            />
          ) : null}
          {isHero ? (
            <span
              className="absolute bottom-1 left-1 rounded px-1 text-[10px] font-bold"
              style={{ background: 'rgba(43,42,40,.9)', color: CREAM }}
            >
              COVER
            </span>
          ) : null}
          {!photo.uploaded ? (
            <span
              className="absolute right-1 top-1 rounded px-1 text-[10px] font-bold"
              style={{ background: photo.failed ? '#b3402f' : 'rgba(43,42,40,.9)', color: CREAM }}
            >
              {photo.failed ? 'RETRYING' : 'UPLOADING'}
            </span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <textarea
            rows={2}
            value={caption}
            onChange={(e) => props.onCaption(e.target.value)}
            placeholder="Caption…"
            className="w-full rounded-md border p-2"
            style={{ fontSize: 16, borderColor: LINE, color: DARKTEXT }}
          />
          <div className="mt-1 flex flex-wrap gap-1">
            {props.chips.map((c) => (
              <button
                key={c}
                onClick={() => props.onCaption(caption ? `${caption}; ${c}` : c)}
                className="rounded-full px-2.5 py-1 text-xs"
                style={{ background: '#F1E9D7', color: DARKTEXT, border: `1px solid ${LINE}` }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button onClick={props.onRotate} className="rounded-md px-2.5 py-1.5 text-xs font-semibold" style={{ border: `1px solid ${LINE}`, color: DARKTEXT }}>
          ⟳ Rotate
        </button>
        <button
          onClick={props.onHero}
          className="rounded-md px-2.5 py-1.5 text-xs font-semibold"
          style={isHero ? { background: GOLD, color: CHARCOAL } : { border: `1px solid ${LINE}`, color: DARKTEXT }}
        >
          ★ Cover
        </button>
        <button onClick={() => setMoreOpen((v) => !v)} className="rounded-md px-2.5 py-1.5 text-xs font-semibold" style={{ border: `1px solid ${LINE}`, color: DARKTEXT }}>
          More…
        </button>
        <button onClick={props.onDelete} className="ml-auto rounded-md px-2.5 py-1.5 text-xs font-semibold" style={{ border: '1px solid #e3c7c2', color: '#b3402f' }}>
          Delete
        </button>
      </div>
      {moreOpen ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {props.sectionId !== '__unsorted__' ? (
            <>
              <button onClick={() => props.onNudge(-1)} className="rounded-md px-2.5 py-1.5 text-xs" style={{ border: `1px solid ${LINE}`, color: DARKTEXT }}>
                ↑ Earlier
              </button>
              <button onClick={() => props.onNudge(1)} className="rounded-md px-2.5 py-1.5 text-xs" style={{ border: `1px solid ${LINE}`, color: DARKTEXT }}>
                ↓ Later
              </button>
            </>
          ) : null}
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) props.onMove(e.target.value)
            }}
            className="rounded-md border px-2 py-1.5 text-xs"
            style={{ borderColor: LINE, color: DARKTEXT, background: '#fff' }}
          >
            <option value="" disabled>
              Move to section…
            </option>
            {doc.sections
              .filter((x) => x.id !== props.sectionId)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.dividerTitle || '(untitled)'}
                </option>
              ))}
          </select>
        </div>
      ) : null}
    </div>
  )
}

function SendModal(props: {
  reportId: string
  defaultTo: string
  onClose: () => void
  onSent: (to: string) => void
}) {
  const [to, setTo] = useState(props.defaultTo)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async () => {
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/inspection-reports/${props.reportId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.trim(), message }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Send failed')
      props.onSent(to.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed')
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" style={{ background: 'rgba(31,30,28,.7)' }}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-4 sm:rounded-2xl">
        <div className="mb-3 text-base font-bold" style={{ color: DARKTEXT }}>
          Email the report
        </div>
        <label className="mb-1 block text-xs font-bold uppercase" style={{ color: '#8a8576' }}>
          To
        </label>
        <input
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="customer@email.com"
          className="mb-3 w-full rounded-md border p-2.5"
          style={{ fontSize: 16, borderColor: LINE, color: DARKTEXT }}
        />
        <label className="mb-1 block text-xs font-bold uppercase" style={{ color: '#8a8576' }}>
          Note (optional)
        </label>
        <textarea
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Added to the top of the email"
          className="mb-3 w-full rounded-md border p-2.5"
          style={{ fontSize: 16, borderColor: LINE, color: DARKTEXT }}
        />
        {error ? (
          <div className="mb-3 rounded-md px-3 py-2 text-sm font-semibold" style={{ background: '#fdecea', color: '#b3402f' }}>
            {error}
          </div>
        ) : null}
        <div className="flex gap-2">
          <button
            onClick={props.onClose}
            disabled={sending}
            className="flex-1 rounded-lg py-3 text-sm font-semibold"
            style={{ border: `1px solid ${LINE}`, color: DARKTEXT }}
          >
            Cancel
          </button>
          <button
            onClick={() => void send()}
            disabled={sending || !to.includes('@')}
            className="flex-1 rounded-lg py-3 text-sm font-bold disabled:opacity-50"
            style={{ background: GOLD, color: CHARCOAL }}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
