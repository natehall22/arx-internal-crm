/**
 * Industry profiles — the template layer between the core app and a company's own settings (Nathan's per-business
 * customization decision, 2026-11-10: core → INDUSTRY PROFILE → company settings → roles/people).
 *
 * Pure data, client-safe. A profile only supplies DEFAULTS: anything the company saved itself wins (feature switches in
 * `settings.features`, its own trades in `org_trades`). The one reader is `lib/org-profile.ts` (`resolveOrgProfile`);
 * nothing else reads these definitions directly except `resolveOrgFeatures` (feature defaults) and the switch planner.
 *
 * `roofing` IS the app as it was before profiles existed: every field here equals today's words, order and lists, and an
 * org with no `settings.profile` resolves to it — so the original company's screens are byte-identical (test-locked in
 * lib/__tests__/industry-profiles.test.ts).
 *
 * VERSIONING: bump a profile's `version` whenever its definition changes. A company stores `{ id, version }` of what it
 * applied; defaults always come from the current definition, the stored version only says what the owner last saw.
 */
import type { OrgFeature } from '@/lib/org-features'
import type { OrgTradeSeed } from '@/lib/org-trades-admin'

export const INDUSTRY_PROFILE_IDS = ['roofing', 'lawn_landscape', 'exterior_cleaning', 'home_builder'] as const
export type IndustryProfileId = (typeof INDUSTRY_PROFILE_IDS)[number]
export const DEFAULT_INDUSTRY_PROFILE: IndustryProfileId = 'roofing'

export function isIndustryProfileId(v: unknown): v is IndustryProfileId {
  return typeof v === 'string' && (INDUSTRY_PROFILE_IDS as readonly string[]).includes(v)
}

/**
 * The words a profile can change. Small on purpose (not i18n): each key is used where it is listed.
 * - job / jobs: customer file Job tab, Nav "Jobs" section
 * - jobBoard: Nav link to /ops · productionBoard: the /ops page heading
 * - inspection / proposal / install / installed: customer file progress steps + "Next:" button
 * - subs: Settings → Subcontractors
 */
export const TERM_KEYS = ['job', 'jobs', 'jobBoard', 'productionBoard', 'inspection', 'proposal', 'install', 'installed', 'subs'] as const
export type TermKey = (typeof TERM_KEYS)[number]
export type Terms = Record<TermKey, string>

/** What each word is, for the profile switch screen ("now → after"). */
export const TERM_LABELS: Readonly<Record<TermKey, string>> = Object.freeze({
  job: 'A job',
  jobs: 'Jobs menu',
  jobBoard: 'Job board link',
  productionBoard: 'Job board heading',
  inspection: 'Inspection step',
  proposal: 'Proposal step',
  install: 'Install step',
  installed: 'Installed step',
  subs: 'Subcontractors (Settings)',
})

/** Today's words (= the roofing profile). Every other profile starts from these. */
export const BASE_TERMS: Readonly<Terms> = Object.freeze({
  job: 'Job',
  jobs: 'Jobs',
  jobBoard: 'Job Board',
  productionBoard: 'Production Board',
  inspection: 'Inspection',
  proposal: 'Proposal',
  install: 'Install',
  installed: 'Installed',
  subs: 'Subcontractors',
})

export type NavSectionId = 'today' | 'pipeline' | 'jobs' | 'customers' | 'money' | 'insights'
/** Today's section order (lib/nav-config.ts NAV_SECTIONS). */
export const BASE_NAV_ORDER: readonly NavSectionId[] = ['today', 'pipeline', 'jobs', 'customers', 'money', 'insights']

/**
 * Today screen cards. A card is a queue id produced by the loaders in lib/today.ts. `planned` cards belong to features
 * not built yet: they are listed so the profile says what it wants, and are never shown until a loader produces them.
 */
export type TodayProfile = {
  /** Card ids first, in this order; any other card keeps its loader order after them. Empty = loader order. */
  order: readonly string[]
  /** Card ids never shown for this profile. */
  hidden: readonly string[]
  /** Card title by today's (roofing) title — exact text match (lib/today.ts titles; parity-tested). */
  titles: Readonly<Record<string, string>>
  /** Wanted cards with no loader yet (shown nowhere; documented for the build list). */
  planned: ReadonlyArray<{ id: string; title: string; needs: string }>
}

/** A price book unit choice for add-ons (`pricebook_items.unit`, DB enum `unit`). */
export type PricebookUnit = { value: string; label: string }
export type PricebookProfile = {
  /** Add-on categories (`pricebook_items.adder_category`, free text). */
  adderCategories: readonly string[]
  /** Unit choices for a fixed-price add-on, in order. Roof-square units are still hidden when squaresPricing is off. */
  units: readonly PricebookUnit[]
}

export type IndustryProfile = {
  id: IndustryProfileId
  version: number
  label: string
  description: string
  /** Feature switch defaults; a key left out = ON (lib/org-features.ts). The company's own saved switch always wins. */
  features: Readonly<Partial<Record<OrgFeature, boolean>>>
  /** Starting trades (null = the standard list, lib/org-trades.ts DEFAULT_ORG_TRADES). */
  trades: readonly OrgTradeSeed[] | null
  /** Only the words that differ from BASE_TERMS. */
  terms: Readonly<Partial<Terms>>
  nav: { order: readonly NavSectionId[]; hidden: readonly string[] }
  today: TodayProfile
  pricebook: PricebookProfile
  /** Report template keys offered on Reports (lib/reporting/templates.ts); null = all of them. */
  starterReports: readonly string[] | null
}

/** Today's add-on units, in the order the add-on form shows them (app/admin/proposals/page.tsx). */
const BASE_UNITS: readonly PricebookUnit[] = [
  { value: 'each', label: 'Each' },
  { value: 'lf', label: 'Linear Foot' },
  { value: 'square', label: 'Square (roof)' },
  { value: 'per_sqft', label: 'Per sq ft (manual quantity)' },
  { value: 'sqft', label: 'Sq ft (from roof — auto)' },
  { value: 'job', label: 'Per Job' },
]
/** Units that need migration 202611100090 (DB enum `unit`): saving one before it is applied fails with a clear error. */
export const PROFILE_ONLY_UNITS: readonly string[] = ['visit', 'month', 'hour']

const NO_TODAY: TodayProfile = { order: [], hidden: [], titles: {}, planned: [] }

const roofing: IndustryProfile = {
  id: 'roofing',
  version: 1,
  label: 'Roofing',
  description: 'Storm and retail roofing: door knocking, inspections, insurance claims, roof measuring and squares pricing.',
  features: {},
  trades: null,
  terms: {},
  nav: { order: BASE_NAV_ORDER, hidden: [] },
  today: NO_TODAY,
  pricebook: {
    adderCategories: ['Ventilation', 'Gutters', 'Skylights', 'Chimney', 'Decking', 'Flashing', 'Other'],
    units: BASE_UNITS,
  },
  starterReports: null,
}

/** Off for every non-roofing profile: roof-only features. */
const ROOF_ONLY_OFF = { insurance: false, roofMeasure: false, stormAlerts: false, squaresPricing: false } as const

/** Reports that make sense without door knocking or setters. */
const SERVICE_REPORTS = [
  'sales-by-month',
  'sales-by-source',
  'leads-by-source',
  'pipeline-by-stage',
  'appointments-by-type',
  'referrals-by-partner',
  'payments-by-month',
  'ar-aging',
  'jobs-by-status',
  'profit-by-job',
  'profit-by-month',
  'cost-overruns',
  'costs-by-type',
  'payroll-by-week',
  'payroll-by-person',
] as const

const SERVICE_NAV_HIDDEN = ['/inside-sales', '/ops/checkups', '/projects']

const lawnLandscape: IndustryProfile = {
  id: 'lawn_landscape',
  version: 1,
  label: 'Lawn & landscape',
  description: 'Recurring lawn maintenance, landscape projects, land work, clean-ups and soft washing.',
  features: { canvassing: false, incentives: false, ...ROOF_ONLY_OFF },
  trades: [
    { label: 'Lawn care', matchKeywords: ['\\blawn', 'mow', 'edging', 'fertiliz'] },
    { label: 'Landscaping', matchKeywords: ['landscap', 'mulch', 'sod\\b', 'plant', 'shrub', 'hardscape', 'paver'] },
    { label: 'Tractor / land work', matchKeywords: ['tractor', 'grading', 'land clear', 'bush ?hog', 'brush'] },
    { label: 'Clean-up', matchKeywords: ['clean-?up', 'debris', 'haul'] },
    { label: 'Soft wash / pressure washing', matchKeywords: ['soft ?wash', 'pressure ?wash', 'power ?wash'] },
  ],
  terms: {
    job: 'Project',
    jobs: 'Work',
    jobBoard: 'Work board',
    productionBoard: 'Work board',
    inspection: 'Estimate visit',
    proposal: 'Quote',
    install: 'Work',
    installed: 'Done',
    subs: 'Crews',
  },
  nav: { order: ['today', 'jobs', 'customers', 'pipeline', 'money', 'insights'], hidden: SERVICE_NAV_HIDDEN },
  today: {
    order: ['unsigned-proposals', 'jobs-to-schedule', 'unscheduled-jobs', 'overdue-installs', 'awaiting-payment', 'today-appointments', 'outcomes-to-log', 'no-outcome'],
    hidden: [],
    titles: {
      'Proposals waiting for a signature': 'Quotes awaiting approval',
      'Proposals waiting over a week, still unsigned': 'Quotes waiting over a week',
      'Jobs to schedule': 'Projects to schedule',
      'Sold jobs with no install date': 'Approved projects with no date',
      'Installs past their date and not started': 'Projects past their date, not started',
      'Finished, waiting on payment': 'Finished, not paid yet',
      "Today's appointments": "Today's estimate visits",
      'Appointments with no outcome logged': 'Estimate visits with no outcome logged',
    },
    planned: [
      { id: 'todays-visits', title: "Today's visits and routes", needs: 'service plans + visits (Phase 2)' },
      { id: 'skipped-visits', title: 'Skipped visits', needs: 'visits with skip/pause reasons (Phase 2)' },
      { id: 'unpaid-invoices', title: 'Unpaid invoices', needs: 'per-visit / monthly invoicing (Phase 3)' },
    ],
  },
  pricebook: {
    adderCategories: ['Lawn care', 'Landscaping', 'Tractor / land work', 'Clean-up', 'Soft wash / pressure washing', 'Materials', 'Other'],
    units: [
      { value: 'visit', label: 'Per visit' },
      { value: 'month', label: 'Per month' },
      { value: 'per_sqft', label: 'Per sq ft' },
      { value: 'hour', label: 'Per hour' },
      { value: 'each', label: 'Each' },
      { value: 'job', label: 'Per job' },
    ],
  },
  starterReports: SERVICE_REPORTS,
}

const exteriorCleaning: IndustryProfile = {
  id: 'exterior_cleaning',
  version: 1,
  label: 'Exterior cleaning',
  description: 'Pressure washing, soft washing, window and gutter cleaning — one-off and repeat.',
  // Door knocking stays on: many cleaning companies sell door to door.
  features: { incentives: false, ...ROOF_ONLY_OFF },
  trades: [
    { label: 'Pressure washing', matchKeywords: ['pressure ?wash', 'power ?wash'] },
    { label: 'Soft wash', matchKeywords: ['soft ?wash', 'house wash', 'roof wash'] },
    { label: 'Window cleaning', matchKeywords: ['\\bwindows?\\b'] },
    { label: 'Gutter cleaning', matchKeywords: ['gutter'] },
  ],
  terms: { inspection: 'Estimate', proposal: 'Quote', install: 'Service', installed: 'Done', subs: 'Crews' },
  nav: { order: ['today', 'jobs', 'customers', 'pipeline', 'money', 'insights'], hidden: SERVICE_NAV_HIDDEN },
  today: {
    order: ['unsigned-proposals', 'jobs-to-schedule', 'awaiting-payment'],
    hidden: [],
    titles: {
      'Proposals waiting for a signature': 'Quotes awaiting approval',
      'Proposals waiting over a week, still unsigned': 'Quotes waiting over a week',
      'Sold jobs with no install date': 'Approved jobs with no date',
      'Installs past their date and not started': 'Jobs past their date, not started',
    },
    planned: [{ id: 'todays-visits', title: "Today's jobs and routes", needs: 'visits (Phase 2)' }],
  },
  pricebook: {
    adderCategories: ['Pressure washing', 'Soft wash', 'Window cleaning', 'Gutter cleaning', 'Other'],
    units: [
      { value: 'per_sqft', label: 'Per sq ft' },
      { value: 'lf', label: 'Linear Foot' },
      { value: 'each', label: 'Each' },
      { value: 'visit', label: 'Per visit' },
      { value: 'hour', label: 'Per hour' },
      { value: 'job', label: 'Per job' },
    ],
  },
  starterReports: SERVICE_REPORTS,
}

const homeBuilder: IndustryProfile = {
  id: 'home_builder',
  version: 1,
  label: 'Home builder',
  description: 'New homes and major remodels run as projects with many trades and subcontractors.',
  features: { canvassing: false, incentives: false, ...ROOF_ONLY_OFF },
  trades: [
    { label: 'Site work', matchKeywords: ['site work', 'grading', 'excavat', 'clearing'] },
    { label: 'Foundation', matchKeywords: ['foundation', 'footing', 'slab'] },
    { label: 'Framing', matchKeywords: ['framing', 'truss'] },
    { label: 'Roofing', matchKeywords: ['roof', 'shingle'] },
    { label: 'Plumbing', matchKeywords: ['plumb'] },
    { label: 'Electrical', matchKeywords: ['electric'] },
    { label: 'HVAC', matchKeywords: ['hvac', 'duct'] },
    { label: 'Finishes', matchKeywords: ['drywall', 'paint', 'trim', 'floor', 'cabinet'] },
  ],
  terms: { job: 'Project', jobs: 'Projects', jobBoard: 'Project board', productionBoard: 'Project board', inspection: 'Site visit', proposal: 'Bid', install: 'Build', installed: 'Built' },
  nav: { order: ['today', 'jobs', 'customers', 'pipeline', 'money', 'insights'], hidden: ['/inside-sales', '/ops/checkups', '/projects'] },
  today: {
    order: ['jobs-to-schedule', 'overdue-installs', 'unsigned-proposals', 'awaiting-payment'],
    hidden: [],
    titles: {
      'Proposals waiting for a signature': 'Bids waiting for a signature',
      'Proposals waiting over a week, still unsigned': 'Bids waiting over a week, still unsigned',
      'Jobs to schedule': 'Projects to schedule',
      'Sold jobs with no install date': 'Signed projects with no start date',
      'Installs past their date and not started': 'Projects past their start date',
    },
    planned: [],
  },
  pricebook: {
    adderCategories: ['Site work', 'Foundation', 'Framing', 'Roofing', 'Plumbing', 'Electrical', 'HVAC', 'Finishes', 'Allowances', 'Other'],
    units: [
      { value: 'each', label: 'Each' },
      { value: 'per_sqft', label: 'Per sq ft' },
      { value: 'lf', label: 'Linear Foot' },
      { value: 'hour', label: 'Per hour' },
      { value: 'job', label: 'Per job' },
    ],
  },
  starterReports: SERVICE_REPORTS,
}

export const INDUSTRY_PROFILES: Readonly<Record<IndustryProfileId, IndustryProfile>> = Object.freeze({
  roofing,
  lawn_landscape: lawnLandscape,
  exterior_cleaning: exteriorCleaning,
  home_builder: homeBuilder,
})

/** The profile id stored on a company (`settings.profile.id`), else roofing (today's app). Unknown ids → roofing. */
export function storedProfileId(settings: unknown): IndustryProfileId {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  const p = s.profile && typeof s.profile === 'object' && !Array.isArray(s.profile) ? (s.profile as Record<string, unknown>) : {}
  return isIndustryProfileId(p.id) ? p.id : DEFAULT_INDUSTRY_PROFILE
}
