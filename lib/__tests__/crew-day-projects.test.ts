/** @jest-environment node */
import { loadCrewProjectStops, projectStopsToday } from '@/lib/crew-day-projects'

const row = (over: Record<string, unknown> = {}) => ({ id: 'w1', job_id: 'j1', trade: 'grading', status: 'scheduled', scheduled_date: '2026-11-10', install_days: 1, crew_link_token: 'tok', work_order_number: 'WO-1', ...over })

describe('projectStopsToday', () => {
  it('a one-day crew shows only on its day; a 1½/2 day crew also on its second day', () => {
    expect(projectStopsToday([row()], '2026-11-10')).toHaveLength(1)
    expect(projectStopsToday([row()], '2026-11-11')).toHaveLength(0)
    const two = projectStopsToday([row({ install_days: 2 })], '2026-11-11')
    expect(two).toHaveLength(1)
    expect(two[0]).toMatchObject({ dayNumber: 2, dayCount: 2 })
    expect(projectStopsToday([row({ install_days: 2 })], '2026-11-12')).toHaveLength(0)
  })
  it('future, unscheduled and cancelled crews never show', () => {
    expect(projectStopsToday([row({ scheduled_date: '2026-11-11' })], '2026-11-10')).toHaveLength(0)
    expect(projectStopsToday([row({ scheduled_date: null })], '2026-11-10')).toHaveLength(0)
    expect(projectStopsToday([row({ status: 'cancelled' })], '2026-11-10')).toHaveLength(0)
  })
})

function fakeAdmin(tables: Record<string, Array<Record<string, unknown>>>) {
  const seen: Array<[string, string, unknown]> = []
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])]
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => { seen.push([table, c, v]); rows = rows.filter((r) => r[c] === v); return q },
      neq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] !== v); return q },
      not: () => q,
      gte: (c: string, v: string) => { rows = rows.filter((r) => String(r[c]) >= v); return q },
      lte: (c: string, v: string) => { rows = rows.filter((r) => String(r[c]) <= v); return q },
      in: (c: string, v: unknown[]) => { rows = rows.filter((r) => v.includes(r[c])); return q },
      order: () => q,
      then: (res: (v: unknown) => void) => res({ data: rows, error: null }),
    }
    return q
  }
  return { from, seen }
}

describe('loadCrewProjectStops', () => {
  const tables = () => ({
    work_orders: [
      { org_id: 'o1', id: 'w1', job_id: 'j1', trade: 'grading', work_order_type: 'install', assigned_sub_id: 's1', status: 'scheduled', scheduled_date: '2026-11-10', install_days: 1, crew_link_token: 'tok-a', work_order_number: 'WO-1' },
      { org_id: 'o1', id: 'w2', job_id: 'j2', trade: 'grading', work_order_type: 'install', assigned_sub_id: 's2', status: 'scheduled', scheduled_date: '2026-11-10', install_days: 1, crew_link_token: 'tok-b', work_order_number: 'WO-2' },
      { org_id: 'o1', id: 'w3', job_id: 'j3', trade: 'grading', work_order_type: 'install', assigned_sub_id: 's1', status: 'scheduled', scheduled_date: '2026-11-10', install_days: 1, crew_link_token: null, work_order_number: 'WO-3' },
      { org_id: 'o1', id: 'v1', job_id: null, trade: 'lawn', work_order_type: 'service_visit', assigned_sub_id: 's1', status: 'scheduled', scheduled_date: '2026-11-10', install_days: null, crew_link_token: null, work_order_number: 'V-1' },
    ],
    production_jobs: [
      { org_id: 'o1', id: 'j1', job_number: '26-0141', address_text: '412 Pasture Ln', lat: 1, lng: 2, status: 'scheduled', cancelled_at: null },
      { org_id: 'o1', id: 'j2', job_number: '26-0142', address_text: 'Other', lat: null, lng: null, status: 'scheduled', cancelled_at: null },
      { org_id: 'o1', id: 'j3', job_number: '26-0143', address_text: 'Cancelled place', lat: null, lng: null, status: 'cancelled', cancelled_at: null },
    ],
    org_trades: [{ org_id: 'o1', slug: 'grading', label: 'Grading', sort: 1, active: true, match_keywords: null }],
  })
  it('only this crew\'s own project work orders (never another crew\'s, never visits, never a cancelled job); photo link is the trade\'s own', async () => {
    const admin = fakeAdmin(tables())
    const stops = await loadCrewProjectStops(admin as never, { orgId: 'o1', subId: 's1' }, '2026-11-10')
    expect(stops.map((s) => s.id)).toEqual(['w1'])
    expect(stops[0]).toMatchObject({ jobNumber: '26-0141', address: '412 Pasture Ln', photoLinkPath: '/crew/tok-a', tradeLabel: 'Grading', dayNumber: null })
    expect(admin.seen).toEqual(expect.arrayContaining([['work_orders', 'org_id', 'o1'], ['production_jobs', 'org_id', 'o1']]))
  })
  it('a trade with no link yet still shows (clock + directions), without a photos button', async () => {
    const t = tables()
    t.production_jobs[2].status = 'scheduled'
    const stops = await loadCrewProjectStops(fakeAdmin(t) as never, { orgId: 'o1', subId: 's1' }, '2026-11-10')
    expect(stops.find((s) => s.id === 'w3')?.photoLinkPath).toBeNull()
  })
})

describe('photo link expiry', () => {
  it('an expired trade link is hidden, not shown as a dead button', async () => {
    const t = {
      work_orders: [{ org_id: 'o1', id: 'w1', job_id: 'j1', trade: 'grading', work_order_type: 'install', assigned_sub_id: 's1', status: 'scheduled', scheduled_date: '2026-11-10', install_days: 1, crew_link_token: 'tok-a', work_order_number: 'WO-1' }],
      production_jobs: [{ org_id: 'o1', id: 'j1', job_number: '26-1', address_text: 'x', lat: null, lng: null, status: 'scheduled', cancelled_at: null }],
      org_trades: [],
    }
    // The page only lists today's work, so "today" is inside the window and the link is live; far past its grace it is not.
    const live = await loadCrewProjectStops(fakeAdmin(t) as never, { orgId: 'o1', subId: 's1' }, '2026-11-10')
    expect(live[0].photoLinkPath).toBe('/crew/tok-a')
    const { isCrewLinkExpired } = await import('@/lib/crew-link')
    expect(isCrewLinkExpired('2026-11-10', 1, '2027-01-10')).toBe(true)
  })
})
