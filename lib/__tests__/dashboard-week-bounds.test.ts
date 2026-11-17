/** @jest-environment node */
import { DATASETS } from '@/lib/reporting/catalog'
import { runReport } from '@/lib/reporting/run'
import type { ReportContext } from '@/lib/reporting/run'
import type { ReportSpec } from '@/lib/reporting/report-spec'

/** A tiny stand-in for the view: applies the runner's gte / lte on the date column, like Postgres does for text-comparable dates. */
function fakeAdmin(rows: Array<Record<string, unknown>>, dateCol: string) {
  const bounds: { gte?: string; lte?: string } = {}
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order']) q[m] = () => q
  q.gte = (_c: string, v: string) => { bounds.gte = v; return q }
  q.lte = (_c: string, v: string) => { bounds.lte = v; return q }
  q.range = async () => ({ data: rows.filter((r) => (!bounds.gte || String(r[dateCol]) >= bounds.gte) && (!bounds.lte || String(r[dateCol]) <= bounds.lte)), error: null })
  return { from: () => q } as never
}
const ctx = { orgId: 'o1', userId: 'u1', scope: 'all', finance: true, canExport: true, scopedUserIds: null, features: null } as unknown as ReportContext
const spec: ReportSpec = { dataset: 'revenue', mode: 'summary', groupBy: null, metric: { kind: 'sum', column: 'billed' }, date: { preset: '7d' }, filters: [], sortDesc: true }

describe('week bounds for a date-typed column', () => {
  it('rpt_revenue.event_date is a calendar day, flagged so callers pass YYYY-MM-DD', () => {
    expect(DATASETS.revenue.dateColumnIsDay).toBe(true)
    expect(DATASETS.sales.dateColumnIsDay).toBeUndefined()
  })
  it('Sunday..Saturday days include Saturday and leave out the next Sunday', async () => {
    const rows = [
      { revenue_id: 'a', event_date: '2026-11-08', billed: 100 },
      { revenue_id: 'b', event_date: '2026-11-14', billed: 10 },
      { revenue_id: 'c', event_date: '2026-11-15', billed: 1000 }, // next Sunday
      { revenue_id: 'd', event_date: '2026-11-07', billed: 5000 }, // last Saturday
    ]
    const r = await runReport(fakeAdmin(rows, 'event_date'), ctx, spec, { bounds: { start: '2026-11-08', end: '2026-11-14' } })
    expect(r.summary?.value).toBe(110)
  })
})
