/**
 * Moving reps from an old app address to the configured one (domain cutover, docs/domain-cutover.md).
 *
 * Why it exists: the canvass knock queue (localStorage) and the photo queues (IndexedDB `arx-job-photos`,
 * `arx-report-pending`) belong to the ORIGIN they were saved on. A rep sent straight to the new address would leave
 * unsent knocks and photos behind on the old one, where nothing would ever open them again. So on an old address /canvass
 * sends everything first and only then offers the link to the new address. It never redirects on its own.
 *
 * Pure parts only (tested in lib/__tests__/host-handoff.test.ts); the screen is MovedHostNotice in the canvass app.
 */
import { configuredAppHost, parseAppUrl } from '@/lib/app-url'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Where to continue, or null when no hand-off applies: no app address configured, already on it, local development, or a
 * Vercel preview/development deployment (their own throwaway hosts must not send testers to production).
 */
export function handoffTarget(input: {
  currentUrl: string
  appUrl: string | null | undefined
  vercelEnv?: string | null
}): string | null {
  const appOrigin = parseAppUrl(input.appUrl)
  const appHost = configuredAppHost(input.appUrl)
  if (!appOrigin || !appHost) return null
  if (input.vercelEnv === 'preview' || input.vercelEnv === 'development') return null
  let here: URL
  try {
    here = new URL(input.currentUrl)
  } catch {
    return null
  }
  if (LOCAL_HOSTS.has(here.hostname)) return null
  if (here.host.toLowerCase() === appHost.toLowerCase()) return null
  return `${appOrigin}${here.pathname}${here.search}`
}

export type PendingCounts = {
  /** Knocks waiting in the canvass offline queue that can still be sent. */
  knocks: number
  /** Knocks the server refused for good (a 4xx that a retry will not fix). Kept on the phone; shown, never blocking. */
  knocksNeedingAttention: number
  /** Job photos waiting in IndexedDB, including ones that stopped retrying. */
  jobPhotos: number
  /** Inspection-report photos stashed on the phone and not confirmed by the server. */
  reportPhotos: number
  /** The phone's photo storage could not be read (blocked, private mode, timed out): photos are unknown. */
  photosUnreadable: boolean
}

/** After this many runs that still left something unsent (while online), the rep may leave anyway. */
export const HANDOFF_LEAVE_AFTER_RUNS = 3

export type HandoffView =
  | { kind: 'checking' }
  | { kind: 'sending'; pending: number; detail: string }
  | {
      kind: 'stuck'
      pending: number
      /** What is still waiting to send ('' when nothing is). */
      detail: string
      offline: boolean
      /** Knocks the server refused; '' when none. */
      attention: string
      photosUnreadable: boolean
      /** Offer "Continue anyway": everything left either cannot be sent from here, or we tried enough times. */
      canLeave: boolean
      /** What stays behind on this address if the rep leaves now. */
      leftBehind: string
    }
  | { kind: 'ready' }

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "3 knocks, 2 photos" — what is still waiting to send. */
export function describePending(c: Pick<PendingCounts, 'knocks' | 'jobPhotos' | 'reportPhotos'>): string {
  const parts: string[] = []
  if (c.knocks > 0) parts.push(plural(c.knocks, 'knock', 'knocks'))
  const photos = c.jobPhotos + c.reportPhotos
  if (photos > 0) parts.push(plural(photos, 'photo', 'photos'))
  return parts.join(', ')
}

export function totalPending(c: Pick<PendingCounts, 'knocks' | 'jobPhotos' | 'reportPhotos'>): number {
  return c.knocks + c.jobPhotos + c.reportPhotos
}

/**
 * The one rule for what the screen shows. The plain continue link appears ONLY when a count was taken and nothing is
 * left; "Continue anyway" appears when what is left cannot be sent from here (refused knocks, unreadable photo storage)
 * or after HANDOFF_LEAVE_AFTER_RUNS tries, always saying what stays behind.
 */
export function handoffView(input: { counts: PendingCounts | null; flushing: boolean; online: boolean; failedRuns?: number }): HandoffView {
  const c = input.counts
  if (!c) return { kind: 'checking' }
  const pending = totalPending(c)
  if (pending === 0 && c.knocksNeedingAttention === 0 && !c.photosUnreadable) return { kind: 'ready' }
  const detail = describePending(c)
  if (pending > 0 && input.flushing && input.online) return { kind: 'sending', pending, detail }
  const attention = c.knocksNeedingAttention > 0 ? plural(c.knocksNeedingAttention, 'knock', 'knocks') : ''
  const leftBehind = [detail, attention, c.photosUnreadable ? 'any photos saved on this phone' : ''].filter(Boolean).join(', ')
  const canLeave = pending === 0 || (input.online && (input.failedRuns ?? 0) >= HANDOFF_LEAVE_AFTER_RUNS)
  return { kind: 'stuck', pending, detail, offline: !input.online, attention, photosUnreadable: c.photosUnreadable, canLeave, leftBehind }
}

/**
 * A knock the server answered with a 4xx that retrying will not fix (bad data, forbidden, gone). 401 (signed out),
 * 408 / 425 / 429 (timing) and every 5xx are worth retrying, so they stay plain pending.
 */
export function isPermanentKnockFailure(status: number): boolean {
  return status >= 400 && status < 500 && ![401, 408, 425, 429].includes(status)
}

/** Resolve within `ms` or reject: a blocked IndexedDB open can otherwise hang forever and pin the screen on "Checking". */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out')), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}
