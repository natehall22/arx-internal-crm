/**
 * Switching a company's industry profile (Settings → Industry profile, owners only; API /api/admin/industry-profile).
 * Server only (service-role client). The pure planner says exactly what will change; applying never deletes data:
 *   - `settings.profile = { id, version }` (mergeOrgSettings path ['profile'] — the one writer of that key, with the seed);
 *   - trades: add-only (lib/org-trades-admin planOrgTradesAddOnly) — nothing renamed or turned off;
 *   - feature switches: the company's own saved switches are kept (they win over any profile) unless the owner asks to
 *     go back to the profile's (`resetFeatures`), which removes only the saved switch keys under settings.features.
 * Words, menu order, Today cards, price book lists and starter reports simply follow the profile (code defaults).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { INDUSTRY_PROFILES, TERM_KEYS, type IndustryProfileId, type TermKey } from '@/lib/industry-profiles'
import { ORG_FEATURE_DEFS, ORG_FEATURE_KEYS, ORG_FEATURES_SETTINGS_KEY, readOrgFeatureSettings, resolveOrgFeatures, type OrgFeature } from '@/lib/org-features'
import { ORG_PROFILE_SETTINGS_KEY, resolveOrgProfile } from '@/lib/org-profile'
import { mergeOrgSettings } from '@/lib/org-settings'
import { DEFAULT_ORG_TRADES, type OrgTrade } from '@/lib/org-trades'
import { applyOrgTradesSeed, planOrgTradesAddOnly, readOrgTradesForSeed, type OrgTradeSeed, type OrgTradesSeedPlan } from '@/lib/org-trades-admin'

export type ProfileSwitchPlan = {
  from: { id: IndustryProfileId; label: string }
  to: { id: IndustryProfileId; label: string; version: number; description: string }
  resetFeatures: boolean
  /** Every feature whose on/off changes, plus own switches that keep a feature different from the new profile. */
  features: Array<{ key: OrgFeature; label: string; now: boolean; after: boolean; keptByOwnSwitch: boolean }>
  /** null = the trades table is not there yet (migration 202611060030): trades are left alone. */
  trades: { add: string[]; turnOn: string[]; keep: string[] } | null
  words: Array<{ key: TermKey; now: string; after: string }>
  /** Plain lines for the rest (menu, Today, price book, reports). */
  other: string[]
  /** Nothing would change. */
  noChange: boolean
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** The trades a profile starts with; roofing = the standard list. */
export function profileTradeSeeds(id: IndustryProfileId): OrgTradeSeed[] {
  return [...(INDUSTRY_PROFILES[id].trades ?? DEFAULT_ORG_TRADES.map((t) => ({ label: t.label, matchKeywords: t.matchKeywords })))]
}

/**
 * Pure: what switching to `to` changes. `settings` = the company's `{ features, profile }` (whole-settings shape);
 * `trades` = its org_trades rows (null when the table is missing).
 */
export function planProfileSwitch(settings: unknown, trades: readonly OrgTrade[] | null, to: IndustryProfileId, opts: { resetFeatures?: boolean } = {}): ProfileSwitchPlan {
  const s = asObject(settings)
  const now = resolveOrgProfile(s)
  const own = asObject(s[ORG_FEATURES_SETTINGS_KEY])
  const resetFeatures = opts.resetFeatures === true
  const afterSettings = { [ORG_FEATURES_SETTINGS_KEY]: resetFeatures ? {} : own, [ORG_PROFILE_SETTINGS_KEY]: { id: to, version: INDUSTRY_PROFILES[to].version } }
  const after = resolveOrgProfile(afterSettings)
  const profileOnly = resolveOrgFeatures({ features: {}, profile: { id: to } })

  const features: ProfileSwitchPlan['features'] = []
  for (const key of ORG_FEATURE_KEYS) {
    const keptByOwnSwitch = !resetFeatures && typeof own[key] === 'boolean' && own[key] !== profileOnly[key]
    if (now.features[key] !== after.features[key] || keptByOwnSwitch) {
      features.push({ key, label: ORG_FEATURE_DEFS[key].label, now: now.features[key], after: after.features[key], keptByOwnSwitch })
    }
  }

  let tradePlan: ProfileSwitchPlan['trades'] = null
  let tradesSeed: OrgTradesSeedPlan | null = null
  if (trades) {
    tradesSeed = planOrgTradesAddOnly(trades, profileTradeSeeds(to))
    const existingSlugs = new Set(trades.map((t) => t.slug))
    const wanted = new Set(profileTradeSeeds(to).map((w) => w.label.toLowerCase()))
    const base = trades.length ? trades : DEFAULT_ORG_TRADES
    tradePlan = {
      add: tradesSeed.insert.filter((t) => !existingSlugs.has(t.slug) && wanted.has(t.label.toLowerCase())).map((t) => t.label),
      turnOn: tradesSeed.update.map((u) => trades.find((t) => t.slug === u.slug)?.label ?? u.slug),
      keep: base.filter((t) => t.active && !wanted.has(t.label.toLowerCase())).map((t) => t.label),
    }
  }

  const words = TERM_KEYS.filter((k) => now.terms[k] !== after.terms[k]).map((k) => ({ key: k, now: now.terms[k], after: after.terms[k] }))
  const other: string[] = []
  if (now.id === to && now.storedVersion !== INDUSTRY_PROFILES[to].version) {
    other.push(`Records ${INDUSTRY_PROFILES[to].label} v${INDUSTRY_PROFILES[to].version} on your company${now.storedVersion === null ? '' : ` (you have v${now.storedVersion})`}`)
  }
  if (now.id !== to) {
    other.push(`Menu order: ${after.nav.order.map((id) => (id === 'jobs' ? after.terms.jobs : id[0].toUpperCase() + id.slice(1))).join(' · ')}`)
    if (after.nav.hidden.length) other.push(`Menu hides: ${after.nav.hidden.join(', ')} (the pages still work for anyone allowed)`)
    const planned = after.today.planned.map((c) => `${c.title} (needs ${c.needs})`)
    if (planned.length) other.push(`Today cards not built yet, hidden until they exist: ${planned.join('; ')}`)
    other.push(`Price book add-on categories: ${after.pricebook.adderCategories.join(', ')}`)
    other.push(`Price book units: ${after.pricebook.units.map((u) => u.label).join(', ')}`)
    other.push(after.starterReports ? `Reports: ${after.starterReports.length} starter reports` : 'Reports: every report')
  }
  const tradesChange = !!tradePlan && (tradePlan.add.length > 0 || tradePlan.turnOn.length > 0)
  const featureChange = features.some((f) => f.now !== f.after) || (resetFeatures && Object.keys(own).some((k) => (ORG_FEATURE_KEYS as string[]).includes(k)))
  return {
    from: { id: now.id, label: now.label },
    to: { id: to, label: INDUSTRY_PROFILES[to].label, version: INDUSTRY_PROFILES[to].version, description: INDUSTRY_PROFILES[to].description },
    resetFeatures,
    features,
    trades: tradePlan,
    words,
    other,
    noChange: now.id === to && now.storedVersion === INDUSTRY_PROFILES[to].version && !tradesChange && !featureChange,
  }
}

/** Read what the planner needs for one company. */
export async function loadProfileSwitchInputs(client: SupabaseClient, orgId: string): Promise<{ settings: { features: unknown; profile?: unknown }; trades: OrgTrade[] | null }> {
  const [settings, trades] = await Promise.all([readOrgFeatureSettings(client, orgId), readOrgTradesForSeed(client, orgId)])
  return { settings, trades }
}

/**
 * Apply a profile switch. Order: trades (add-only), feature reset (if asked), then the profile key LAST — so a failure
 * part-way leaves the old profile showing and a re-run finishes the job (every step is idempotent).
 */
export async function applyIndustryProfile(
  client: SupabaseClient,
  orgId: string,
  userId: string | null,
  to: IndustryProfileId,
  opts: { resetFeatures?: boolean } = {}
): Promise<{ plan: ProfileSwitchPlan }> {
  const { settings, trades } = await loadProfileSwitchInputs(client, orgId)
  const plan = planProfileSwitch(settings, trades, to, opts)
  if (trades) {
    const tradesPlan = planOrgTradesAddOnly(trades, profileTradeSeeds(to))
    if (tradesPlan.insert.length || tradesPlan.update.length) await applyOrgTradesSeed(client, orgId, userId, tradesPlan)
  }
  if (opts.resetFeatures) {
    const { error } = await mergeOrgSettings(client, orgId, {}, { path: [ORG_FEATURES_SETTINGS_KEY], remove: [...ORG_FEATURE_KEYS] })
    if (error) throw new Error(`feature switches: ${error}`)
  }
  const { error } = await mergeOrgSettings(client, orgId, { id: to, version: INDUSTRY_PROFILES[to].version }, { path: [ORG_PROFILE_SETTINGS_KEY] })
  if (error) throw new Error(`profile: ${error}`)
  return { plan }
}
