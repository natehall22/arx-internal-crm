'use client'

import { createContext, useContext, useEffect, useState } from 'react'

import { DEFAULT_ORG_FEATURES, coerceOrgFeatures, type OrgFeatures } from '@/lib/org-features'
import { coerceClientBrandNames, GENERIC_BRAND_NAMES, type ClientBrandNames } from '@/lib/org-brand-client'
import { coerceClientOrgProfile, roofingOr, type ClientOrgProfile } from '@/lib/org-profile'
import type { OrgBootstrap } from '@/lib/org-bootstrap'

/** The root layout's server-resolved words + switches (components/OrgBootstrapProvider.tsx); null = not known from the address. */
export const OrgBootstrapContext = createContext<OrgBootstrap | null>(null)

/**
 * The ONE client fetch of `/api/me/effective-permissions` (Nav and every `useOrgFeatures` caller share it). Calls made
 * while one is in flight, or within a few seconds of it, reuse it — so a page with Nav + a gated component makes one
 * request, while a later page (Nav remounts) still gets fresh permissions and feature switches.
 */
const REUSE_MS = 5000
let shared: { at: number; promise: Promise<{ ok: boolean; status: number; data: unknown }> } | null = null
/** The last feature map the server returned in this tab, so a component mounted later starts with it (no flash). */
let lastKnown: OrgFeatures | null = null
/** Same for the company's industry profile (words, menu order, price book lists). */
let lastKnownProfile: ClientOrgProfile | null = null
/** Same for the company's names (contract screen, subs text, schedule board). */
let lastKnownBrand: ClientBrandNames | null = null

export function fetchEffectivePermissions(): Promise<{ ok: boolean; status: number; data: unknown }> {
  const now = Date.now()
  if (shared && now - shared.at < REUSE_MS) return shared.promise
  const promise = fetch('/api/me/effective-permissions', { cache: 'no-store', credentials: 'same-origin' })
    .then(async (res) => {
      const out = { ok: res.ok, status: res.status, data: await res.json().catch(() => null) }
      if (out.ok) {
        lastKnown = featuresFromEffectivePermissions(out.data)
        lastKnownProfile = profileFromEffectivePermissions(out.data)
        lastKnownBrand = brandFromEffectivePermissions(out.data)
      }
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

/** Pure: the company's industry profile out of an effective-permissions response (missing → roofing = today's app). */
export function profileFromEffectivePermissions(data: unknown): ClientOrgProfile {
  const flags = data && typeof data === 'object' ? (data as { flags?: { profile?: unknown } }).flags : undefined
  return coerceClientOrgProfile(flags?.profile)
}

/** Pure: the company's names out of an effective-permissions response (missing → generic words, never another company's). */
export function brandFromEffectivePermissions(data: unknown): ClientBrandNames {
  const flags = data && typeof data === 'object' ? (data as { flags?: { brand?: unknown } }).flags : undefined
  return coerceClientBrandNames(flags?.brand)
}

/** The company's chrome branding (Nav): name + logo hrefs; a missing field is null/blank, never another company's. */
export type NavBranding = { name: string; logoHref: string | null; logoDarkHref: string | null }

export function navBrandingFromEffectivePermissions(data: unknown): NavBranding {
  const o = data && typeof data === 'object' ? (data as { org?: unknown }).org : undefined
  const r = o && typeof o === 'object' ? (o as Record<string, unknown>) : {}
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return { name: s(r.name) ?? '', logoHref: s(r.logoHref), logoDarkHref: s(r.logoDarkHref) }
}

/** The company's names for client components — same shared fetch; `initial` (server-resolved) wins on first render. */
export function useOrgBrandNames(initial?: ClientBrandNames | null): ClientBrandNames {
  const [brand, setBrand] = useState<ClientBrandNames>(() => initial ?? lastKnownBrand ?? { ...GENERIC_BRAND_NAMES })
  useEffect(() => {
    let cancelled = false
    void fetchEffectivePermissions().then((r) => {
      if (!cancelled && r.ok) setBrand(brandFromEffectivePermissions(r.data))
    })
    return () => {
      cancelled = true
    }
  }, [])
  return brand
}

/**
 * The company's industry profile for client components (lib/org-profile.ts) — same shared fetch and first-render rule as
 * useOrgFeatures: `initial` (server-resolved — server pages pass it, so their first paint is right), else the root
 * layout's address-resolved profile, else what this tab last loaded, else roofing (today's words).
 */
export function useOrgProfile(initial?: ClientOrgProfile | null): ClientOrgProfile {
  const boot = useContext(OrgBootstrapContext)
  const [profile, setProfile] = useState<ClientOrgProfile>(() => initial ?? boot?.profile ?? lastKnownProfile ?? coerceClientOrgProfile(null))
  useEffect(() => {
    let cancelled = false
    void fetchEffectivePermissions().then((r) => {
      if (!cancelled && r.ok) setProfile(profileFromEffectivePermissions(r.data))
    })
    return () => {
      cancelled = true
    }
  }, [])
  return profile
}

/**
 * Company feature switches for client components. First render uses, in order: `initial` (the server-resolved map a
 * server page passes down — no flash), else the root layout's address-resolved map, else the last map this tab already loaded (Nav loads it on every page), else
 * every feature ON (what any org with nothing stored has). It then settles on the shared fetch. Pages and APIs behind a
 * switch are gated server-side regardless, so a first-paint guess can only show an entry point, never data.
 */
export function useOrgFeatures(initial?: OrgFeatures | null): OrgFeatures {
  const boot = useContext(OrgBootstrapContext)
  const [features, setFeatures] = useState<OrgFeatures>(() => initial ?? boot?.features ?? lastKnown ?? DEFAULT_ORG_FEATURES)
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
  lastKnownProfile = null
  lastKnownBrand = null
}

/**
 * Roofing-specific wording for a client component: `const rw = useRoofingWord()`; `rw('Roof report', 'Report')`.
 * Roofing (and the original company) keeps the first text byte-for-byte; any other profile reads the second (neutral) one.
 */
export function useRoofingWord(): <T extends string>(roofing: T, other: T) => T {
  const profile = useOrgProfile()
  return (roofing, other) => roofingOr(profile, roofing, other)
}

/** True for the roofing profile (and the original company, which resolves to it). Hide roofing-only fields with it. */
export function useIsRoofingProfile(): boolean {
  return roofingOr(useOrgProfile(), true, false)
}
