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

/** Unregister the old `/`-scope registrations and delete the deleted worker's caches. Never throws. Returns how many were removed. */
export async function cleanupLegacyServiceWorkers(): Promise<number> {
  let removed = 0
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      for (const reg of regs) {
        if (!isLegacyRegistration(reg)) continue
        try {
          if (await reg.unregister()) removed += 1
        } catch {
          // try again on the next page load
        }
      }
    }
  } catch {
    // getRegistrations can reject in private modes; nothing to clean
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

/** Canvass page: retire the old `/` registration, then register the scoped worker and apply updates without a page reload. */
export async function registerCanvassServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  await cleanupLegacyServiceWorkers()
  const registration = await navigator.serviceWorker.register(CANVASS_SW_URL, { scope: CANVASS_SW_SCOPE })

  const activateWaiting = () => registration.waiting?.postMessage({ type: 'SKIP_WAITING' })
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing
    if (!worker) return
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) activateWaiting()
    })
  })
  activateWaiting()
  return registration
}
