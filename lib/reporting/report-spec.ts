import { DATASETS, DATASET_KEYS, columnOf, type DatasetKey } from '@/lib/reporting/catalog'

export type DatePreset = '7d' | '30d' | '90d' | 'ytd' | 'all' | 'custom'
export type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lte' | 'contains' | 'is_true' | 'is_false'

export type ReportFilter = { column: string; op: FilterOp; value?: string | number | null }

export type ReportMetric =
  | { kind: 'count' }
  | { kind: 'sum' | 'avg'; column: string }
  /** share of rows where `column` (a yes/no column) is true — e.g. sold %, sit % */
  | { kind: 'rate'; column: string }

export type ReportSpec = {
  dataset: DatasetKey
  mode: 'summary' | 'rows'
  /** Column key, or '@month' / '@week' to group the dataset's date column. */
  groupBy?: string | null
  metric: ReportMetric
  date: { preset: DatePreset; start?: string | null; end?: string | null }
  filters: ReportFilter[]
  sortDesc?: boolean
  /** Rows mode: column to sort by. */
  sortBy?: string | null
  limit?: number
}

export const MAX_ROWS_SCANNED = 50000
export const MAX_ROWS_RETURNED = 2000

const OPS: FilterOp[] = ['eq', 'neq', 'gt', 'gte', 'lte', 'contains', 'is_true', 'is_false']

/** Normalises untrusted JSON into a ReportSpec, or returns why not. Column names are checked against the catalog. */
export function parseSpec(input: unknown): { ok: true; spec: ReportSpec } | { ok: false; error: string } {
  const b = (input ?? {}) as Record<string, any>
  if (!DATASET_KEYS.includes(b.dataset)) return { ok: false, error: 'Unknown dataset' }
  const ds = DATASETS[b.dataset as DatasetKey]
  const mode = b.mode === 'rows' ? 'rows' : 'summary'

  const groupBy = typeof b.groupBy === 'string' && b.groupBy ? b.groupBy : null
  if (groupBy && groupBy !== '@month' && groupBy !== '@week' && !columnOf(ds, groupBy)) return { ok: false, error: 'Unknown group-by column' }

  const m = b.metric ?? { kind: 'count' }
  let metric: ReportMetric
  if (m.kind === 'sum' || m.kind === 'avg') {
    const col = columnOf(ds, String(m.column))
    if (!col || (col.type !== 'money' && col.type !== 'number')) return { ok: false, error: 'That column cannot be added up' }
    metric = { kind: m.kind, column: col.key }
  } else if (m.kind === 'rate') {
    const col = columnOf(ds, String(m.column))
    if (!col || col.type !== 'bool') return { ok: false, error: 'A rate needs a yes/no column' }
    metric = { kind: 'rate', column: col.key }
  } else metric = { kind: 'count' }

  const filters: ReportFilter[] = []
  for (const f of Array.isArray(b.filters) ? b.filters.slice(0, 12) : []) {
    const col = columnOf(ds, String(f?.column))
    if (!col || !OPS.includes(f?.op)) return { ok: false, error: 'Bad filter' }
    // Keep Postgres from ever seeing a cast it cannot do: ops must fit the column's type.
    const numeric = col.type === 'money' || col.type === 'number'
    const ok =
      f.op === 'contains' ? col.type === 'text'
      : f.op === 'is_true' || f.op === 'is_false' ? col.type === 'bool'
      : f.op === 'gt' || f.op === 'gte' || f.op === 'lte' ? numeric || col.type === 'date'
      : true
    if (!ok) return { ok: false, error: `That filter does not work on ${col.label}` }
    if (numeric && ['eq', 'neq', 'gt', 'gte', 'lte'].includes(f.op) && !Number.isFinite(Number(f.value))) return { ok: false, error: `${col.label} needs a number` }
    filters.push({ column: col.key, op: f.op, value: typeof f.value === 'number' ? f.value : f.value == null ? null : String(f.value).slice(0, 200) })
  }

  const presets: DatePreset[] = ['7d', '30d', '90d', 'ytd', 'all', 'custom']
  const preset: DatePreset = presets.includes(b.date?.preset) ? b.date.preset : '30d'
  const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)

  const limit = Math.min(Math.max(Number(b.limit) || MAX_ROWS_RETURNED, 1), MAX_ROWS_RETURNED)
  return {
    ok: true,
    spec: {
      dataset: b.dataset, mode, groupBy, metric, filters,
      date: { preset, start: iso(b.date?.start), end: iso(b.date?.end) },
      sortDesc: b.sortDesc !== false,
      sortBy: typeof b.sortBy === 'string' && columnOf(ds, b.sortBy) ? b.sortBy : null,
      limit,
    },
  }
}

export function dateBounds(date: ReportSpec['date'], now = new Date()): { start: string | null; end: string | null } {
  const day = (n: number) => new Date(now.getTime() - n * 86400000).toISOString()
  switch (date.preset) {
    case '7d': return { start: day(7), end: null }
    case '30d': return { start: day(30), end: null }
    case '90d': return { start: day(90), end: null }
    case 'ytd': return { start: new Date(now.getFullYear(), 0, 1).toISOString(), end: null }
    case 'custom': return { start: date.start ? `${date.start}T00:00:00.000Z` : null, end: date.end ? `${date.end}T23:59:59.999Z` : null }
    default: return { start: null, end: null }
  }
}
