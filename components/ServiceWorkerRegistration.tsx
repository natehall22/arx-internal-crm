'use client'

import { useEffect } from 'react'
import { cleanupLegacyServiceWorkers } from '@/lib/service-worker-scope'

/**
 * Retires the old `/sw.js` (deleted) and any `/`-scope registration left on a phone. Registers nothing: the only
 * service worker is the canvass one, registered by the canvass page at scope `/canvass`
 * (lib/service-worker-scope.ts). Safe to delete once every phone has loaded a page since 2026-11.
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    void cleanupLegacyServiceWorkers()
  }, [])
  return null
}
