'use client'

import { useEffect, useState } from 'react'

import { ALL_FEATURES_ON, coerceOrgFeatures, type OrgFeatures } from '@/lib/org-features'

/**
 * The ONE client fetch of `/api/me/effective-permissions` (Nav and every `useOrgFeatures` caller share it). Calls made
 * while one is in flight, or within a few seconds of it, reuse it — so a page with Nav + a gated component makes one
 * request, while a later page (Nav remounts) still gets fresh permissions and feature switches.
 */
const REUSE_MS = 5000
let shared: { at: number; promise: Promise<{ ok: boolean; status: number; data: unknown }> } | null = null

export function fetchEffectivePermissions(): Promise<{ ok: boolean; status: number; data: unknown }> {
  const now = Date.now()
  if (shared && now - shared.at < REUSE_MS) return shared.promise
  const promise = fetch('/api/me/effective-permissions', { cache: 'no-store', credentials: 'same-origin' })
    .then(async (res) => ({ ok: res.ok, status: res.status, data: await res.json().catch(() => null) }))
    .catch(() => ({ ok: false, status: 0, data: null }))
  shared = { at: now, promise }
  return promise
}

/** Pure: the company feature map out of an effective-permissions response (missing → every feature on). */
export function featuresFromEffectivePermissions(data: unknown): OrgFeatures {
  const flags = data && typeof data === 'object' ? (data as { flags?: { features?: unknown } }).flags : undefined
  return coerceOrgFeatures(flags?.features)
}

/**
 * Company feature switches for client components. Starts with every feature ON (what any org with nothing
 * stored has) and settles once the shared fetch returns; pages behind a switch are also gated server-side.
 */
export function useOrgFeatures(): OrgFeatures {
  const [features, setFeatures] = useState<OrgFeatures>(ALL_FEATURES_ON)
  useEffect(() => {
    let cancelled = false
    void fetchEffectivePermissions().then((r) => {
      if (!cancelled && r.ok) setFeatures(featuresFromEffectivePermissions(r.data))
    })
    return () => {
      cancelled = true
    }
  }, [])
  return features
}
