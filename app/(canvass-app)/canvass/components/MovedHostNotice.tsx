'use client'

/**
 * Shown on /canvass only when the app is opened on an address that is not the configured one (domain cutover).
 * Sends the knocks and photos saved on this phone (they belong to this address) and only then offers the link to the new
 * address. It never redirects by itself, and the link stays hidden while anything is unsent. Rules: lib/host-handoff.ts.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { jobPhotoUploadSteps } from '@/components/job/useJobPhotoQueue'
import { handoffTarget, handoffView, withTimeout, type PendingCounts } from '@/lib/host-handoff'
import { flushPhotoQueue, indexedDbPhotoStore, MAX_ATTEMPTS } from '@/lib/job-photo-queue'
import { listAllPendingPhotos, removePendingPhoto, uploadReportPhoto } from '@/lib/inspection-report/pending-store'
import { useOfflineStore } from '../lib/offlineStore'

export type HandoffDeps = {
  /** Send everything that can be sent. `retryFailed` also re-tries job photos that had stopped retrying. */
  flush(opts: { retryFailed: boolean }): Promise<void>
  count(): Promise<PendingCounts>
}

const browserDeps: HandoffDeps = {
  async flush({ retryFailed }) {
    await useOfflineStore.getState().syncLeads()

    if (typeof indexedDB === 'undefined') return
    const store = indexedDbPhotoStore()
    if (retryFailed) {
      for (const p of (await store.list()).filter((x) => x.attempts >= MAX_ATTEMPTS)) {
        await store.update(p.id, { attempts: 0, lastError: null, reg: null })
      }
    }
    if (typeof indexedDB === 'undefined') return
    await withTimeout(flushPhotoQueue(store, jobPhotoUploadSteps()), FLUSH_TIMEOUT_MS).catch((e) => console.error('[moved-host] job photos', e))

    for (const photo of await withTimeout(listAllPendingPhotos(), IDB_TIMEOUT_MS).catch(() => [])) {
      try {
        const res = await uploadReportPhoto(photo.reportId, photo)
        if (res.ok) await removePendingPhoto(photo.reportId, photo.photoId)
      } catch {
        break // no signal: keep the rest for the next try
      }
    }
  },
  async count() {
    const leads = useOfflineStore.getState().pendingLeads
    const knocksNeedingAttention = leads.filter((l) => l.sync_error).length
    let photosUnreadable = false
    // Photo storage may be missing, blocked or hung (private mode, storage pressure): never wait on it forever.
    const safeCount = async (read: () => Promise<unknown[]>) => {
      if (typeof indexedDB === 'undefined') return 0
      try {
        return (await withTimeout(read(), IDB_TIMEOUT_MS)).length
      } catch {
        photosUnreadable = true
        return 0
      }
    }
    const [jobPhotos, reportPhotos] = await Promise.all([safeCount(() => indexedDbPhotoStore().list()), safeCount(() => listAllPendingPhotos())])
    return { knocks: leads.length - knocksNeedingAttention, knocksNeedingAttention, jobPhotos, reportPhotos, photosUnreadable }
  },
}

const RETRY_MS = 20_000
const IDB_TIMEOUT_MS = 5_000
const FLUSH_TIMEOUT_MS = 120_000

export default function MovedHostNotice({ target: targetProp, deps = browserDeps }: { target?: string | null; deps?: HandoffDeps }) {
  const [target, setTarget] = useState<string | null>(targetProp ?? null)
  const [counts, setCounts] = useState<PendingCounts | null>(null)
  const [flushing, setFlushing] = useState(false)
  const [online, setOnline] = useState(true)
  const [failedRuns, setFailedRuns] = useState(0)
  const running = useRef(false)

  useEffect(() => {
    if (targetProp !== undefined) return
    setTarget(
      handoffTarget({
        currentUrl: window.location.href,
        appUrl: process.env.NEXT_PUBLIC_APP_URL,
        vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV,
      })
    )
  }, [targetProp])

  const run = useCallback(
    async (retryFailed: boolean) => {
      if (running.current) return
      running.current = true
      setFlushing(true)
      try {
        if (typeof navigator === 'undefined' || navigator.onLine !== false) await deps.flush({ retryFailed })
      } catch (e) {
        console.error('[moved-host] sending saved items failed', e)
      }
      try {
        const next = await deps.count()
        setCounts(next)
        const stillPending = next.knocks + next.jobPhotos + next.reportPhotos > 0
        const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false
        setFailedRuns((n) => (stillPending && isOnline ? n + 1 : stillPending ? n : 0))
      } catch (e) {
        console.error('[moved-host] could not count saved items', e)
        setCounts(null) // unknown: keep the link hidden
      } finally {
        setFlushing(false)
        running.current = false
      }
    },
    [deps]
  )

  useEffect(() => {
    if (!target) return
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine !== false)
    void run(false)
    const onOnline = () => {
      setOnline(true)
      void run(false)
    }
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [target, run])

  // The knock queue also syncs on its own (page load, 'online'): keep its count live between runs.
  useEffect(() => {
    if (!target || deps !== browserDeps) return
    return useOfflineStore.subscribe((s) => {
      const attention = s.pendingLeads.filter((l) => l.sync_error).length
      setCounts((c) => (c ? { ...c, knocks: s.pendingLeads.length - attention, knocksNeedingAttention: attention } : c))
    })
  }, [target, deps])

  const view = handoffView({ counts, flushing, online, failedRuns })

  // Keep trying while something is left (the knock queue also retries on its own).
  useEffect(() => {
    if (!target || view.kind !== 'stuck' || !online) return
    const t = window.setTimeout(() => void run(false), RETRY_MS)
    return () => window.clearTimeout(t)
  }, [target, view.kind, online, run, counts])

  if (!target) return null
  const newHost = new URL(target).host

  return (
    <section
      role="status"
      aria-live="polite"
      className="border-b-4 border-indigo-600 bg-white px-4 py-4"
      style={{ color: '#2c2c2a' }}
    >
      <h2 className="text-lg font-bold">We&apos;ve moved</h2>
      <p className="mt-1 text-base">
        This app has a new address: <strong className="break-words">{newHost}</strong>
      </p>

      {view.kind === 'checking' && <p className="mt-2 text-base">Checking this phone for anything not sent yet…</p>}

      {view.kind === 'sending' && (
        <p className="mt-2 text-base">
          Sending <strong>{view.detail}</strong> saved on this phone first. Keep this page open.
        </p>
      )}

      {view.kind === 'stuck' && (
        <div className="mt-2 space-y-2">
          {view.detail && (
            <p className="text-base">
              <strong>{view.detail}</strong> {view.pending === 1 ? 'is' : 'are'} saved on this phone and not sent yet.{' '}
              {view.offline
                ? 'They will send when you have signal. Keep this page open.'
                : 'Keep this page open and tap Try again. Do not clear this app or its data.'}
            </p>
          )}
          {view.attention && (
            <p className="text-base">
              <strong>{view.attention}</strong> could not be saved by the server and need attention. They stay saved on this
              phone at this address. Tell your manager before you clear this app.
            </p>
          )}
          {view.photosUnreadable && (
            <p className="text-base">This phone&apos;s photo storage could not be checked, so unsent photos may be waiting here.</p>
          )}
          {!view.offline && (
            <button
              type="button"
              onClick={() => void run(true)}
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-lg border-2 border-indigo-600 bg-white px-4 text-base font-semibold text-indigo-700"
            >
              Try again
            </button>
          )}
          {view.canLeave && (
            <div>
              <a
                href={target}
                className="inline-flex min-h-[48px] w-full items-center justify-center rounded-lg bg-white px-4 py-2 text-center text-base font-semibold underline"
                style={{ color: '#2c2c2a' }}
              >
                Continue anyway to {newHost}
              </a>
              <p className="mt-1 text-sm">
                Left behind: {view.leftBehind}. It stays saved on this phone at this old address and will not be sent from
                the new one. Come back here to send it.
              </p>
            </div>
          )}
        </div>
      )}

      {view.kind === 'ready' && (
        <div className="mt-3">
          <a
            href={target}
            className="inline-flex min-h-[48px] w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-center text-base font-semibold text-white"
          >
            Everything is sent. Tap to continue at {newHost}
          </a>
          <p className="mt-2 text-sm">You will sign in once there. Then add the new address to your home screen in place of this one.</p>
        </div>
      )}
    </section>
  )
}
