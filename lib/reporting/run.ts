/**
 * The ONE report runner. Every screen, export and scheduled email goes through runReport():
 *   - always filters org_id (views are read with the service client, so this is the org fence)
 *   - always applies the viewer's scope (own / team / region / all) on the dataset's owner column
 *   - hides financial data (money columns, cost, margin, pay) from everyone without reports:financials — in rows, filters,
 *     grouping, sorting and exports
 * Metrics themselves are defined once in the SQL views; this file only filters, groups and totals.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { canExportReportsFromPermissionNames, getReportScopeFromPermissionNames } from '@/lib/permissions'
import { DATASETS, columnOf, type Dataset, type DatasetColumn } from '@/lib/reporting/catalog'
import { MAX_ROWS_RETURNED, MAX_ROWS_SCANNED, dateBounds, type ReportSpec } from '@/lib/reporting/report-spec'
import { hasFinancials } from '@/lib/financials-access'

export type ReportContext = {
  orgId: string
  userId: string
  scope: 'own' | 'team' | 'region' | 'all'
  finance: boolean
  canExport: boolean
  /** Users whose rows this viewer may see; null = everyone (scope 'all'). */
  scopedUserIds: string[] | null
}

type Viewer = { id: string; org_id: string; role: string; custom_role_id?: string | null; team_id?: string | null; region_id?: string | null }

export async function buildReportContext(admin: SupabaseClient, profile: Viewer): Promise<ReportContext> {
  const perms = await resolveEffectivePermissionNames(admin, profile.id, profile)
  const scope = getReportScopeFromPermissionNames(perms)
  let scopedUserIds: string[] | null = null
  if (scope === 'own') scopedUserIds = [profile.id]
  else if (scope === 'team') {
    const { data } = profile.team_id
      ? await admin.from('users').select('id').eq('org_id', profile.org_id).eq('team_id', profile.team_id)
      : { data: [{ id: profile.id }] }
    scopedUserIds = (data ?? []).map((u: { id: string }) => u.id)
  } else if (scope === 'region') {
    if (profile.region_id) {
      const { data: teams } = await admin.from('teams').select('id').eq('org_id', profile.org_id).eq('region_id', profile.region_id)
      const teamIds = (teams ?? []).map((t: { id: string }) => t.id)
      const { data: users } = teamIds.length
        ? await admin.from('users').select('id').eq('org_id', profile.org_id).in('team_id', teamIds)
        : { data: [] as { id: string }[] }
      scopedUserIds = (users ?? []).map((u) => u.id)
    } else scopedUserIds = [profile.id]
  }
  if (scopedUserIds && !scopedUserIds.includes(profile.id)) scopedUserIds.push(profile.id)
  return {
    orgId: profile.org_id,
    userId: profile.id,
    scope,
    finance: hasFinancials(perms),
    canExport: canExportReportsFromPermissionNames(perms),
    scopedUserIds,
  }
}

export type ResultColumn = { key: string; label: string; type: DatasetColumn['type'] }
export type ReportResult = {
  columns: ResultColumn[]
  rows: Record<string, string | number | boolean | null>[]
  /** Summary mode: rows aggregated into groups. Rows mode: rows matched. */
  matched: number
  scanned: number
  truncated: boolean
  summary: { label: string; value: number } | null
}

export class ReportAccessError extends Error {
  constructor(message: string, public status = 403) {
    super(message)
  }
}

export function checkAccess(ctx: ReportContext, ds: Dataset, spec: ReportSpec): void {
  if (ds.financeOnly && !ctx.finance) throw new ReportAccessError('That report is for owners and finance only.')
  if (!ds.ownerColumn && ctx.scope !== 'all' && !ctx.finance) throw new ReportAccessError('That report covers the whole company, which your role cannot see.')
  const used = [
    spec.groupBy && !spec.groupBy.startsWith('@') ? spec.groupBy : null,
    'column' in spec.metric ? spec.metric.column : null,
    spec.sortBy ?? null,
    ...spec.filters.map((f) => f.column),
  ].filter(Boolean) as string[]
  if (!ctx.finance && used.some((k) => columnOf(ds, k)?.sensitive)) {
    throw new ReportAccessError('That report uses cost, margin or pay figures, which your role cannot see.')
  }
}

/** Columns the viewer may see in row listings. */
export function visibleColumns(ctx: ReportContext, ds: Dataset): DatasetColumn[] {
  return ds.columns.filter((c) => ctx.finance || !c.sensitive)
}

function startOfWeek(iso: string): string {
  const d = new Date(iso)
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day)
  return d.toISOString().slice(0, 10)
}

function groupKey(row: Record<string, unknown>, ds: Dataset, groupBy: string | null | undefined): string {
  if (!groupBy) return 'Total'
  if (groupBy === '@month' || groupBy === '@week') {
    const v = row[ds.dateColumn]
    if (!v) return 'No date'
    return groupBy === '@month' ? String(v).slice(0, 7) : startOfWeek(String(v))
  }
  const v = row[groupBy]
  if (v === null || v === undefined || v === '') return '(none)'
  return typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)
}

export async function runReport(admin: SupabaseClient, ctx: ReportContext, spec: ReportSpec): Promise<ReportResult> {
  const ds = DATASETS[spec.dataset]
  checkAccess(ctx, ds, spec)

  const wanted = new Set<string>([ds.idColumn, ds.dateColumn])
  if (ds.ownerColumn) wanted.add(ds.ownerColumn)
  if (spec.groupBy && !spec.groupBy.startsWith('@')) wanted.add(spec.groupBy)
  if ('column' in spec.metric) wanted.add(spec.metric.column)
  for (const f of spec.filters) wanted.add(f.column)
  if (spec.mode === 'rows') for (const c of visibleColumns(ctx, ds)) wanted.add(c.key)
  if (spec.sortBy) wanted.add(spec.sortBy)
  const select = Array.from(wanted).join(',')

  const { start, end } = dateBounds(spec.date)
  const all: Record<string, unknown>[] = []
  let truncated = false
  const PAGE = 1000
  for (let from = 0; from < MAX_ROWS_SCANNED; from += PAGE) {
    let q = admin.from(ds.view).select(select).eq('org_id', ctx.orgId)
    if (ctx.scopedUserIds && ds.ownerColumn) q = q.in(ds.ownerColumn, ctx.scopedUserIds)
    if (start) q = q.gte(ds.dateColumn, start)
    if (end) q = q.lte(ds.dateColumn, end)
    for (const f of spec.filters) {
      const col = columnOf(ds, f.column)!
      const v = f.value ?? ''
      if (f.op === 'eq') q = col.type === 'bool' ? q.eq(f.column, String(v) === 'true') : q.eq(f.column, v)
      else if (f.op === 'neq') q = q.neq(f.column, v)
      else if (f.op === 'gt') q = q.gt(f.column, v)
      else if (f.op === 'gte') q = q.gte(f.column, v)
      else if (f.op === 'lte') q = q.lte(f.column, v)
      else if (f.op === 'contains') q = q.ilike(f.column, `%${String(v).replace(/[%_]/g, '')}%`)
      else if (f.op === 'is_true') q = q.eq(f.column, true)
      else if (f.op === 'is_false') q = q.eq(f.column, false)
    }
    const { data, error } = await q.order(ds.dateColumn, { ascending: false, nullsFirst: false }).order(ds.idColumn).range(from, from + PAGE - 1)
    if (error) throw new Error(`Report query failed: ${error.message}`)
    const page = (data ?? []) as unknown as Record<string, unknown>[]
    all.push(...page)
    if (page.length < PAGE) break
    if (from + PAGE >= MAX_ROWS_SCANNED) truncated = true
  }

  if (spec.mode === 'rows') {
    const cols = visibleColumns(ctx, ds)
    let rows = all
    if (spec.sortBy) {
      const k = spec.sortBy
      const dir = spec.sortDesc === false ? 1 : -1
      rows = [...all].sort((a, b) => {
        const x = a[k] as number | string | null, y = b[k] as number | string | null
        if (x == null) return 1
        if (y == null) return -1
        return (x < y ? -1 : x > y ? 1 : 0) * dir
      })
    }
    const limit = Math.min(spec.limit ?? MAX_ROWS_RETURNED, MAX_ROWS_RETURNED)
    return {
      columns: cols.map((c) => ({ key: c.key, label: c.label, type: c.type })),
      rows: rows.slice(0, limit).map((r) => Object.fromEntries(cols.map((c) => [c.key, (r[c.key] as string | number | boolean | null) ?? null]))),
      matched: all.length, scanned: all.length, truncated: truncated || rows.length > limit, summary: null,
    }
  }

  const groups = new Map<string, { n: number; sum: number; yes: number }>()
  for (const r of all) {
    const k = groupKey(r, ds, spec.groupBy)
    const g = groups.get(k) ?? { n: 0, sum: 0, yes: 0 }
    g.n += 1
    if (spec.metric.kind === 'sum' || spec.metric.kind === 'avg') g.sum += Number(r[spec.metric.column]) || 0
    if (spec.metric.kind === 'rate' && r[spec.metric.column] === true) g.yes += 1
    groups.set(k, g)
  }
  const metricLabel =
    spec.metric.kind === 'count' ? 'Count'
    : spec.metric.kind === 'rate' ? `% ${columnOf(ds, spec.metric.column)!.label}`
    : `${spec.metric.kind === 'sum' ? 'Total' : 'Average'} ${columnOf(ds, spec.metric.column)!.label}`
  const valueOf = (g: { n: number; sum: number; yes: number }) =>
    spec.metric.kind === 'count' ? g.n
    : spec.metric.kind === 'sum' ? g.sum
    : spec.metric.kind === 'avg' ? (g.n ? g.sum / g.n : 0)
    : g.n ? (g.yes / g.n) * 100 : 0
  const round = (n: number) => Math.round(n * 100) / 100
  const isTime = spec.groupBy === '@month' || spec.groupBy === '@week'
  let rows = Array.from(groups.entries()).map(([group, g]) => ({ group, value: round(valueOf(g)), rows: g.n }))
  rows.sort(isTime ? (a, b) => a.group.localeCompare(b.group) : (a, b) => (spec.sortDesc === false ? a.value - b.value : b.value - a.value))
  const limit = Math.min(spec.limit ?? MAX_ROWS_RETURNED, MAX_ROWS_RETURNED)
  const groupCol = spec.groupBy && !isTime ? columnOf(ds, spec.groupBy)?.label ?? 'Group' : spec.groupBy === '@week' ? 'Week of' : spec.groupBy === '@month' ? 'Month' : 'All'
  const total = spec.metric.kind === 'count' ? all.length
    : spec.metric.kind === 'sum' ? rows.reduce((s, r) => s + r.value, 0)
    : null
  rows = rows.slice(0, limit)
  return {
    columns: [
      { key: 'group', label: groupCol, type: 'text' },
      { key: 'value', label: metricLabel, type: spec.metric.kind === 'rate' ? 'number' : spec.metric.kind === 'count' ? 'number' : (columnOf(ds, (spec.metric as { column: string }).column)?.type ?? 'number') },
      { key: 'rows', label: 'Rows', type: 'number' },
    ],
    rows, matched: groups.size, scanned: all.length, truncated,
    summary: total === null ? null : { label: metricLabel, value: round(total) },
  }
}

/** CSV with spreadsheet-formula protection (a cell starting = + - @ is prefixed with an apostrophe). */
export function resultToCsv(result: ReportResult): string {
  const esc = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v)
    // Real numbers (incl. negatives) stay numbers; only text that could be read as a formula is neutralised.
    if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [result.columns.map((c) => esc(c.label)).join(',')]
  for (const r of result.rows) lines.push(result.columns.map((c) => esc(r[c.key])).join(','))
  return lines.join('\n')
}
