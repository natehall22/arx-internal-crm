/** @jest-environment node */
import { countContacts, fetchPeriodMetricRows, summarizePeriodRows } from '@/lib/reporting/period-metrics'

function fakeAdmin(tables: Record<string, Array<Record<string, unknown>>>) {
  const seen: string[] = []
  const admin = {
    from(view: string) {
      const q: any = {
        select: () => q,
        eq: (col: string, val: unknown) => { if (col === 'org_id') seen.push(`${view}:${String(val)}`); return q },
        gte: () => q, lt: () => q, order: () => q,
        range: async (from: number) => ({ data: from === 0 ? tables[view] ?? [] : [], error: null }),
      }
      return q
    },
  }
  return { admin: admin as never, seen }
}

describe('period metrics from the reporting views', () => {
  it('fences every view to the org and counts one sale / one sit per opportunity', async () => {
    const { admin, seen } = fakeAdmin({
      rpt_canvass_doors: [{ user_id: 'u1', disposition: 'not_home' }, { user_id: 'u1', disposition: 'talked' }],
      rpt_inspection_sets: [{ setter_user_id: 's1', closer_user_id: 'c1' }],
      rpt_sits: [
        { opportunity_id: 'o1', setter_user_id: 's1', closer_user_id: 'c1' },
        { opportunity_id: 'o1', setter_user_id: 's1', closer_user_id: 'c1' },
      ],
      // a split cash/finance deal: two signed agreements on one opportunity
      rpt_sales: [
        { opportunity_id: 'o9', contract_id: 'k1', setter_user_id: 's1', closer_user_id: 'c1' },
        { opportunity_id: 'o9', contract_id: 'k2', setter_user_id: 's1', closer_user_id: 'c1' },
        { opportunity_id: null, contract_id: 'k3', setter_user_id: null, closer_user_id: 'c2' },
      ],
      rpt_appointments: [{ closer_user_id: 'c1' }, { closer_user_id: null }],
    })
    const rows = await fetchPeriodMetricRows(admin, { orgId: 'org-1', startIso: '2026-10-18T04:00:00Z', endIso: '2026-10-25T04:00:00Z' })
    expect(new Set(seen.map((s) => s.split(':')[1]))).toEqual(new Set(['org-1']))
    expect(seen).toHaveLength(6) // 5 views + the test-account lookup
    expect(rows.doors).toHaveLength(2)
    expect(rows.sits).toHaveLength(1)
    expect(rows.sales.map((s) => s.opportunity_id).sort()).toEqual(['k3', 'o9'])
    expect(rows.calendar).toEqual([{ closer_user_id: 'c1' }])
    expect(countContacts(rows.doors, new Set(['talked']))).toBe(1)
  })
})

describe('summarizePeriodRows', () => {
  const rows = {
    doors: [{ user_id: 'u1', disposition: 'talked' }, { user_id: 'u1', disposition: 'not_home' }, { user_id: 'u2', disposition: 'talked' }, { user_id: null, disposition: null }],
    sets: [{ setter_user_id: 'u1', closer_user_id: 'c1' }, { setter_user_id: 'u2', closer_user_id: 'c1' }],
    sits: [{ opportunity_id: 'o1', setter_user_id: 'u1', closer_user_id: 'c1' }],
    sales: [{ opportunity_id: 'o1', setter_user_id: 'u1', closer_user_id: 'c1' }, { opportunity_id: 'o2', setter_user_id: 'u2', closer_user_id: 'c1' }],
    calendar: [{ closer_user_id: 'c1' }, { closer_user_id: 'c1' }],
  }
  const opts = { setterLane: false, contactDispositionIdSet: new Set(['talked']) }
  it('totals one person: setter lane vs closer lane, sale credited to setter AND closer once', () => {
    expect(summarizePeriodRows(rows, new Set(['u1']), { ...opts, setterLane: true })).toEqual({ doors: 2, contacts: 1, inspectionsSet: 1, inspectionsReceived: 0, sits: 1, sales: 1, calendar: 0 })
    expect(summarizePeriodRows(rows, new Set(['c1']), opts)).toEqual({ doors: 0, contacts: 0, inspectionsSet: 0, inspectionsReceived: 2, sits: 1, sales: 2, calendar: 2 })
    // a closer's sits are NOT counted in the setter lane
    expect(summarizePeriodRows(rows, new Set(['c1']), { ...opts, setterLane: true }).sits).toBe(0)
  })
  it('null scope = whole org (rows with no credited person still count)', () => {
    expect(summarizePeriodRows(rows, null, opts)).toMatchObject({ doors: 4, sales: 2, sits: 1, calendar: 2 })
  })
})
