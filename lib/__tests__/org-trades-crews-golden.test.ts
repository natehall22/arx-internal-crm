/** @jest-environment node */
/**
 * Golden: moving the trades list into org_trades must not change what the crews flow does for a company on
 * the standard list — the auto trades created, the schedule board, the job's crews, assign/unassign and the
 * Google invite. Every expectation below was produced by the code BEFORE org_trades existed and is checked
 * twice here: once with the org's rows in org_trades, once with the table empty (the pre-migration fallback).
 */
import { DEFAULT_ORG_TRADES } from '@/lib/org-trades'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(async () => ({
    authUser: { id: 'u-ops' },
    profile: { id: 'u-ops', org_id: 'org-1', role: 'operations', custom_role_id: null },
  })),
}))
jest.mock('@/lib/ops-access', () => {
  const actual = jest.requireActual('@/lib/ops-access')
  return { ...actual, resolveOpsAccess: jest.fn(async () => ({ canJobBoard: true, canEditJobs: true, canViewJobFinancials: false })) }
})
jest.mock('@/lib/supplier-orders', () => ({ refreshMaterialsOrderedFromSuppliers: jest.fn(async () => undefined) }))
jest.mock('@/lib/appointment-calendar-sync', () => ({ getValidAccessToken: jest.fn(async () => 'tok') }))
const events: Array<{ summary: string; description: string }> = []
jest.mock('@/lib/google-calendar', () => {
  const actual = jest.requireActual('@/lib/google-calendar')
  return {
    ...actual,
    createCalendarEvent: jest.fn(async (_t: string, ev: { summary: string; description: string }) => {
      events.push(ev)
      return { id: `ev-${events.length}` }
    }),
    updateCalendarEvent: jest.fn(async (_t: string, _id: string, ev: { summary: string; description: string }) => {
      events.push(ev)
      return {}
    }),
    deleteCalendarEvent: jest.fn(async () => undefined),
  }
})

let db: ReturnType<typeof createFakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

const ORG = 'org-1'
function seed(withOrgTrades: boolean) {
  events.length = 0
  db = createFakeDb({
    orgs: [{ id: ORG, phone: null, install_scheduling_user_id: null, install_scheduling_calendar_id: null, settings: {} }],
    org_trades: withOrgTrades
      ? DEFAULT_ORG_TRADES.map((t) => ({ org_id: ORG, slug: t.slug, label: t.label, sort: t.sort, active: t.active, match_keywords: t.matchKeywords }))
      : [],
    production_jobs: [
      // Mixed job sold with gutters + siding + window line items → roofing (primary) + gutters + siding + windows.
      { id: 'j1', org_id: ORG, job_number: '26-0101', project_id: null, customer_id: 'c1', job_type: 'mixed', status: 'sold', address_text: '1 Elm St', scheduled_date: null, scheduled_time_start: null, install_days: null, assigned_sub_id: null, install_google_event_id: null, install_calendar_id: null, completed_at: null, cancelled_at: null, created_by: 'u1', linked_proposal_id: 'prop-1', accepted_proposal_id: null, sale_date: '2026-10-01', created_at: '2026-10-01T12:00:00Z' },
      // Siding job already on the calendar before trades existed → adopts the sub/date.
      { id: 'j2', org_id: ORG, job_number: '26-0102', project_id: null, customer_id: 'c2', job_type: 'siding', status: 'scheduled', address_text: '2 Oak St', scheduled_date: '2026-11-10', scheduled_time_start: null, install_days: 1, assigned_sub_id: 's1', install_google_event_id: null, install_calendar_id: null, completed_at: null, cancelled_at: null, created_by: 'u1', linked_proposal_id: null, accepted_proposal_id: null, sale_date: '2026-10-02', created_at: '2026-10-02T12:00:00Z' },
    ],
    proposal_line_items: [
      { proposal_id: 'prop-1', name: 'Asphalt Shingles Installation', category: 'Roofing' },
      { proposal_id: 'prop-1', name: '6" Seamless Gutters', category: 'addons' },
      { proposal_id: 'prop-1', name: 'Vinyl Siding', category: 'addons' },
      { proposal_id: 'prop-1', name: 'Replace 2 windows', category: 'addons' },
      { proposal_id: 'prop-1', name: 'Soffit replacement', category: 'addons' },
    ],
    work_orders: [],
    sub_contractors: [{ id: 's1', org_id: ORG, company_name: 'Side Crew', services: ['siding', 'gutters'], scheduling_email: 'crew@example.test', phone: null, active: true }],
    photos: [],
    customers: [{ id: 'c1', name: 'Pat One' }, { id: 'c2', name: 'Sam Two' }],
  })
}

const stableTrade = (w: Record<string, unknown>) => ({ job_id: w.job_id, trade: w.trade, trade_source: w.trade_source, title: w.title, status: w.status, assigned_sub_id: w.assigned_sub_id ?? null, scheduled_date: w.scheduled_date ?? null })

const EXPECTED_AUTO_TRADES = [
  { job_id: 'j1', trade: 'roofing', trade_source: 'auto', title: 'Roofing install', status: 'pending', assigned_sub_id: null, scheduled_date: null },
  { job_id: 'j1', trade: 'gutters', trade_source: 'auto', title: 'Gutters install', status: 'pending', assigned_sub_id: null, scheduled_date: null },
  { job_id: 'j1', trade: 'siding', trade_source: 'auto', title: 'Siding install', status: 'pending', assigned_sub_id: null, scheduled_date: null },
  { job_id: 'j1', trade: 'windows', trade_source: 'auto', title: 'Windows install', status: 'pending', assigned_sub_id: null, scheduled_date: null },
  { job_id: 'j2', trade: 'siding', trade_source: 'auto', title: 'Siding install', status: 'scheduled', assigned_sub_id: 's1', scheduled_date: '2026-11-10' },
]

describe.each([
  ['org_trades seeded', true],
  ['org_trades empty (before the migration)', false],
])('crews flow on the standard list — %s', (_name, withOrgTrades) => {
  beforeEach(() => seed(withOrgTrades as boolean))

  it('ensureJobTrades creates the same auto trades', async () => {
    const { ensureJobTrades } = await import('@/lib/job-trades-db')
    await ensureJobTrades(db.client, ORG, ['j1', 'j2'])
    expect(db.tables.work_orders.map(stableTrade)).toEqual(EXPECTED_AUTO_TRADES)
  })

  it('the board and the job crews list are unchanged', async () => {
    const board = await (await import('@/app/api/ops/install-schedule/route')).GET(new Request('http://localhost/api/ops/install-schedule?start=2026-11-09&end=2026-11-15'))
    expect(board.status).toBe(200)
    const b = await board.json()
    expect(b.scheduled.map((t: Record<string, unknown>) => [t.job_number, t.trade, t.scheduled_date, t.assigned_sub_id])).toEqual([['26-0102', 'siding', '2026-11-10', 's1']])
    expect(b.unscheduled.map((t: Record<string, unknown>) => [t.job_number, t.trade])).toEqual([
      ['26-0101', 'roofing'],
      ['26-0101', 'gutters'],
      ['26-0101', 'siding'],
      ['26-0101', 'windows'],
    ])

    const crews = await (await import('@/app/api/ops/jobs/[id]/trades/route')).GET(new Request('http://localhost'), { params: { id: 'j1' } })
    const c = await crews.json()
    expect(c.trades.map((t: { trade: string }) => t.trade)).toEqual(['roofing', 'gutters', 'siding', 'windows'])
    expect(c.orgTrades.map((t: { label: string }) => t.label)).toEqual(['Roofing', 'Gutters', 'Siding', 'Windows', 'Other'])
  })

  it('adding a trade by hand accepts the five standard trades and nothing else', async () => {
    const { POST } = await import('@/app/api/ops/jobs/[id]/trades/route')
    const add = (trade: string) => POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ trade }) }), { params: { id: 'j1' } })
    expect((await add('other')).status).toBe(200)
    expect((await add('plumbing')).status).toBe(400)
    expect(db.tables.work_orders.find((w) => w.trade === 'other')).toMatchObject({ title: 'Other install', trade_source: 'manual' })
  })

  it('assign then unassign: same writes and the same Google invite text', async () => {
    const { ensureJobTrades } = await import('@/lib/job-trades-db')
    await ensureJobTrades(db.client, ORG, ['j1'])
    const gutters = db.tables.work_orders.find((w) => w.trade === 'gutters')!
    const { POST: assign } = await import('@/app/api/ops/install-schedule/assign/route')
    const res = await assign(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ workOrderId: gutters.id, subId: 's1', scheduledDate: '2026-11-12', installDays: 1 }) }))
    expect(res.status).toBe(200)
    expect(gutters).toMatchObject({ status: 'scheduled', assigned_sub_id: 's1', scheduled_date: '2026-11-12' })
    expect(db.tables.production_jobs.find((j) => j.id === 'j1')).toMatchObject({ scheduled_date: '2026-11-12', assigned_sub_id: 's1', status: 'scheduled' })
    expect(events.at(-1)?.summary).toBe('Gutters install — Customer') // the fake DB does not embed customers, so the name falls back
    expect(events.at(-1)?.description).toContain('Gutters: 1 day')

    const { POST: unassign } = await import('@/app/api/ops/install-schedule/unassign/route')
    expect((await unassign(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ workOrderId: gutters.id }) }))).status).toBe(200)
    expect(gutters).toMatchObject({ status: 'pending', assigned_sub_id: null, scheduled_date: null })
    expect(db.tables.production_jobs.find((j) => j.id === 'j1')).toMatchObject({ scheduled_date: null, assigned_sub_id: null, status: 'materials' })
  })
})
