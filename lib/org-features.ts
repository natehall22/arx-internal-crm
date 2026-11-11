/**
 * Per-company feature switches — the ONE reader. Stored as booleans under `orgs.settings.features`
 * (`{ canvassing: false, … }`), written ONLY by PATCH /api/admin/settings `type: 'features'` (super admins) through
 * `mergeOrgSettings` with path ['features'].
 *
 * Defaults come from the company's industry profile (`settings.profile`, lib/industry-profiles.ts; a saved switch always
 * wins). With no profile stored (roofing) every feature defaults to ON: only an explicit `false` turns one off, so an org with no `features` key (the
 * original company today) behaves exactly as before with zero data changes. Turning a feature off hides its entry points (nav,
 * settings links, pages → 404, key API routes → 403); it never deletes data and never changes how anything is
 * computed — turning it back on shows everything as it was.
 *
 * Client-safe (types only from supabase). Server pages / API routes use `lib/org-features-server.ts`, which reads
 * through `loadOrgFeatures` here; client components get the resolved map from `/api/me/effective-permissions`
 * (`flags.features`, hook `useOrgFeatures`).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { INDUSTRY_PROFILES, storedProfileId } from '@/lib/industry-profiles'

export const ORG_FEATURES_SETTINGS_KEY = 'features'

/** Feature key → what an owner sees on the switch screen (plain words; order = screen order). */
export const ORG_FEATURE_DEFS = {
  canvassing: {
    label: 'Door knocking (Canvass app)',
    description: 'The Canvass map for reps, pins, storm and roof-age layers, and canvass work areas.',
  },
  insurance: {
    label: 'Insurance claims',
    description: 'Insurance job source, claim stage and claim number on jobs, insurance agreements, and the Insurance call list.',
  },
  roofMeasure: {
    label: 'Roof & exterior measuring',
    description: 'The satellite roof measure tool, “Load roof”, exterior measure (phone LiDAR and photos), and the website instant roof estimate.',
  },
  incentives: {
    label: 'Sisu incentives',
    description: 'Heats, badges, leaderboard, accountability goals and the Incentives page. Setter ramp and bonus approval (pay) stay.',
  },
  stormAlerts: {
    label: 'Storm alerts',
    description: 'Hail and wind hits matched to your deals and customers, the Storm call list, and the storm list in the morning email.',
  },
  squaresPricing: {
    label: 'Roof squares pricing',
    description: 'Pricing by the roofing square (100 sq ft) and the waste-factor step in proposals and the price book.',
  },
} as const satisfies Record<string, { label: string; description: string }>

export type OrgFeature = keyof typeof ORG_FEATURE_DEFS
export type OrgFeatures = Record<OrgFeature, boolean>

export const ORG_FEATURE_KEYS = Object.keys(ORG_FEATURE_DEFS) as OrgFeature[]

export function isOrgFeature(v: unknown): v is OrgFeature {
  return typeof v === 'string' && (ORG_FEATURE_KEYS as string[]).includes(v)
}

/** Every feature on — what an org with nothing stored gets. */
export const ALL_FEATURES_ON: Readonly<OrgFeatures> = Object.freeze(
  Object.fromEntries(ORG_FEATURE_KEYS.map((k) => [k, true])) as OrgFeatures
)

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/**
 * Pure: the feature map from either the whole `orgs.settings` object or the `features` object itself
 * (`{ features: … }` / `{ profile: … }` = the whole settings). Order: the company's own saved switch (a boolean) wins,
 * else the industry profile's default (`settings.profile`, lib/industry-profiles.ts), else ON. With no profile stored the
 * default is roofing, whose defaults are all ON — so only an explicit `false` turns a feature off, exactly as before.
 * Unknown keys are ignored.
 */
export function resolveOrgFeatures(stored: unknown): OrgFeatures {
  const obj = asObject(stored)
  const whole = ORG_FEATURES_SETTINGS_KEY in obj || 'profile' in obj
  const features = whole ? asObject(obj[ORG_FEATURES_SETTINGS_KEY]) : obj
  const defaults = INDUSTRY_PROFILES[storedProfileId(whole ? obj : null)].features
  const out = { ...ALL_FEATURES_ON }
  for (const k of ORG_FEATURE_KEYS) {
    const own = features[k]
    out[k] = typeof own === 'boolean' ? own : defaults[k] !== false
  }
  return out
}

/** Pure: a feature map that came over the wire (or is missing) → a full map, missing keys ON. */
export function coerceOrgFeatures(v: unknown): OrgFeatures {
  const obj = asObject(v)
  const out = { ...ALL_FEATURES_ON }
  for (const k of ORG_FEATURE_KEYS) if (obj[k] === false) out[k] = false
  return out
}

/** A save from the switch screen: `{ features: { canvassing: false } }` → keys to merge, or why not. */
export function parseOrgFeaturesPatch(body: unknown): { set: Partial<OrgFeatures> } | { error: string } {
  const patch = asObject(asObject(body).features)
  const set: Partial<OrgFeatures> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (!isOrgFeature(k)) return { error: `Unknown feature: ${k}` }
    if (typeof v !== 'boolean') return { error: `${ORG_FEATURE_DEFS[k].label} must be on or off` }
    set[k] = v
  }
  if (Object.keys(set).length === 0) return { error: 'Nothing to save' }
  return { set }
}

/**
 * The one read of the settings the feature map (and lib/org-profile.ts) needs: `settings.features` + `settings.profile`,
 * returned as a whole-settings-shaped object. Throws on a read error (callers decide how to fail).
 */
export async function readOrgFeatureSettings(client: SupabaseClient, orgId: string): Promise<{ features: unknown; profile?: unknown }> {
  const { data, error } = await client.from('orgs').select('features:settings->features, profile:settings->profile').eq('id', orgId).maybeSingle()
  if (error) throw error
  const row = (data ?? {}) as { features?: unknown; profile?: unknown }
  return row.profile == null ? { features: row.features ?? {} } : { features: row.features ?? {}, profile: row.profile }
}

/**
 * Load an org's features. Never throws: a failed read is logged and every feature is ON (fail open — the default
 * an org with nothing stored gets; this only hides UI and never guards money or private data).
 */
export async function loadOrgFeatures(client: SupabaseClient, orgId: string | null | undefined): Promise<OrgFeatures> {
  if (!orgId) return { ...ALL_FEATURES_ON }
  try {
    return resolveOrgFeatures(await readOrgFeatureSettings(client, orgId))
  } catch (e) {
    console.error('loadOrgFeatures: org features not readable, using all on', orgId, e)
    return { ...ALL_FEATURES_ON }
  }
}

/** Job / opportunity columns that only mean something for insurance work (PATCH allow-lists in ops jobs + opportunities). */
export const INSURANCE_PATCH_FIELDS: readonly string[] = [
  'insurance_stage',
  'acv_amount',
  'depreciation_amount',
  'supplement_amount',
  'claim_number',
  'insurance_company',
  'adjuster_name',
  'adjuster_phone',
]

/**
 * Pure: the insurance fields a PATCH body tries to SET (a value other than null/''), plus `job_source` when it is set
 * to 'insurance'. Clearing a field or setting job_source 'retail' is always allowed, so turning Insurance off never
 * blocks cleaning old data up.
 */
export function insuranceFieldsSetInPatch(body: unknown): string[] {
  const b = asObject(body)
  const hits = INSURANCE_PATCH_FIELDS.filter((k) => k in b && b[k] !== null && b[k] !== '')
  if (b.job_source === 'insurance') hits.unshift('job_source')
  return hits
}

/** Report datasets that belong to one feature (lib/reporting/catalog.ts keys): hidden from Reports when it is off. */
export const FEATURE_REPORT_DATASETS: Readonly<Partial<Record<OrgFeature, readonly string[]>>> = {
  canvassing: ['canvass_doors'],
  roofMeasure: ['instant_estimate_accuracy'],
}

/** Pure: is this report dataset hidden because the company switched its feature off? */
export function reportDatasetHidden(datasetKey: string, features: OrgFeatures): boolean {
  return ORG_FEATURE_KEYS.some((f) => !features[f] && (FEATURE_REPORT_DATASETS[f] ?? []).includes(datasetKey))
}
