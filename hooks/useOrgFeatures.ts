'use client'

import { useEffect, useState } from 'react'

import { DEFAULT_ORG_FEATURES, coerceOrgFeatures, type OrgFeatures } from '@/lib/org-features'

/**
 * The ONE client fetch of `/api/me/effective-permissions` (Nav and every `useOrgFeatures` caller share it). Calls made
 * while one is in flight, or within a few seconds of it, reuse it — so a page with Nav + a gated component makes one
 * request, while a later page (Nav remounts) still gets fresh permissions and feature switches.
 */
const REUSE_MS = 5000
let shared: { at: number; promise: Promise<{ ok: boolean; status: number; data: unknown }> } | null = null
/** The last feature map the server returned in this tab, so a component mounted later starts with it (no flash). */
let lastKnown: OrgFeatures | null = null

export function fetchEffectivePermissions(): Promise<{ ok: boolean; status: number; data: unknown }> {
  const now = Date.now()
  if (shared && now - shared.at < REUSE_MS) return shared.promise
  const promise = fetch('/api/me/effective-permissions', { cache: 'no-store', credentials: 'same-origin' })
    .then(async (res) => {
      const out = { ok: res.ok, status: res.status, data: await res.json().catch(() => null) }
      if (out.ok) lastKnown = featuresFromEffectivePermissions(out.data)
      return out
    })
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
 * Company feature switches for client components. First render uses, in order: `initial` (the server-resolved map a
 * server page passes down — no flash), else the last map this tab already loaded (Nav loads it on every page), else
 * every feature ON (what any org with nothing stored has). It then settles on the shared fetch. Pages and APIs behind a
 * switch are gated server-side regardless, so a first-paint guess can only show an entry point, never data.
 */
export function useOrgFeatures(initial?: OrgFeatures | null): OrgFeatures {
  const [features, setFeatures] = useState<OrgFeatures>(() => initial ?? lastKnown ?? DEFAULT_ORG_FEATURES)
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

/** Tests only: forget the shared fetch and the last-known map. */
export function resetOrgFeaturesCacheForTests(): void {
  shared = null
  lastKnown = null
}
