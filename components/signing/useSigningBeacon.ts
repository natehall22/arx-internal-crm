'use client'

import { useEffect } from 'react'

/** Tells the server a person opened the signing page (once). Never throws, never blocks the page. */
export function useSigningBeacon(kind: 'contract' | 'change-order' | 'signature-request', token: string): void {
  useEffect(() => {
    if (typeof fetch !== 'function') return
    try {
      void fetch('/api/signing/viewed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, token }), keepalive: true }).catch(() => {})
    } catch {
      /* a beacon */
    }
  }, [kind, token])
}
