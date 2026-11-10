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
  /** Knocks waiting in the canvass offline queue. */
  knocks: number
  /** Job photos waiting in IndexedDB, including ones that stopped retrying. */
  jobPhotos: number
  /** Inspection-report photos stashed on the phone and not confirmed by the server. */
  reportPhotos: number
}

export type HandoffView =
  | { kind: 'checking' }
  | { kind: 'sending'; pending: number; detail: string }
  | { kind: 'stuck'; pending: number; detail: string; offline: boolean }
  | { kind: 'ready' }

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "3 knocks, 2 photos" — what is still on this phone. */
export function describePending(c: PendingCounts): string {
  const parts: string[] = []
  if (c.knocks > 0) parts.push(plural(c.knocks, 'knock', 'knocks'))
  const photos = c.jobPhotos + c.reportPhotos
  if (photos > 0) parts.push(plural(photos, 'photo', 'photos'))
  return parts.join(', ')
}

export function totalPending(c: PendingCounts): number {
  return c.knocks + c.jobPhotos + c.reportPhotos
}

/**
 * The one rule for what the screen shows. The continue link appears ONLY when a count was taken and nothing is left;
 * a failed count (null) is treated as "not sure" and keeps the link hidden.
 */
export function handoffView(input: { counts: PendingCounts | null; flushing: boolean; online: boolean }): HandoffView {
  if (!input.counts) return { kind: 'checking' }
  const pending = totalPending(input.counts)
  if (pending === 0) return { kind: 'ready' }
  const detail = describePending(input.counts)
  if (input.flushing && input.online) return { kind: 'sending', pending, detail }
  return { kind: 'stuck', pending, detail, offline: !input.online }
}
