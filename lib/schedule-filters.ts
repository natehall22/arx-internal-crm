/**
 * The ONE filter rule for every schedule screen (pure, client-safe): the Board, the Visits board and the All work calendar
 * all narrow their rows with `filterWork`, and the shared bar (components/schedule/ScheduleFilterBar.tsx) edits a
 * `ScheduleFilters`. The work-orders list (a DataTable) uses the same option builder with its own TableFilter dropdowns.
 *
 * Saved views and "my last filter" ride on the existing `table_views` store (/api/table-views): a filter state is flattened to
 * `{ search, filters: Record<string,string> }` (lists are comma-joined) by `filtersToViewState` / `viewStateToFilters`.
 */

export type WorkType = 'visit' | 'job' | 'appointment'

/** What a schedule row exposes to the filters. Missing = null (a row with no value never matches a chosen value). */
export type WorkFilterable = {
  trade: string | null
  type?: WorkType | null
  crewId: string | null
  techId: string | null
  customerId: string | null
  customerName: string | null
  community?: string | null
  /** Everything searchable on the row (number, customer, address, crew, tech…), any case. */
  text: string
}

export type ScheduleFilters = {
  q: string
  /** Trade slugs (multi-select; empty = all). */
  trades: string[]
  /** Work types (multi-select; empty = all). */
  types: WorkType[]
  /** A crew (sub) id; several ids comma-joined ("my crews"). '' = all. */
  crew: string
  tech: string
  customer: string
  development: string
}

export const EMPTY_FILTERS: ScheduleFilters = { q: '', trades: [], types: [], crew: '', tech: '', customer: '', development: '' }

export function isFiltering(f: ScheduleFilters): boolean {
  return !!(f.q.trim() || f.trades.length || f.types.length || f.crew || f.tech || f.customer || f.development)
}

const ids = (v: string): string[] => v.split(',').filter(Boolean)

export function filterWork<T extends WorkFilterable>(rows: readonly T[], f: ScheduleFilters): T[] {
  if (!isFiltering(f)) return [...rows]
  const q = f.q.trim().toLowerCase()
  const crews = ids(f.crew)
  return rows.filter(
    (r) =>
      (!q || r.text.toLowerCase().includes(q)) &&
      (f.trades.length === 0 || (!!r.trade && f.trades.includes(r.trade))) &&
      (f.types.length === 0 || (!!r.type && f.types.includes(r.type))) &&
      (crews.length === 0 || (!!r.crewId && crews.includes(r.crewId))) &&
      (!f.tech || r.techId === f.tech) &&
      (!f.customer || r.customerId === f.customer || (!r.customerId && !!r.customerName && r.customerName === f.customer)) &&
      (!f.development || r.community === f.development)
  )
}

export type FilterOption = { value: string; label: string }

const byLabel = (a: FilterOption, b: FilterOption) => a.label.localeCompare(b.label)

/** Dropdown options from the rows on screen (names come from the rows, so nothing is looked up twice). */
export function filterOptions(
  rows: ReadonlyArray<WorkFilterable & { crewName?: string | null; techName?: string | null }>
): { crews: FilterOption[]; techs: FilterOption[]; customers: FilterOption[]; developments: FilterOption[] } {
  const crews = new Map<string, string>()
  const techs = new Map<string, string>()
  const customers = new Map<string, string>()
  const developments = new Set<string>()
  for (const r of rows) {
    if (r.crewId) crews.set(r.crewId, r.crewName || 'Crew')
    if (r.techId) techs.set(r.techId, r.techName || 'Staff')
    if (r.customerName) customers.set(r.customerId ?? r.customerName, r.customerName)
    if (r.community) developments.add(r.community)
  }
  const list = (m: Map<string, string>) => Array.from(m, ([value, label]) => ({ value, label })).sort(byLabel)
  return {
    crews: list(crews),
    techs: list(techs),
    customers: list(customers),
    developments: Array.from(developments, (value) => ({ value, label: value })).sort(byLabel),
  }
}

/** Trade colors: one stable color per trade, by the company's trade order (so a trade keeps its color on every screen). */
const TRADE_COLORS = ['#1d6fa5', '#2f855a', '#b7791f', '#9b2c6f', '#c05621', '#5a4fcf', '#0f766e', '#a61e4d'] as const
export const NO_TRADE_COLOR = '#57574f'

export function tradeColor(slug: string | null | undefined, trades: ReadonlyArray<{ slug: string }>): string {
  if (!slug) return NO_TRADE_COLOR
  const i = trades.findIndex((t) => t.slug === slug)
  return i < 0 ? NO_TRADE_COLOR : TRADE_COLORS[i % TRADE_COLORS.length]
}

// --- saved views / remembered filter (table_views) ----------------------------------------------------------------------

export type FilterViewState = { sorting: never[]; search: string; filters: Record<string, string> }

export function filtersToViewState(f: ScheduleFilters): FilterViewState {
  const filters: Record<string, string> = {}
  if (f.trades.length) filters.trades = f.trades.join(',')
  if (f.types.length) filters.types = f.types.join(',')
  if (f.crew) filters.crew = f.crew
  if (f.tech) filters.tech = f.tech
  if (f.customer) filters.customer = f.customer
  if (f.development) filters.development = f.development
  return { sorting: [], search: f.q, filters }
}

const TYPES: readonly WorkType[] = ['visit', 'job', 'appointment']

export function viewStateToFilters(s: { search?: string; filters?: Record<string, string> } | null | undefined): ScheduleFilters {
  const f = s?.filters ?? {}
  return {
    q: s?.search ?? '',
    trades: ids(f.trades ?? ''),
    types: ids(f.types ?? '').filter((t): t is WorkType => (TYPES as readonly string[]).includes(t)),
    crew: f.crew ?? '',
    tech: f.tech ?? '',
    customer: f.customer ?? '',
    development: f.development ?? '',
  }
}

/** The remembered "my last filter" is a hidden saved view with this name (never listed with the named ones). */
export const LAST_FILTER_VIEW = '__last'
