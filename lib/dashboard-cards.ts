/**
 * The dashboard's cards: ONE catalog (Nathan, 2026-11-16). Pure data + rules, client-safe.
 *
 * A dashboard is either
 *   - the CLASSIC field-sales dashboard (doors, contacts, inspections, sits, closer stats, progress vs goals) — roofing and
 *     any company with no profile list: `app/dashboard/DashboardClient.tsx`, rendered exactly as before; its six sections are
 *     the `classic-*` cards below and can only be switched on or off (their place on the page is fixed), or
 *   - an ordered list of cards (everything else), each reading from an EXISTING source — never a new count or new money math.
 *
 * Sources a card may name (test-locked in lib/__tests__/dashboard-cards.test.ts):
 *   report  — the one report runner (lib/reporting/run.ts) over an rpt_* view, with the viewer's own scope and money fence;
 *   loader  — the loader a Today queue is built on (unpaid invoices, service visits) or the one a screen already uses
 *             (service plans, the time week), called as-is;
 *   none    — NO existing source: the card is listed so the owner can see it is wanted, is never drawn and cannot be added.
 *
 * Who sees a card: `audience` (owner = all cards; sales = their own numbers; crew = their crew's work, never money).
 * `money` says what a card needs: 'financials' = reports:financials (the one money permission); 'own' = a sale price on the
 * viewer's own deals (the report runner decides — see DatasetColumn.own). A person WITH reports:financials also sees the
 * 'financials' cards whatever their audience; field roles are denied before any of this (lib/dashboard-cards-server.ts).
 *
 * Stored per company at `orgs.settings.dashboardCards = { cards: [{ key, goal? }] }`, written ONLY by
 * `saveDashboardCards` (lib/dashboard-cards-server.ts) through mergeOrgSettings path ['dashboardCards']. Nothing stored =
 * the industry profile's starting list (`profile.dashboard.cards`; null = the classic dashboard).
 */
import type { OrgFeature, OrgFeatures } from '@/lib/org-features'
import type { ReportSpec } from '@/lib/reporting/report-spec'

export const DASHBOARD_CARDS_SETTINGS_KEY = 'dashboardCards'
export const MAX_DASHBOARD_CARDS = 60
export const MAX_CARD_GOAL = 1_000_000_000

/**
 * Who a card is built for. owner = health and leaks; office = today's problems (dispatcher); sales = my quotes and numbers;
 * crew = my day (a crew lead or a field tech: never money); billing = the books (money:record). A viewer sees the cards of
 * the audiences they hold, in the owner's order — the owner's list is ONE list for everyone.
 */
export type DashboardAudience = 'owner' | 'office' | 'sales' | 'crew' | 'billing'
export const AUDIENCE_LABELS: Record<DashboardAudience, string> = { owner: 'Owner', office: 'Office', sales: 'Sales', crew: 'Crew', billing: 'Billing' }
export type CardGroup = 'Classic' | 'Money' | 'Recurring' | 'Work' | 'Sales' | 'Leaderboards' | 'Projects' | 'Problems' | 'My day' | 'Billing' | 'Off-season'
export type CardDisplay = 'count' | 'money' | 'percent' | 'leaderboard' | 'list' | 'classic'
/** Groups that get a heading on the dashboard (the original lawn groups keep their layout). */
export const HEADED_GROUPS: readonly CardGroup[] = ['Projects', 'Problems', 'My day', 'Billing', 'Off-season']
/** A company with at most this many visits on the calendar in the next 14 days (and at least one plan) is off-season. */
export const OFF_SEASON_MAX_VISITS = 2

export const CLASSIC_SECTIONS = ['quick-stats', 'pay', 'my-goals', 'team-scoreboard', 'progress', 'account-overview'] as const
export type ClassicSection = (typeof CLASSIC_SECTIONS)[number]

export type LoaderName =
  | 'unpaidInvoices' | 'visits' | 'servicePlans' | 'timeWeek'
  // Role cards (lib/dashboard-role-loaders.ts): each reads an existing loader / ledger and adds no new money rule of its own.
  | 'revenuePerCrewHour' | 'contractedRecurring' | 'cancellations' | 'jobHours' | 'projects' | 'office' | 'sales' | 'crewDay' | 'billing' | 'renewals'

export type CardSource =
  | { kind: 'classic'; section: ClassicSection }
  | {
      kind: 'report'
      spec: ReportSpec
      /** What to read off the result: the grand total, or one value per group (leaderboards). */
      read: 'total' | 'groups'
      /**
       * Which dates the card covers. 'week' = this week, Sunday through Saturday in the company's own time zone, passed to the
       * runner as exact timestamps (lib/dashboard-cards-server.ts `dashboardWindow`); 'spec' = whatever `spec.date` says
       * (a rolling window, the same as the report). For 'week' the spec's own `date` is not read.
       */
      range: 'week' | 'spec'
    }
  | { kind: 'loader'; loader: LoaderName; measure: string }
  | { kind: 'none'; reason: string }

export type DashboardCard = {
  key: string
  label: string
  description: string
  group: CardGroup
  audience: readonly DashboardAudience[]
  /** 'financials' = reports:financials; 'books' = reports:financials OR money:record (the job's books: owed, paid); 'own' = the viewer's own deals. */
  money: 'financials' | 'books' | 'own' | null
  /** 'in' = a weekly-work card, hidden while the company is off-season; 'off' = shown only then. */
  season?: 'in' | 'off'
  /** The company feature switch this card needs on (lib/org-features.ts). */
  requires?: OrgFeature
  display: CardDisplay
  /** A number the owner can set a goal for (shown with the same progress bar as the classic "Progress vs goals"). */
  goal?: boolean
  source: CardSource
}

const base = (dataset: ReportSpec['dataset'], over: Partial<ReportSpec>): ReportSpec => ({
  dataset, mode: 'summary', groupBy: null, metric: { kind: 'count' }, date: { preset: '7d' }, filters: [], sortDesc: true, ...over,
})

const classic = (section: ClassicSection, label: string, description: string): DashboardCard => ({
  key: `classic-${section}`, label, description, group: 'Classic', audience: ['owner', 'sales', 'crew'], money: null, display: 'classic', source: { kind: 'classic', section },
})

type LoaderCard = Omit<DashboardCard, 'source'> & { loader: LoaderName; measure: string }
const L = ({ loader, measure, ...card }: LoaderCard): DashboardCard => ({ ...card, source: { kind: 'loader', loader, measure } })

export const DASHBOARD_CARDS: readonly DashboardCard[] = [
  // ── Classic field-sales sections: today's dashboard, unchanged ────────────────────────────────────────────────
  classic('quick-stats', 'Quick stats', 'Doors, contacts, inspections, sits, sales, close % and efficiency, plus attached sales.'),
  classic('pay', 'Estimated pay', 'Estimated pay this week, with My Comp Plan and the calculator.'),
  classic('my-goals', 'My goals', 'Your personal goals.'),
  classic('team-scoreboard', 'Team scoreboard', 'Setter and closer stats for the team.'),
  classic('progress', 'Progress vs goals', 'Doors, contacts, inspections and sales against the weekly goals in settings.'),
  classic('account-overview', 'Account overview', 'Leads, opportunities and projects.'),

  // ── OWNER · Money ────────────────────────────────────────────────────────────────────────────────────────────
  { key: 'billed-week', label: 'Billed this week', description: 'Job contracts and service invoices billed this week, sales tax included (the Revenue report).', group: 'Money', audience: ['owner'], money: 'financials', display: 'money', goal: true,
    source: { kind: 'report', read: 'total', range: 'week', spec: base('revenue', { metric: { kind: 'sum', column: 'billed' } }) } },
  // Collected and owed sit side by side: one card each (cash collected vs owed), the owed one also on the bookkeeper's dashboard.
  { key: 'collected-week', label: 'Collected this week', description: 'Payments received this week, refunds taken off (the Revenue report).', group: 'Money', audience: ['owner', 'billing'], money: 'books', display: 'money', goal: true,
    source: { kind: 'report', read: 'total', range: 'week', spec: base('revenue', { metric: { kind: 'sum', column: 'collected' } }) } },
  L({ key: 'unpaid-overdue', label: 'Unpaid and overdue', description: 'What customers still owe on sent invoices, and how many are past due (the list behind Today’s Unpaid invoices).', group: 'Money', audience: ['owner', 'billing'], money: 'books', display: 'money', loader: 'unpaidInvoices', measure: 'owed' }),
  L({ key: 'revenue-per-crew-hour', label: 'Revenue per person-hour', description: 'Visit prices ÷ clocked person-hours (two people for 3 hours = 6), this week. Only per-visit-priced visits with clocked time count; the card says how many.', group: 'Money', audience: ['owner'], money: 'financials', requires: 'timeTracking', display: 'money', loader: 'revenuePerCrewHour', measure: 'week' }),
  L({ key: 'change-orders-month', label: 'Change orders this month', description: 'Signed change orders this month and what they added (cancelled jobs left out).', group: 'Money', audience: ['owner'], money: 'financials', display: 'money', loader: 'projects', measure: 'changeOrders' }),

  // ── OWNER · Recurring ────────────────────────────────────────────────────────────────────────────────────────
  L({ key: 'active-plans', label: 'Active plans', description: 'Service plans running now (not paused or ended).', group: 'Recurring', audience: ['owner'], money: null, requires: 'servicePlans', display: 'count', loader: 'servicePlans', measure: 'active' }),
  L({ key: 'new-plans-month', label: 'New plans this month', description: 'Service plans sold since the 1st.', group: 'Recurring', audience: ['owner'], money: null, requires: 'servicePlans', display: 'count', goal: true, loader: 'servicePlans', measure: 'new-month' }),
  L({ key: 'cancellations-month', label: 'Cancellations this month', description: 'Plans staff ended and jobs cancelled since the 1st. Job reasons are shown; plans record no reason.', group: 'Recurring', audience: ['owner'], money: null, display: 'count', loader: 'cancellations', measure: 'month' }),
  L({ key: 'mrr', label: 'Contracted recurring revenue', description: 'What active plans bill over the next 12 months (per-visit, monthly and yearly prices), with the monthly average. Per-hour plans are not counted.', group: 'Recurring', audience: ['owner'], money: 'financials', requires: 'servicePlans', display: 'money', loader: 'contractedRecurring', measure: 'next12' }),
  { key: 'visit-hours-vs-plan', label: 'Visit hours vs plan', description: 'Clocked hours against the time a visit was planned to take.', group: 'Recurring', audience: ['owner'], money: null, requires: 'servicePlans', display: 'count',
    source: { kind: 'none', reason: 'Service-plan visits have no planned duration, so there is nothing to compare clocked hours against. Job hours vs estimate is on the Projects cards.' } },

  // ── OWNER · Projects (grading and other project work) ────────────────────────────────────────────────────────
  L({ key: 'projects-backlog', label: 'Backlog', description: 'Sold jobs not started yet (sold, materials, scheduled) and their value. Cancelled jobs left out.', group: 'Projects', audience: ['owner'], money: 'financials', display: 'money', loader: 'projects', measure: 'backlog' }),
  L({ key: 'projects-active', label: 'Jobs in progress', description: 'Jobs started and not finished.', group: 'Projects', audience: ['owner', 'office'], money: null, display: 'count', loader: 'projects', measure: 'active' }),
  L({ key: 'projects-cost-vs-estimate', label: 'Cost, hours and margin by job', description: 'Jobs in progress: budget vs actual cost (the cost ledger), estimated vs clocked hours, and margin.', group: 'Projects', audience: ['owner'], money: 'financials', requires: 'projectTools', display: 'leaderboard', loader: 'projects', measure: 'costVsEstimate' }),
  L({ key: 'job-hours', label: 'Job hours vs estimate', description: 'Clocked hours on jobs that have estimated hours, against the estimate.', group: 'Projects', audience: ['owner'], money: null, requires: 'timeTracking', display: 'count', loader: 'jobHours', measure: 'jobs' }),

  // ── Work (owner, office, crew) ───────────────────────────────────────────────────────────────────────────────
  L({ key: 'visits-done-week', label: 'Visits done', description: 'Visits finished this week, of the visits scheduled for the week.', group: 'Work', audience: ['owner', 'office', 'crew'], money: null, season: 'in', requires: 'servicePlans', display: 'count', goal: true, loader: 'visits', measure: 'done' }),
  L({ key: 'visits-skipped-week', label: 'Visits skipped', description: 'Visits skipped this week, with the most common reasons.', group: 'Work', audience: ['owner', 'office', 'crew'], money: null, season: 'in', requires: 'servicePlans', display: 'count', loader: 'visits', measure: 'skipped' }),
  L({ key: 'visits-moved-week', label: 'Rain-day moves', description: 'Visits sitting on a different day than planned this week (rain days and other moves).', group: 'Work', audience: ['owner', 'office', 'crew'], money: null, season: 'in', requires: 'servicePlans', display: 'count', loader: 'visits', measure: 'moved' }),

  // ── OFFICE · Today's problems ────────────────────────────────────────────────────────────────────────────────
  L({ key: 'office-crews-today', label: 'Crews today', description: 'Each crew’s visits left and done today, and visits still open from earlier days.', group: 'Problems', audience: ['office'], money: null, season: 'in', requires: 'servicePlans', display: 'leaderboard', loader: 'office', measure: 'crewsToday' }),
  L({ key: 'office-carried-over', label: 'Visits left from earlier days', description: 'Visits from the last 14 days nobody marked done or skipped.', group: 'Problems', audience: ['office'], money: null, season: 'in', requires: 'servicePlans', display: 'list', loader: 'office', measure: 'carriedOver' }),
  L({ key: 'office-skipped', label: 'Skipped visits to follow up', description: 'Visits skipped in the last 7 days, with the reason.', group: 'Problems', audience: ['office'], money: null, season: 'in', requires: 'servicePlans', display: 'list', loader: 'office', measure: 'skipped' }),
  L({ key: 'office-unassigned', label: 'Unassigned visits and jobs', description: 'Visits this week with no crew, and sold jobs with no install date.', group: 'Problems', audience: ['office'], money: null, display: 'list', loader: 'office', measure: 'unassigned' }),
  L({ key: 'office-callbacks', label: 'Waiting on a call back', description: 'Texts nobody has answered and new leads nobody has contacted.', group: 'Problems', audience: ['office'], money: null, display: 'list', loader: 'office', measure: 'callbacks' }),

  // ── SALES · My numbers ───────────────────────────────────────────────────────────────────────────────────────
  L({ key: 'my-quotes-out', label: 'Quotes waiting on a customer', description: 'Sent quotes still unsigned, oldest first, with the amount and how long they have waited. A salesperson sees their own.', group: 'Sales', audience: ['owner', 'sales'], money: 'own', display: 'list', loader: 'sales', measure: 'quotesOut' }),
  L({ key: 'my-followups', label: 'Follow-ups due today', description: 'Today’s appointments, appointments with no outcome logged, and leads you have not contacted.', group: 'Sales', audience: ['sales'], money: null, display: 'list', loader: 'sales', measure: 'followups' }),
  L({ key: 'won-vs-lost', label: 'Won vs lost', description: 'Deals opened in the last 30 days: how many were won, lost and are still open. A salesperson sees their own.', group: 'Sales', audience: ['owner', 'sales'], money: null, display: 'count', loader: 'sales', measure: 'wonLost' }),
  L({ key: 'my-sales-goal', label: 'My weekly sales goal', description: 'Quotes you won this week against the weekly sales goal set for you in Dashboard settings.', group: 'Sales', audience: ['sales'], money: null, display: 'count', loader: 'sales', measure: 'goal' }),
  L({ key: 'quotes-sent-week', label: 'Quotes sent', description: 'Quotes sent to customers this week (counted from the day each was sent).', group: 'Sales', audience: ['owner', 'sales'], money: null, display: 'count', loader: 'sales', measure: 'quotesSent' }),
  { key: 'quotes-won-week', label: 'Quotes won', description: 'Quotes approved and signed this week.', group: 'Sales', audience: ['owner', 'sales'], money: null, display: 'count', goal: true,
    source: { kind: 'report', read: 'total', range: 'week', spec: base('sales', { metric: { kind: 'count' } }) } },
  { key: 'win-rate', label: 'Win rate', description: 'Share of deals opened in the last 30 days that were sold (the Sold % report).', group: 'Sales', audience: ['owner', 'sales'], money: null, display: 'percent',
    source: { kind: 'report', read: 'total', range: 'spec', spec: base('opportunities', { metric: { kind: 'rate', column: 'is_sold' }, date: { preset: '30d' } }) } },
  { key: 'dollars-sold-week', label: 'Dollars sold', description: 'Signed sales this week. A salesperson sees their own.', group: 'Sales', audience: ['owner', 'sales'], money: 'own', display: 'money', goal: true,
    source: { kind: 'report', read: 'total', range: 'week', spec: base('sales', { metric: { kind: 'sum', column: 'amount' } }) } },

  // ── CREW · My day (no money, ever) ───────────────────────────────────────────────────────────────────────────
  L({ key: 'my-day', label: 'My day', description: 'Today’s stops in order: address, notes and gate codes, done or left.', group: 'My day', audience: ['crew'], money: null, requires: 'servicePlans', display: 'list', loader: 'crewDay', measure: 'stops' }),
  L({ key: 'my-visits-left', label: 'Stops left today', description: 'Stops still to do today, of the stops on your crew’s day.', group: 'My day', audience: ['crew'], money: null, requires: 'servicePlans', display: 'count', loader: 'crewDay', measure: 'left' }),
  L({ key: 'my-hours-today', label: 'Person-hours today', description: 'Paid person-hours (everyone’s paid day added up, breaks out) so far today — the same number the day clock shows. Visits have no planned time, so there is no budget to compare against.', group: 'My day', audience: ['crew'], money: null, requires: 'timeTracking', display: 'count', loader: 'crewDay', measure: 'hours' }),

  // ── BILLING · The books ──────────────────────────────────────────────────────────────────────────────────────
  L({ key: 'ar-aging', label: 'Unpaid by age', description: 'Sent invoices still owing, by how far past due they are.', group: 'Billing', audience: ['billing', 'owner'], money: 'books', display: 'leaderboard', loader: 'billing', measure: 'aging' }),
  L({ key: 'unbilled-visits', label: 'Done, not billed yet', description: 'Finished visits waiting on an invoice (the Ready to bill list), and their value.', group: 'Billing', audience: ['billing'], money: 'books', requires: 'servicePlans', display: 'money', loader: 'billing', measure: 'unbilled' }),
  L({ key: 'qb-problems', label: 'QuickBooks sync problems', description: 'Records the CRM could not send to QuickBooks without a person.', group: 'Billing', audience: ['billing', 'owner'], money: null, requires: 'quickbooks', display: 'list', loader: 'billing', measure: 'qb' }),

  // ── Off-season (owner, office): shown instead of the weekly work cards ───────────────────────────────────────
  L({ key: 'renewals-open', label: 'Plans to renew', description: 'Plans that ended or end within 60 days with no active plan at the same property.', group: 'Off-season', audience: ['owner', 'office'], money: null, season: 'off', requires: 'servicePlans', display: 'list', loader: 'renewals', measure: 'renewals' }),
  L({ key: 'next-season-plans', label: 'Next season sold', description: 'Active plans that have not started yet, and what they bill over their first 12 months.', group: 'Off-season', audience: ['owner', 'office'], money: null, season: 'off', requires: 'servicePlans', display: 'count', loader: 'renewals', measure: 'nextSeason' }),
  L({ key: 'offseason-unpaid', label: 'Unpaid balances', description: 'What customers still owe, shown while the weekly work is quiet.', group: 'Off-season', audience: ['owner', 'office'], money: 'books', season: 'off', display: 'money', loader: 'unpaidInvoices', measure: 'owed' }),

  // ── Leaderboards ─────────────────────────────────────────────────────────────────────────────────────────────
  { key: 'salespeople', label: 'Salespeople', description: 'Quotes won and dollars sold this week, per salesperson (one row per person, not per name). A salesperson sees their own row.', group: 'Leaderboards', audience: ['owner', 'sales'], money: 'own', display: 'leaderboard',
    source: { kind: 'report', read: 'groups', range: 'week', spec: base('sales', { groupBy: 'closer_user_id', metric: { kind: 'sum', column: 'amount' } }) } },
  L({ key: 'crews', label: 'Crews', description: 'Visits done, hours and skips this week, per crew. A crew lead sees their own crew. Never shows money.', group: 'Leaderboards', audience: ['owner', 'office', 'crew'], money: null, season: 'in', requires: 'servicePlans', display: 'leaderboard', loader: 'visits', measure: 'crews' }),
]

const BY_KEY = new Map(DASHBOARD_CARDS.map((c) => [c.key, c]))
export const dashboardCardByKey = (key: string): DashboardCard | undefined => BY_KEY.get(key)
export const DASHBOARD_CARD_KEYS: readonly string[] = DASHBOARD_CARDS.map((c) => c.key)
export const isClassicCard = (c: DashboardCard): boolean => c.source.kind === 'classic'
export const isDrawableCard = (c: DashboardCard): boolean => c.source.kind !== 'none'
export const CLASSIC_CARD_KEYS: readonly string[] = DASHBOARD_CARDS.filter(isClassicCard).map((c) => c.key)

/** The cards a company may put on its dashboard: its features on, a real source, and the classic family only for the classic dashboard. */
export function cardsOfferedTo(features: Pick<OrgFeatures, OrgFeature> | null | undefined, mode: 'classic' | 'cards'): DashboardCard[] {
  return DASHBOARD_CARDS.filter((c) => isDrawableCard(c) && (mode === 'classic') === isClassicCard(c) && (!c.requires || !features || features[c.requires] !== false))
}

export type SavedCard = { key: string; goal: number | null }
export type DashboardMode = 'classic' | 'cards'
export type ResolvedDashboard = { mode: DashboardMode; cards: SavedCard[]; custom: boolean }

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
const goalOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_CARD_GOAL ? v : null)

/** Pure, tolerant read of what was stored: unknown / undrawable / duplicate keys are dropped, never thrown on. */
export function readSavedCards(settings: unknown): SavedCard[] | null {
  const raw = asObject(asObject(settings)[DASHBOARD_CARDS_SETTINGS_KEY]).cards
  if (!Array.isArray(raw)) return null
  const seen = new Set<string>()
  const out: SavedCard[] = []
  for (const item of raw.slice(0, MAX_DASHBOARD_CARDS)) {
    const o = asObject(item)
    const card = typeof o.key === 'string' ? BY_KEY.get(o.key) : undefined
    if (!card || !isDrawableCard(card) || seen.has(card.key)) continue
    seen.add(card.key)
    out.push({ key: card.key, goal: card.goal ? goalOf(o.goal) : null })
  }
  return out.length ? out : null
}

/**
 * The dashboard a company has: its own saved list, else the profile's starting list (`profile.dashboard.cards`, null = classic).
 * A saved list is all classic cards (classic, sections on/off) or all new cards — never mixed (`readSavedCards` keeps the
 * kind of the FIRST card, so a hand-edited mixed list can't draw half of each).
 */
export function resolveDashboard(settings: unknown, profileCards: readonly string[] | null | undefined): ResolvedDashboard {
  const saved = readSavedCards(settings)
  if (saved) {
    const firstClassic = isClassicCard(BY_KEY.get(saved[0].key)!)
    const same = saved.filter((c) => isClassicCard(BY_KEY.get(c.key)!) === firstClassic)
    return { mode: firstClassic ? 'classic' : 'cards', cards: same, custom: true }
  }
  if (!profileCards) return { mode: 'classic', cards: CLASSIC_CARD_KEYS.map((key) => ({ key, goal: null })), custom: false }
  const keys = profileCards.filter((k) => { const c = BY_KEY.get(k); return !!c && isDrawableCard(c) })
  return { mode: 'cards', cards: keys.map((key) => ({ key, goal: null })), custom: false }
}

/** What the owner's editor may send. Server-side validation (the route and the writer both use it). */
export function parseCardsInput(input: unknown, features: Pick<OrgFeatures, OrgFeature> | null | undefined): { ok: true; cards: SavedCard[] } | { ok: false; error: string } {
  const raw = asObject(input).cards
  if (!Array.isArray(raw)) return { ok: false, error: 'Send the list of cards' }
  if (raw.length === 0) return { ok: false, error: 'Keep at least one card' }
  if (raw.length > MAX_DASHBOARD_CARDS) return { ok: false, error: `At most ${MAX_DASHBOARD_CARDS} cards` }
  const seen = new Set<string>()
  const cards: SavedCard[] = []
  for (const item of raw) {
    const o = asObject(item)
    const key = typeof o.key === 'string' ? o.key : ''
    const card = BY_KEY.get(key)
    if (!card) return { ok: false, error: `Unknown card: ${key.slice(0, 40) || '(blank)'}` }
    if (!isDrawableCard(card)) return { ok: false, error: `${card.label} has no data source yet` }
    if (card.requires && features && features[card.requires] === false) return { ok: false, error: `${card.label} needs a feature your company has turned off` }
    if (seen.has(key)) return { ok: false, error: `${card.label} is listed twice` }
    seen.add(key)
    let goal: number | null = null
    if (o.goal !== undefined && o.goal !== null && o.goal !== '') {
      if (!card.goal) return { ok: false, error: `${card.label} has no goal` }
      goal = goalOf(o.goal)
      if (goal === null) return { ok: false, error: `${card.label}: the goal must be a number above 0` }
    }
    cards.push({ key, goal })
  }
  const classicCount = cards.filter((c) => isClassicCard(BY_KEY.get(c.key)!)).length
  if (classicCount !== 0 && classicCount !== cards.length) return { ok: false, error: 'Classic sections and cards cannot be mixed on one dashboard' }
  return { ok: true, cards }
}

export type DashboardViewer = {
  audiences: ReadonlySet<DashboardAudience>
  financials: boolean
  /** money:record (the job's books). Not company financials: profit, cost and pay stay behind `financials`. */
  books?: boolean
  /** The company's weekly work is quiet (lib/dashboard-cards-server.ts `detectOffSeason`). */
  offSeason?: boolean
}

/**
 * The cards this viewer may see, in the owner's order: features on, drawable, audience, money, season. Pure.
 * An owner sees the owner cards (health and leaks), not every role's cards; somebody holding reports:financials sees the
 * 'financials' and 'books' money cards whatever their audience (a 'books' card is also open to money:record in the billing audience).
 */
export function cardsForViewer(list: readonly SavedCard[], viewer: DashboardViewer, features: Pick<OrgFeatures, OrgFeature> | null | undefined): Array<{ card: DashboardCard; goal: number | null }> {
  const out: Array<{ card: DashboardCard; goal: number | null }> = []
  for (const s of list) {
    const card = BY_KEY.get(s.key)
    if (!card || !isDrawableCard(card)) continue
    if (card.requires && features && features[card.requires] === false) continue
    if (card.money === 'financials' && !viewer.financials) continue
    if (card.money === 'books' && !viewer.financials && !viewer.books) continue
    // Off-season is the owner's and the office's view of the company; a crew or salesperson's own-day cards never swap.
    const offSeason = viewer.offSeason === true && (viewer.audiences.has('owner') || viewer.audiences.has('office'))
    if (card.season === 'in' && offSeason) continue
    if (card.season === 'off' && !offSeason) continue
    const inAudience = card.audience.some((a) => viewer.audiences.has(a)) || ((card.money === 'financials' || card.money === 'books') && viewer.financials)
    if (!inAudience) continue
    out.push({ card, goal: card.goal ? s.goal : null })
  }
  return out
}

/* ------------------------------------------------------------------------ *
 * What the page hands the client (serialisable).
 * ------------------------------------------------------------------------ */

export type TileData = {
  kind: 'tile'
  key: string
  label: string
  display: Exclude<CardDisplay, 'leaderboard' | 'list' | 'classic'>
  /** null = could not be loaded (shown as a dash, never a false 0). */
  value: number | null
  /** A second line, e.g. "of 30 scheduled" or the top skip reasons. */
  sub?: string
  /** Why there is no number (nothing to measure yet), said in words. Different from a failed read: that is a dash and nothing else. */
  unavailable?: string
  goal: number | null
  group?: CardGroup
}
export type LeaderboardData = {
  kind: 'leaderboard'
  key: string
  label: string
  columns: Array<{ key: string; label: string; format: 'count' | 'money' | 'hours' | 'percent' }>
  rows: Array<{ id: string; name: string; values: Array<number | null> }>
  empty: string
  failed: boolean
  group?: CardGroup
}
export type ListRow = {
  id: string
  title: string
  detail: string
  /** A link to where the work is done (never to a customer's money for a viewer who can't see it). */
  href?: string
  tone?: 'warn'
  /** My day: this stop is finished or skipped. */
  done?: boolean
  /** My day: the stop's work-order id, for the clock-in button (only on stops still open). */
  clockStopId?: string
}
/** A short list: today's problems, my day, quotes waiting. `count` is the true total (the rows are capped). */
export type ListData = {
  kind: 'list'
  key: string
  label: string
  count: number
  sub?: string
  rows: ListRow[]
  empty: string
  failed: boolean
  /** My day with the company's time clock on: the day clock card (components/time/DayClockCard.tsx) sits above the stops. */
  clock?: boolean
  group?: CardGroup
}
export type CardData = TileData | LeaderboardData | ListData

export function formatCardValue(display: TileData['display'], value: number | null): string {
  if (value === null) return '—'
  if (display === 'money') return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  if (display === 'percent') return `${Math.round(value)}%`
  return value.toLocaleString('en-US')
}

/**
 * A company with nothing to show yet: every number is a real 0 (or "nothing to measure"), every list and table is empty, nothing
 * failed to load. The dashboard then says what to do next instead of drawing rows of zeros. Pure.
 */
export function dashboardIsEmpty(cards: readonly CardData[]): boolean {
  if (cards.length === 0) return false
  return cards.every((c) => {
    if (c.kind === 'tile') return !c.unavailable ? c.value === 0 : c.value === null
    if (c.kind === 'leaderboard') return !c.failed && c.rows.length === 0
    return !c.failed && c.count === 0 && c.rows.length === 0
  })
}

/**
 * The company's own word for a job ("Project" for a builder) in what the cards say. Pure; a company whose word is "Job" gets the
 * cards back unchanged. Only the whole words job / jobs (any case) in the card's own words are replaced — never in rows, which carry customer and staff text.
 */
export function applyDashboardWords(cards: CardData[], terms: { job: string; jobs: string }): CardData[] {
  if (terms.job === 'Job' && terms.jobs === 'Jobs') return cards
  const say = (v: string): string => v.replace(/\b(jobs?)\b/gi, (m) => {
    const plural = m.toLowerCase() === 'jobs'
    const word = plural ? terms.jobs : terms.job
    return m[0] === m[0].toUpperCase() ? word : word.toLowerCase()
  })
  const opt = (v: string | undefined) => (v === undefined ? v : say(v))
  return cards.map((c): CardData => {
    if (c.kind === 'tile') return { ...c, label: say(c.label), ...(c.sub !== undefined ? { sub: say(c.sub) } : {}), ...(c.unavailable !== undefined ? { unavailable: say(c.unavailable) } : {}) }
    if (c.kind === 'leaderboard') return { ...c, label: say(c.label), empty: say(c.empty), columns: c.columns.map((x) => ({ ...x, label: say(x.label) })) }
    return { ...c, label: say(c.label), empty: say(c.empty), sub: opt(c.sub) }
  })
}
