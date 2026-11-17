/** @jest-environment node */
const resolveIsFieldRole = jest.fn(async () => false)
jest.mock('@/lib/effective-permissions', () => ({ resolveIsFieldRole: (...a: unknown[]) => (resolveIsFieldRole as jest.Mock)(...a), resolveEffectivePermissionNames: jest.fn(async () => ({ fullAccess: false, permissionNames: new Set<string>(), denied: new Set<string>() })) }))
jest.mock('@/lib/ops-access', () => ({ resolveOpsAccess: jest.fn(async () => ({ canJobBoard: false })) }))
jest.mock('@/lib/org-settings', () => ({ mergeOrgSettings: jest.fn() }))
jest.mock('@/lib/finance-access', () => ({ callerCanAccessJobBilling: jest.fn(async () => false) }))
const loadWorkSecondsByStop = jest.fn(async (..._a: unknown[]) => new Map<string, number>())
jest.mock('@/lib/time-tracking-db', () => ({ loadCrewSubIds: jest.fn(async () => ({ all: [], led: [] })), loadWorkSecondsByStop: (...a: unknown[]) => loadWorkSecondsByStop(...a), loadWorkSecondsByJob: jest.fn(async () => new Map()) }))
jest.mock('@/lib/supabase/org-db', () => ({ orgDb: () => ({ from: () => ({ select: () => ({ in: async () => ({ data: [] }) }) }) }) }))
const runReport = jest.fn()
const buildReportContext = jest.fn(async () => ({ orgId: 'o1', userId: 'u1', scope: 'all', finance: false, canExport: true, scopedUserIds: null }))
jest.mock('@/lib/reporting/run', () => {
  const actual = jest.requireActual('@/lib/reporting/run')
  return { ...actual, runReport: (...a: unknown[]) => runReport(...a), buildReportContext: (...a: unknown[]) => (buildReportContext as jest.Mock)(...a) }
})
const loadVisits = jest.fn(async (..._a: unknown[]): Promise<unknown[]> => [])
const loadServicePlans = jest.fn(async (..._a: unknown[]): Promise<unknown> => ({ ready: true, plans: [] }))
jest.mock('@/lib/service-plans-db', () => ({
  ...jest.requireActual('@/lib/service-plans-db'),
  loadVisits: (...a: unknown[]) => loadVisits(...a),
  loadServicePlans: (...a: unknown[]) => loadServicePlans(...a),
  loadVisitsPage: jest.fn(async () => ({ visits: [], hasMore: false })),
}))
const loadUnpaidInvoices = jest.fn(async (..._a: unknown[]): Promise<unknown> => ({ rows: [], capped: false }))
jest.mock('@/lib/service-billing-db', () => ({ loadUnpaidInvoices: (...a: unknown[]) => loadUnpaidInvoices(...a), loadReadyToBill: jest.fn(async () => ({ rows: [], capped: false })) }))
jest.mock('@/lib/cron-orgs', () => ({ loadOrgTimeZone: async () => 'UTC' }))

import { dashboardCardByKey, type DashboardAudience } from '@/lib/dashboard-cards'
import { loadDashboardCardData, loadMyDayCards, type DashboardViewerInfo } from '@/lib/dashboard-cards-server'
import { resolveOrgProfile } from '@/lib/org-profile'

const admin = {} as never
const lawn = resolveOrgProfile({ profile: { id: 'lawn_landscape', version: 6 } })
const profile = (role: string) => ({ id: 'u1', org_id: 'o1', role, custom_role_id: null })
const NOW = new Date('2026-11-11T15:00:00Z')
const viewer = (audiences: DashboardAudience[], extra: Partial<DashboardViewerInfo> = {}): DashboardViewerInfo => ({ userId: 'u1', audiences: new Set(audiences), financials: false, books: false, ledSubIds: null, ...extra })
const listOf = (...keys: string[]) => keys.map((k) => ({ card: dashboardCardByKey(k)!, goal: null }))
const run = (v: DashboardViewerInfo, keys: string[], features = lawn.features) => loadDashboardCardData(admin, { profile: profile('x'), viewer: v, cards: listOf(...keys), features, now: NOW })
const MONEY = ['billed-week', 'collected-week', 'unpaid-overdue', 'revenue-per-crew-hour', 'mrr', 'projects-backlog', 'ar-aging']

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  runReport.mockResolvedValue({ summary: { value: 0 }, rows: [], scanned: 0 })
})

describe('server-side denial: a card the viewer may not see is never loaded, whatever list is passed in', () => {
  it('a crew lead handed every money card gets none and no money source is read', async () => {
    const out = await run(viewer(['crew'], { ledSubIds: ['a'] }), MONEY)
    expect(out).toEqual([])
    expect(runReport).not.toHaveBeenCalled()
    expect(loadUnpaidInvoices).not.toHaveBeenCalled()
    expect(loadServicePlans).not.toHaveBeenCalled()
  })
  it('a field tech (crew, no money) gets nothing from the owner’s or billing cards', async () => {
    expect(await run(viewer(['crew'], { ledSubIds: ['a'] }), ['cancellations-month', 'ar-aging', 'office-unassigned', 'my-quotes-out'])).toEqual([])
    expect(loadVisits).not.toHaveBeenCalled()
  })
  it('a salesperson cannot be handed owner or office cards', async () => {
    expect(await run(viewer(['sales']), ['billed-week', 'cancellations-month', 'office-callbacks', 'crews'])).toEqual([])
    expect(runReport).not.toHaveBeenCalled()
  })
  it('billing without money:record or reports:financials gets nothing', async () => {
    expect(await run(viewer(['billing']), ['ar-aging', 'unbilled-visits', 'collected-week'])).toEqual([])
    expect(loadUnpaidInvoices).not.toHaveBeenCalled()
  })
  it('an owner without reports:financials gets no dollar card even when asked', async () => {
    expect(await run(viewer(['owner']), ['billed-week', 'collected-week', 'revenue-per-crew-hour', 'mrr', 'projects-backlog'])).toEqual([])
    expect(runReport).not.toHaveBeenCalled()
  })
  it('a field role with no audience gets nothing', async () => {
    expect(await run(viewer([]), ['visits-done-week', 'my-day', 'billed-week'])).toEqual([])
    expect(loadVisits).not.toHaveBeenCalled()
  })
})

describe('books money: money:record opens the books cards, nothing else', () => {
  it('collected this week runs with the money fence open for that card only, over the company', async () => {
    runReport.mockResolvedValue({ summary: { value: 700 }, rows: [{ group: 'Total', value: 700, sum_collected: 700, rows: 2 }], scanned: 2 })
    const out = await run(viewer(['billing'], { books: true }), ['collected-week', 'billed-week'])
    expect(out.map((c) => c.key)).toEqual(['collected-week'])
    const ctx = runReport.mock.calls[0][1]
    expect([ctx.finance, ctx.scope, ctx.scopedUserIds]).toEqual([true, 'all', null])
    // the base context was never widened for the financials-only card
    expect(runReport.mock.calls.every(([, , spec]) => spec.dataset === 'revenue')).toBe(true)
  })
})

describe('hidden cards do not run their loaders', () => {
  it('only the visits and plan sources a drawn card needs are read', async () => {
    await run(viewer(['owner']), ['cancellations-month'])
    expect(loadVisits).not.toHaveBeenCalled()
    expect(loadUnpaidInvoices).not.toHaveBeenCalled()
    expect(runReport).not.toHaveBeenCalled()
  })
  it('a feature the company has off is not loaded', async () => {
    const off = { ...lawn.features, servicePlans: false }
    expect(await run(viewer(['owner']), ['visits-done-week', 'crews'], off)).toEqual([])
    expect(loadVisits).not.toHaveBeenCalled()
  })
})

describe('My day', () => {
  it('the three cards share one read of the crew’s stops (one visits read per crew), with no money in any of them', async () => {
    loadVisits.mockResolvedValue([
      { id: 'v1', scheduledDate: '2026-11-11', status: 'completed', subId: 'a', address: '14 Oak Lane', planName: 'Mow', step: 'service', stepLabel: null, customerName: 'Pat Lee', officeNotes: null, accessNotes: 'Gate 4471', routePosition: 1 },
      { id: 'v2', scheduledDate: '2026-11-11', status: 'scheduled', subId: 'a', address: '3 Birch Ct', planName: 'Edge', step: 'service', stepLabel: null, customerName: 'Sam Roe', officeNotes: null, accessNotes: null, routePosition: 2 },
    ])
    loadWorkSecondsByStop.mockResolvedValue(new Map([['v1', 5400]]))
    const out = await run(viewer(['crew'], { ledSubIds: ['a'] }), ['my-day', 'my-visits-left', 'my-hours-today'])
    expect(loadVisits).toHaveBeenCalledTimes(1)
    expect(loadVisits.mock.calls[0][2]).toMatchObject({ subId: 'a', accessNotes: true })
    expect(out.map((c) => c.key)).toEqual(['my-day', 'my-visits-left', 'my-hours-today'])
    const day = out[0] as { rows: Array<{ title: string; detail: string; done?: boolean }>; count: number }
    expect([day.count, day.rows.map((r) => r.done)]).toEqual([1, [true, false]])
    expect(day.rows[0].detail).toContain('Gate / access: Gate 4471')
    expect(JSON.stringify(out)).not.toMatch(/\$\d/)
    expect(out[2]).toMatchObject({ value: 1.5 })
    expect(runReport).not.toHaveBeenCalled()
  })
  it('a crew member with no crew gets a plain "ask the office" message, not a failure', async () => {
    const out = await run(viewer(['crew'], { ledSubIds: null }), ['my-day'])
    expect(out[0]).toMatchObject({ kind: 'list', count: 0, failed: false })
  })
})

describe('My day on /today', () => {
  it('is empty for anyone who is not on a crew (no loader runs)', async () => {
    resolveIsFieldRole.mockResolvedValue(false)
    expect(await loadMyDayCards(admin, profile('sales_rep') as never, lawn.features)).toEqual([])
    expect(loadVisits).not.toHaveBeenCalled()
  })
})
