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
export const MAX_DASHBOARD_CARDS = 30
export const MAX_CARD_GOAL = 1_000_000_000

export type DashboardAudience = 'owner' | 'sales' | 'crew'
export type CardGroup = 'Classic' | 'Money' | 'Recurring' | 'Work' | 'Sales' | 'Leaderboards'
export type CardDisplay = 'count' | 'money' | 'percent' | 'leaderboard' | 'classic'

export const CLASSIC_SECTIONS = ['quick-stats', 'pay', 'my-goals', 'team-scoreboard', 'progress', 'account-overview'] as const
export type ClassicSection = (typeof CLASSIC_SECTIONS)[number]

export type LoaderName = 'unpaidInvoices' | 'visits' | 'servicePlans' | 'timeWeek'

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
  money: 'financials' | 'own' | null
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

export const DASHBOARD_CARDS: readonly DashboardCard[] = [
  // ── Classic field-sales sections: today's dashboard, unchanged ────────────────────────────────────────────────
  classic('quick-stats', 'Quick stats', 'Doors, contacts, inspections, sits, sales, close % and efficiency, plus attached sales.'),
  classic('pay', 'Estimated pay', 'Estimated pay this week, with My Comp Plan and the calculator.'),
  classic('my-goals', 'My goals', 'Your personal goals.'),
  classic('team-scoreboard', 'Team scoreboard', 'Setter and closer stats for the team.'),
  classic('progress', 'Progress vs goals', 'Doors, contacts, inspections and sales against the weekly goals in settings.'),
  classic('account-overview', 'Account overview', 'Leads, opportunities and projects.'),

  // ── Money ────────────────────────────────────────────────────────────────────────────────────────────────────
  { key: 'billed-week', label: 'Billed this week', description: 'Job contracts and service invoices billed this week, sales tax included (the Revenue report).', group: 'Money', audience: ['owner'], money: 'financials', display: 'money', goal: true,
    source: { kind: 'report', read: 'total', range: 'week', spec: base('revenue', { metric: { kind: 'sum', column: 'billed' } }) } },
  { key: 'collected-week', label: 'Collected this week', description: 'Payments received this week, refunds taken off (the Revenue report).', group: 'Money', audience: ['owner'], money: 'financials', display: 'money', goal: true,
    source: { kind: 'report', read: 'total', range: 'week', spec: base('revenue', { metric: { kind: 'sum', column: 'collected' } }) } },
  { key: 'unpaid-overdue', label: 'Unpaid and overdue', description: 'What customers still owe on sent invoices, and how many are past due (the list behind Today’s Unpaid invoices).', group: 'Money', audience: ['owner'], money: 'financials', display: 'money',
    source: { kind: 'loader', loader: 'unpaidInvoices', measure: 'owed' } },
  { key: 'revenue-per-crew-hour', label: 'Revenue per crew hour', description: 'What a crew hour brings in.', group: 'Money', audience: ['owner'], money: 'financials', requires: 'timeTracking', display: 'money',
    source: { kind: 'none', reason: 'No report or loader joins revenue to crew hours; computing it here would be new money math.' } },

  // ── Recurring ────────────────────────────────────────────────────────────────────────────────────────────────
  { key: 'active-plans', label: 'Active plans', description: 'Service plans running now (not paused or ended).', group: 'Recurring', audience: ['owner'], money: null, requires: 'servicePlans', display: 'count',
    source: { kind: 'loader', loader: 'servicePlans', measure: 'active' } },
  { key: 'new-plans-month', label: 'New plans this month', description: 'Service plans sold since the 1st.', group: 'Recurring', audience: ['owner'], money: null, requires: 'servicePlans', display: 'count', goal: true,
    source: { kind: 'loader', loader: 'servicePlans', measure: 'new-month' } },
  { key: 'cancellations-month', label: 'Cancellations this month', description: 'Plans a customer cancelled since the 1st.', group: 'Recurring', audience: ['owner'], money: null, requires: 'servicePlans', display: 'count',
    source: { kind: 'none', reason: 'A plan "ended" status does not say whether the customer cancelled or the season ended (auto-ended plans look the same); no cancellation reason is recorded.' } },
  { key: 'mrr', label: 'Monthly recurring revenue', description: 'Plan prices as a monthly amount.', group: 'Recurring', audience: ['owner'], money: 'financials', requires: 'servicePlans', display: 'money',
    source: { kind: 'none', reason: 'Turning per-visit, per-month and per-year plan prices into one monthly number is new money math; no report or loader does it.' } },

  // ── Work ─────────────────────────────────────────────────────────────────────────────────────────────────────
  { key: 'visits-done-week', label: 'Visits done', description: 'Visits finished this week, of the visits scheduled for the week.', group: 'Work', audience: ['owner', 'crew'], money: null, requires: 'servicePlans', display: 'count', goal: true,
    source: { kind: 'loader', loader: 'visits', measure: 'done' } },
  { key: 'visits-skipped-week', label: 'Visits skipped', description: 'Visits skipped this week, with the most common reasons.', group: 'Work', audience: ['owner', 'crew'], money: null, requires: 'servicePlans', display: 'count',
    source: { kind: 'loader', loader: 'visits', measure: 'skipped' } },
  { key: 'visits-moved-week', label: 'Rain-day moves', description: 'Visits sitting on a different day than planned this week (rain days and other moves).', group: 'Work', audience: ['owner', 'crew'], money: null, requires: 'servicePlans', display: 'count',
    source: { kind: 'loader', loader: 'visits', measure: 'moved' } },

  // ── Sales ────────────────────────────────────────────────────────────────────────────────────────────────────
  { key: 'quotes-sent-week', label: 'Quotes sent', description: 'Quotes sent to customers this week.', group: 'Sales', audience: ['owner', 'sales'], money: null, display: 'count',
    source: { kind: 'none', reason: 'No report dataset holds quotes by the day they were sent (the proposals table has no rpt_ view; Today only lists quotes still waiting).' } },
  { key: 'quotes-won-week', label: 'Quotes won', description: 'Quotes approved and signed this week.', group: 'Sales', audience: ['owner', 'sales'], money: null, display: 'count', goal: true,
    source: { kind: 'report', read: 'total', range: 'week', spec: base('sales', { metric: { kind: 'count' } }) } },
  { key: 'win-rate', label: 'Win rate', description: 'Share of deals opened in the last 30 days that were sold (the Sold % report).', group: 'Sales', audience: ['owner', 'sales'], money: null, display: 'percent',
    source: { kind: 'report', read: 'total', range: 'spec', spec: base('opportunities', { metric: { kind: 'rate', column: 'is_sold' }, date: { preset: '30d' } }) } },
  { key: 'dollars-sold-week', label: 'Dollars sold', description: 'Signed sales this week. A salesperson sees their own.', group: 'Sales', audience: ['owner', 'sales'], money: 'own', display: 'money', goal: true,
    source: { kind: 'report', read: 'total', range: 'week', spec: base('sales', { metric: { kind: 'sum', column: 'amount' } }) } },

  // ── Leaderboards ─────────────────────────────────────────────────────────────────────────────────────────────
  { key: 'salespeople', label: 'Salespeople', description: 'Quotes won and dollars sold this week, per salesperson (one row per person, not per name). A salesperson sees their own row.', group: 'Leaderboards', audience: ['owner', 'sales'], money: 'own', display: 'leaderboard',
    source: { kind: 'report', read: 'groups', range: 'week', spec: base('sales', { groupBy: 'closer_user_id', metric: { kind: 'sum', column: 'amount' } }) } },
  { key: 'crews', label: 'Crews', description: 'Visits done, hours and skips this week, per crew. A crew lead sees their own crew. Never shows money.', group: 'Leaderboards', audience: ['owner', 'crew'], money: null, requires: 'servicePlans', display: 'leaderboard',
    source: { kind: 'loader', loader: 'visits', measure: 'crews' } },
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
}

/** The cards this viewer may see, in the owner's order: features on, drawable, audience, money. Pure. */
export function cardsForViewer(list: readonly SavedCard[], viewer: DashboardViewer, features: Pick<OrgFeatures, OrgFeature> | null | undefined): Array<{ card: DashboardCard; goal: number | null }> {
  const out: Array<{ card: DashboardCard; goal: number | null }> = []
  for (const s of list) {
    const card = BY_KEY.get(s.key)
    if (!card || !isDrawableCard(card)) continue
    if (card.requires && features && features[card.requires] === false) continue
    if (card.money === 'financials' && !viewer.financials) continue
    const inAudience = viewer.audiences.has('owner') || card.audience.some((a) => viewer.audiences.has(a)) || (card.money === 'financials' && viewer.financials)
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
  display: Exclude<CardDisplay, 'leaderboard' | 'classic'>
  /** null = could not be loaded (shown as a dash, never a false 0). */
  value: number | null
  /** A second line, e.g. "of 30 scheduled" or the top skip reasons. */
  sub?: string
  goal: number | null
}
export type LeaderboardData = {
  kind: 'leaderboard'
  key: string
  label: string
  columns: Array<{ key: string; label: string; format: 'count' | 'money' | 'hours' }>
  rows: Array<{ id: string; name: string; values: Array<number | null> }>
  empty: string
  failed: boolean
}
export type CardData = TileData | LeaderboardData

export function formatCardValue(display: TileData['display'], value: number | null): string {
  if (value === null) return '—'
  if (display === 'money') return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  if (display === 'percent') return `${Math.round(value)}%`
  return value.toLocaleString('en-US')
}
