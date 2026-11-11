/**
 * The ONE resolver for a company's industry profile (lib/industry-profiles.ts) merged with its own settings.
 * Client-safe (types only from supabase). Layers, lowest first: core app → industry profile → company settings.
 *
 * - Feature switches: `resolveOrgFeatures` (lib/org-features.ts) already applies profile defaults + saved switches; this
 *   module returns that same map, never a second rule.
 * - Words: `t(resolved, 'job')` (or `resolved.terms.job`). Roofing = today's words.
 * - Nav order / hidden pages, Today cards, price book add-on lists, starter reports: from the profile.
 *
 * Stored: `orgs.settings.profile = { id, version }`, written only by `applyIndustryProfile` (lib/org-profile-server.ts)
 * and the company seed, through mergeOrgSettings path ['profile']. Nothing stored (the original company) = roofing.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  BASE_TERMS,
  DEFAULT_INDUSTRY_PROFILE,
  INDUSTRY_PROFILES,
  storedProfileId,
  type IndustryProfile,
  type IndustryProfileId,
  type NavSectionId,
  type PricebookProfile,
  type TermKey,
  type Terms,
  type TodayProfile,
} from '@/lib/industry-profiles'
import { readOrgFeatureSettings, resolveOrgFeatures, type OrgFeatures } from '@/lib/org-features'

export const ORG_PROFILE_SETTINGS_KEY = 'profile'

export type ResolvedOrgProfile = {
  id: IndustryProfileId
  label: string
  /** The current definition's version. */
  version: number
  /** The version the company applied (null = nothing stored, i.e. roofing by default). */
  storedVersion: number | null
  /**
   * A stored profile id this build doesn't know (a removed/renamed profile, a typo in data). The company then runs on
   * roofing defaults (today's app) and the switch screen says so and lets the owner pick one. null = known or nothing stored.
   */
  unknownStoredId: string | null
  features: OrgFeatures
  terms: Terms
  nav: { order: readonly NavSectionId[]; hidden: readonly string[] }
  today: TodayProfile
  pricebook: PricebookProfile
  starterReports: readonly string[] | null
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** Pure: profile defaults + the company's own settings (`orgs.settings`, whole object). */
export function resolveOrgProfile(settings: unknown): ResolvedOrgProfile {
  const s = asObject(settings)
  const id = storedProfileId(s)
  const p: IndustryProfile = INDUSTRY_PROFILES[id]
  const stored = asObject(s[ORG_PROFILE_SETTINGS_KEY])
  const storedVersion = stored.version
  const storedRaw = ORG_PROFILE_SETTINGS_KEY in s && s[ORG_PROFILE_SETTINGS_KEY] != null ? (typeof stored.id === 'string' ? stored.id : String(JSON.stringify(s[ORG_PROFILE_SETTINGS_KEY])).slice(0, 60)) : null
  return {
    id,
    label: p.label,
    version: p.version,
    storedVersion: typeof storedVersion === 'number' && storedRaw === id ? storedVersion : null,
    unknownStoredId: storedRaw !== null && storedRaw !== id ? storedRaw : null,
    // Always the whole-settings form so the profile is applied even when the company saved no switch yet.
    features: resolveOrgFeatures({ features: asObject(s.features), profile: s[ORG_PROFILE_SETTINGS_KEY] ?? null }),
    terms: { ...BASE_TERMS, ...p.terms },
    nav: p.nav,
    today: p.today,
    pricebook: p.pricebook,
    starterReports: p.starterReports,
  }
}

/** Roofing with nothing stored — what a failed read or a missing org gets (today's app). */
export function defaultOrgProfile(): ResolvedOrgProfile {
  return resolveOrgProfile({})
}

/** A word for this company. */
export function t(profile: Pick<ResolvedOrgProfile, 'terms'> | null | undefined, key: TermKey): string {
  return profile?.terms[key] ?? BASE_TERMS[key]
}

/** Load and resolve a company's profile. Never throws: a failed read logs and returns roofing defaults (fail open, like features). */
export async function loadOrgProfile(client: SupabaseClient, orgId: string | null | undefined): Promise<ResolvedOrgProfile> {
  if (!orgId) return defaultOrgProfile()
  try {
    return resolveOrgProfile(await readOrgFeatureSettings(client, orgId))
  } catch (e) {
    console.error('loadOrgProfile: profile not readable, using defaults', orgId, e)
    return defaultOrgProfile()
  }
}

/* ------------------------------------------------------------------------ *
 * What the client needs (Nav, customer file tabs, price book forms) — sent on /api/me/effective-permissions.
 * ------------------------------------------------------------------------ */

export type ClientOrgProfile = Pick<ResolvedOrgProfile, 'id' | 'label' | 'terms' | 'nav' | 'pricebook'>

export function clientOrgProfile(p: ResolvedOrgProfile): ClientOrgProfile {
  return { id: p.id, label: p.label, terms: p.terms, nav: p.nav, pricebook: p.pricebook }
}

/** Pure: a profile that came over the wire (or is missing) → a full one; anything malformed → roofing defaults. */
export function coerceClientOrgProfile(v: unknown): ClientOrgProfile {
  const o = asObject(v)
  const id = storedProfileId({ profile: { id: o.id } })
  // Words / lists always come from this build's definition of that id, so a stale or tampered payload can't inject text.
  return clientOrgProfile(resolveOrgProfile(id === DEFAULT_INDUSTRY_PROFILE ? {} : { profile: { id } }))
}

/* ------------------------------------------------------------------------ *
 * Today cards
 * ------------------------------------------------------------------------ */

/** A Today row/queue in the shape lib/today.ts produces (only the text fields are touched). */
type TodayQueueLike = {
  id: string
  title: string
  empty?: string
  items?: ReadonlyArray<{ title: string; ref?: string; detail?: string; note?: string }>
}

/**
 * Pure: apply the profile's Today cards to queues from lib/today.ts — order, hidden, card titles / empty texts (exact
 * roofing wording → profile wording), and the row words: "Job 26-0012" → "<job word> 26-0012", "install <date>" →
 * "<install word> <date>". Roofing (no texts, today's words) returns the queues unchanged.
 */
export function applyTodayProfile<Q extends TodayQueueLike>(queues: readonly Q[], today: TodayProfile, terms: Pick<Terms, 'job' | 'install'> = BASE_TERMS): Q[] {
  const visible = queues.filter((q) => !today.hidden.includes(q.id))
  const rank = (q: Q) => {
    const i = today.order.indexOf(q.id)
    return i === -1 ? today.order.length : i
  }
  // Stable: equal ranks keep loader order.
  const ordered = visible.map((q, i) => ({ q, i })).sort((a, b) => rank(a.q) - rank(b.q) || a.i - b.i).map((x) => x.q)
  const jobWord = terms.job !== BASE_TERMS.job ? terms.job : null
  const installWord = terms.install !== BASE_TERMS.install ? terms.install.toLowerCase() : null
  const rowText = (v: string | undefined) => {
    if (v === undefined) return v
    let out = v
    if (jobWord) out = out.replace(/^Job(?= |$)/, jobWord)
    if (installWord) out = out.replace(/(^|· )install (?=\S)/g, `$1${installWord} `)
    return out
  }
  return ordered.map((q) => {
    if (!jobWord && !installWord && !today.texts[q.title] && !(q.empty && today.texts[q.empty])) return q
    return {
      ...q,
      title: today.texts[q.title] ?? q.title,
      ...(q.empty !== undefined ? { empty: today.texts[q.empty] ?? q.empty } : {}),
      ...(q.items
        ? { items: q.items.map((it) => ({ ...it, title: rowText(it.title)!, ...(it.ref !== undefined ? { ref: rowText(it.ref) } : {}), ...(it.detail !== undefined ? { detail: rowText(it.detail) } : {}), ...(it.note !== undefined ? { note: rowText(it.note) } : {}) })) }
        : {}),
    }
  })
}
