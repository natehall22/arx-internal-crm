/**
 * Per-company feature switches — the ONE reader. Stored as booleans under `orgs.settings.features`
 * (`{ canvassing: false, … }`), written ONLY by PATCH /api/admin/settings `type: 'features'` (super admins) through
 * `mergeOrgSettings` with path ['features'].
 *
 * Defaults come from the company's industry profile (`settings.profile`, lib/industry-profiles.ts; a saved switch always
 * wins), else the feature's own default: ON (`defaultOn` left out), so an org with no `features` key (the original company
 * today) behaves exactly as before with zero data changes. A feature with `defaultOn: false` (a new module the original
 * company never had, e.g. service plans) is the reverse: only an explicit `true` (saved, or from the profile) turns it
 * on. Turning a feature off hides its entry points (nav,
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
  servicePlans: {
    label: 'Service plans (recurring visits)',
    description: 'Recurring service for a property (weekly mowing, monthly cleaning) with seasons, visits put on the calendar automatically, the Visits schedule and the crew phone list.',
    defaultOn: false,
  },
  timeTracking: {
    label: 'Crew time clock',
    description: 'In-house crews clock in and out on their phone (one tap for the whole crew), staff clock in on the job page, and hours go to payroll and job labor cost. Subcontractors never see a clock.',
    defaultOn: false,
  },
  hourlyBilling: {
    label: 'Hourly billing (time & materials)',
    description: 'Bill a job or a plan by the hour: crew and machine hours from the time clock (or typed for subs) become invoice lines after your rounding and minimum rules, on the Hours to bill screen.',
    defaultOn: false,
  },
  projectTools: {
    label: 'Project tools (budgets, selections, schedule, daily log)',
    description: 'Budget vs actual by cost code on each job, customer selections with allowances (overages become signed change orders), a stage schedule you can start from a template, and a one-tap daily log with photos.',
    defaultOn: false,
  },
  onlinePayments: {
    label: 'Online payments (Stripe)',
    description: 'Customers pay invoices and deposits by card or bank from a link, save a card for automatic payments on service plans, and payments are recorded on their own. Money goes to your own Stripe account.',
    defaultOn: false,
  },
  quickbooks: {
    label: 'QuickBooks',
    description: 'Connect your own QuickBooks Online company so sales, payments and bills can flow to your bookkeeper. Connecting does not send anything by itself.',
    defaultOn: false,
  },
  customerMessages: {
    label: 'Automatic customer emails',
    description: 'Visit reminders, “on the way” and “done” emails, quote follow-ups and invoice reminders, sent on their own. Each one is turned on separately in Settings → Customer messages.',
    defaultOn: false,
  },
  aiConnector: {
    label: 'AI connector (Claude, ChatGPT)',
    description: 'People can connect their own AI app to look things up in the CRM as themselves. By default read-only; the AI sees only what that person can see, and every request is logged.',
    defaultOn: false,
  },
  aiConnectorWrites: {
    label: 'AI can make changes',
    description: 'Lets connected AI apps PROPOSE changes (add a note, log a call, add a lead or customer, schedule a visit, add a cost, start a draft invoice or order). The person sees exactly what will change and confirms it first; nothing is sent, paid, deleted or approved. Needs the AI connector on, and each person must also allow it when they connect.',
    defaultOn: false,
  },
  customerPortal: {
    label: 'Customer portal',
    description: 'Customers sign in with a link emailed to them and see their own visits, invoices, quotes, shared documents and plan, pay, and message you. Nothing internal is ever shown.',
    defaultOn: false,
  },
  quoteApproval: {
    label: 'Online quote approval',
    description: 'Send customers a quote link: they tick the optional items, watch the total and tax update, approve with their name, and pay a deposit by card. An approved quote becomes the signed sale.',
    defaultOn: false,
  },
} as const satisfies Record<string, { label: string; description: string; defaultOn?: boolean }>

export type OrgFeature = keyof typeof ORG_FEATURE_DEFS
export type OrgFeatures = Record<OrgFeature, boolean>

export const ORG_FEATURE_KEYS = Object.keys(ORG_FEATURE_DEFS) as OrgFeature[]

export function isOrgFeature(v: unknown): v is OrgFeature {
  return typeof v === 'string' && (ORG_FEATURE_KEYS as string[]).includes(v)
}

/** A feature's value when nothing is stored for it: ON unless its definition says `defaultOn: false`. */
export function featureDefaultOn(k: OrgFeature): boolean {
  return (ORG_FEATURE_DEFS[k] as { defaultOn?: boolean }).defaultOn !== false
}

/** What an org with nothing stored gets: every feature at its default (all ON except the `defaultOn: false` ones). */
export const DEFAULT_ORG_FEATURES: Readonly<OrgFeatures> = Object.freeze(
  Object.fromEntries(ORG_FEATURE_KEYS.map((k) => [k, featureDefaultOn(k)])) as OrgFeatures
)

/** One stored / sent value → the feature's state: a boolean wins, anything else is the default. */
function featureValue(k: OrgFeature, v: unknown): boolean {
  return typeof v === 'boolean' ? v : featureDefaultOn(k)
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/**
 * Pure: the feature map from either the whole `orgs.settings` object or the `features` object itself
 * (`{ features: … }` / `{ profile: … }` = the whole settings). Order: the company's own saved switch (a boolean) wins,
 * else the industry profile's default (`settings.profile`, lib/industry-profiles.ts), else the feature's own default
 * (`featureDefaultOn`). With no profile stored the default is roofing, which sets none — so only an explicit `false`
 * turns an original feature off, exactly as before, and a `defaultOn: false` module (service plans) stays off.
 * Unknown keys are ignored.
 */
export function resolveOrgFeatures(stored: unknown): OrgFeatures {
  const obj = asObject(stored)
  const whole = ORG_FEATURES_SETTINGS_KEY in obj || 'profile' in obj
  const features = whole ? asObject(obj[ORG_FEATURES_SETTINGS_KEY]) : obj
  const defaults = INDUSTRY_PROFILES[storedProfileId(whole ? obj : null)].features
  const out = { ...DEFAULT_ORG_FEATURES }
  for (const k of ORG_FEATURE_KEYS) {
    const own = features[k]
    const profileDefault = defaults[k]
    // Profile key left out = the feature's own default (NOT always ON): a `defaultOn: false` module stays off for roofing.
    out[k] = typeof own === 'boolean' ? own : typeof profileDefault === 'boolean' ? profileDefault : featureDefaultOn(k)
  }
  return out
}

/** Pure: a feature map that came over the wire (or is missing) → a full map, missing keys at their default. */
export function coerceOrgFeatures(v: unknown): OrgFeatures {
  const obj = asObject(v)
  const out = { ...DEFAULT_ORG_FEATURES }
  for (const k of ORG_FEATURE_KEYS) out[k] = featureValue(k, obj[k])
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
 * Load an org's features. Never throws: a failed read is logged and every feature is at its default (fail open for the
 * original features — what an org with nothing stored gets; this only hides UI and never guards money or private data).
 */
export async function loadOrgFeatures(client: SupabaseClient, orgId: string | null | undefined): Promise<OrgFeatures> {
  if (!orgId) return { ...DEFAULT_ORG_FEATURES }
  try {
    return resolveOrgFeatures(await readOrgFeatureSettings(client, orgId))
  } catch (e) {
    console.error('loadOrgFeatures: org features not readable, using defaults', orgId, e)
    return { ...DEFAULT_ORG_FEATURES }
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
