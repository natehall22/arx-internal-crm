/**
 * The ONE place that decides which service worker lives where.
 *
 * Only the canvass app has a service worker: `/canvass-sw.js`, scope `/canvass` (served with
 * `Service-Worker-Allowed: /canvass`, see next.config.js). Before 2026-11 two workers (`/sw.js` and `/canvass-sw.js`)
 * both registered at scope `/`, and a scope holds ONE registration, so the script flipped on every move between CRM
 * pages and /canvass. `/sw.js` is deleted; phones that still hold either old `/`-scope registration are cleaned up here.
 *
 * Nothing in this file touches page storage (IndexedDB / localStorage). The offline lead queue (zustand persist key
 * `canvass-offline-store`) and the photo / report queues live in it and are never read or written here.
 * `ServiceWorkerRegistration.unregister()` and `caches.delete()` do not affect page storage.
 */

export const CANVASS_SW_URL = '/canvass-sw.js'
export const CANVASS_SW_SCOPE = '/canvass'

/** Scripts that were ever registered at scope `/`. Both are retired from that scope. */
const LEGACY_SCRIPT_PATHS = ['/sw.js', '/canvass-sw.js']
/** Cache names owned by the deleted `/sw.js`. Named explicitly: never delete caches we do not own. */
export const LEGACY_SW_CACHES = ['arx-crm-v2', 'arx-static-v2', 'arx-map-tiles-v2']

function pathOf(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    return new URL(url, 'https://x.invalid').pathname
  } catch {
    return null
  }
}

/** True for a registration at scope `/` whose script is one of the two retired ones. Scope `/canvass` never matches. */
export function isLegacyRegistration(reg: ServiceWorkerRegistration): boolean {
  if (pathOf(reg.scope) !== '/') return false
  const scripts = [reg.active, reg.waiting, reg.installing].map((w) => pathOf(w?.scriptURL))
  return scripts.some((p) => p !== null && LEGACY_SCRIPT_PATHS.includes(p))
}

/** A registration at exactly the canvass scope that is running (not just installing). */
function isActiveCanvassRegistration(reg: ServiceWorkerRegistration): boolean {
  return pathOf(reg.scope) === CANVASS_SW_SCOPE && !!reg.active && pathOf(reg.active.scriptURL) === CANVASS_SW_URL
}

/**
 * Unregister the old `/`-scope registrations and delete the deleted worker's caches. Never throws. Returns how many were removed.
 * Does nothing until the new `/canvass` worker is ACTIVE: a phone whose install failed (weak signal) keeps what it had
 * and retries on the next page load, so it is never left with no worker at all.
 */
export async function cleanupLegacyServiceWorkers(): Promise<number> {
  let removed = 0
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      if (!regs.some(isActiveCanvassRegistration)) return 0
      for (const reg of regs) {
        if (!isLegacyRegistration(reg)) continue
        try {
          if (await reg.unregister()) removed += 1
        } catch {
          // try again on the next page load
        }
      }
    } else {
      return 0
    }
  } catch {
    return 0 // getRegistrations can reject in private modes; nothing to clean
  }
  try {
    if (typeof caches !== 'undefined') {
      await Promise.all(LEGACY_SW_CACHES.map((name) => caches.delete(name).catch(() => false)))
    }
  } catch {
    // ignore
  }
  return removed
}

/** Resolves when the registration has an active worker; rejects if its install fails (then nothing legacy is touched). */
function whenActive(registration: ServiceWorkerRegistration): Promise<void> {
  if (registration.active) return Promise.resolve()
  const worker = registration.installing ?? registration.waiting
  if (!worker) return Promise.reject(new Error('no worker'))
  return new Promise((resolve, reject) => {
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') resolve()
      else if (worker.state === 'redundant') reject(new Error('install failed'))
    })
    if (worker.state === 'activated') resolve()
  })
}

/** True when a new worker is installed and waiting behind the running one. Never applied automatically (see applyWaitingUpdate). */
export function hasWaitingUpdate(registration: ServiceWorkerRegistration | null): boolean {
  return !!registration?.waiting && !!navigator.serviceWorker?.controller
}

/** Called only from the "New version" tap. The page reloads once, on the resulting controller change. */
export function applyWaitingUpdate(registration: ServiceWorkerRegistration | null): void {
  if (!registration?.waiting) {
    window.location.reload()
    return
  }
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  })
  registration.waiting.postMessage({ type: 'SKIP_WAITING' })
}

/**
 * Canvass page: register the scoped worker FIRST, retire the old `/` registration only once the new one is active.
 * An update is never forced onto a running page (a half-typed lead would be lost); the page asks the rep to tap.
 */
export async function registerCanvassServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  const registration = await navigator.serviceWorker.register(CANVASS_SW_URL, { scope: CANVASS_SW_SCOPE })
  whenActive(registration)
    .then(() => cleanupLegacyServiceWorkers())
    .catch(() => {})
  return registration
}
