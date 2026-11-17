/** @jest-environment node */
const mergeOrgSettings = jest.fn(async (..._a: unknown[]) => ({ error: null as string | null }))
jest.mock('@/lib/org-settings', () => ({ mergeOrgSettings: (...a: unknown[]) => mergeOrgSettings(...a) }))
const resolveIsFieldRole = jest.fn(async () => false)
const resolveEffectivePermissionNames = jest.fn(async () => ({ fullAccess: false, permissionNames: new Set<string>(), denied: new Set<string>() }))
jest.mock('@/lib/effective-permissions', () => ({
  resolveIsFieldRole: (...a: unknown[]) => (resolveIsFieldRole as jest.Mock)(...a),
  resolveEffectivePermissionNames: (...a: unknown[]) => (resolveEffectivePermissionNames as jest.Mock)(...a),
}))
const resolveOpsAccess = jest.fn(async () => ({ canJobBoard: false }))
jest.mock('@/lib/ops-access', () => ({ resolveOpsAccess: (...a: unknown[]) => (resolveOpsAccess as jest.Mock)(...a) }))
const loadCrewSubIds = jest.fn(async (..._a: unknown[]): Promise<{ all: string[]; led: string[] }> => ({ all: [], led: [] }))
const loadWorkSecondsByStop = jest.fn(async (..._a: unknown[]): Promise<Map<string, number> | null> => new Map())
const loadWorkSecondsByJob = jest.fn(async (..._a: unknown[]): Promise<Map<string, number> | null> => new Map())
jest.mock('@/lib/time-tracking-db', () => ({
  loadCrewSubIds: (...a: unknown[]) => loadCrewSubIds(...a),
  loadWorkSecondsByStop: (...a: unknown[]) => loadWorkSecondsByStop(...a),
  loadWorkSecondsByJob: (...a: unknown[]) => loadWorkSecondsByJob(...a),
}))
const callerCanAccessJobBilling = jest.fn(async (..._a: unknown[]) => false)
jest.mock('@/lib/finance-access', () => ({ callerCanAccessJobBilling: (...a: unknown[]) => callerCanAccessJobBilling(...a) }))
const loadVisitsPage = jest.fn(async (..._a: unknown[]): Promise<unknown> => ({ visits: [], hasMore: false }))
const userNames = jest.fn((): Array<{ id: string; full_name: string | null }> => [])
jest.mock('@/lib/supabase/org-db', () => ({ orgDb: () => ({ from: () => ({ select: () => ({ in: async () => ({ data: userNames() }) }) }) }) }))
const runReport = jest.fn()
const buildReportContext = jest.fn(async () => ({ orgId: 'o1', userId: 'u', scope: 'all', finance: true, canExport: true, scopedUserIds: null }))
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
  loadVisitsPage: (...a: unknown[]) => loadVisitsPage(...a),
}))
const loadUnpaidInvoices = jest.fn(async (..._a: unknown[]): Promise<unknown> => ({ rows: [], capped: false }))
jest.mock('@/lib/service-billing-db', () => ({ loadUnpaidInvoices: (...a: unknown[]) => loadUnpaidInvoices(...a) }))
jest.mock('@/lib/cron-orgs', () => ({ loadOrgTimeZone: async () => 'UTC' }))

import { DASHBOARD_CARDS, cardsForViewer, resolveDashboard, type CardData, type DashboardAudience, type LeaderboardData, type TileData } from '@/lib/dashboard-cards'
import { dashboardWindow, loadDashboardCardData, resolveDashboardViewer, saveDashboardCards, type DashboardViewerInfo } from '@/lib/dashboard-cards-server'
import { DEFAULT_ORG_FEATURES } from '@/lib/org-features'
import { resolveOrgProfile } from '@/lib/org-profile'
import { ReportAccessError } from '@/lib/reporting/run'

const admin = {} as never
const lawn = resolveOrgProfile({ profile: { id: 'lawn_landscape', version: 6 } })
const profile = (role: string) => ({ id: 'u1', org_id: 'o1', role, custom_role_id: null })
const NOW = new Date('2026-11-11T15:00:00Z') // a Wednesday

beforeEach(() => {
  jest.clearAllMocks()
  resolveIsFieldRole.mockResolvedValue(false)
  resolveEffectivePermissionNames.mockResolvedValue({ fullAccess: false, permissionNames: new Set(), denied: new Set() })
  resolveOpsAccess.mockResolvedValue({ canJobBoard: false })
  loadCrewSubIds.mockResolvedValue({ all: [], led: [] })
  callerCanAccessJobBilling.mockResolvedValue(false)
  loadVisitsPage.mockResolvedValue({ visits: [], hasMore: false })
  loadWorkSecondsByStop.mockResolvedValue(new Map())
  userNames.mockReturnValue([])
  buildReportContext.mockResolvedValue({ orgId: 'o1', userId: 'u1', scope: 'all', finance: true, canExport: true, scopedUserIds: null })
})

const OWNER = { owner: true, profileId: 'lawn_landscape', currentMode: 'cards' as const, startMode: 'cards' as const }
const ADMIN = { ...OWNER, owner: false }
const ROOFING_OWNER = { owner: true, profileId: 'roofing', currentMode: 'classic' as const, startMode: 'classic' as const }
const ROOFING_ADMIN = { ...ROOFING_OWNER, owner: false }
const BUILDER_OWNER = { owner: true, profileId: 'home_builder', currentMode: 'classic' as const, startMode: 'classic' as const }

describe('saveDashboardCards: the one writer', () => {
  it('saves a valid list at path [dashboardCards]', async () => {
    const r = await saveDashboardCards(admin, 'o1', { cards: [{ key: 'win-rate' }, { key: 'billed-week', goal: 5000 }] }, lawn.features, OWNER)
    expect(r.ok).toBe(true)
    expect(mergeOrgSettings).toHaveBeenCalledWith(admin, 'o1', { cards: [{ key: 'win-rate', goal: null }, { key: 'billed-week', goal: 5000 }] }, { path: ['dashboardCards'] })
  })
  it('writes nothing for a key outside the catalog, a card with no source or a feature that is off', async () => {
    for (const cards of [[{ key: 'doors-knocked' }], [{ key: 'visit-hours-vs-plan' }], [{ key: 'classic-quick-stats' }, { key: 'win-rate' }]]) {
      const r = await saveDashboardCards(admin, 'o1', { cards }, lawn.features, OWNER)
      expect(r).toMatchObject({ ok: false, status: 400 })
    }
    expect((await saveDashboardCards(admin, 'o1', { cards: [{ key: 'crews' }] }, { ...DEFAULT_ORG_FEATURES, servicePlans: false }, OWNER)).ok).toBe(false)
    expect(mergeOrgSettings).not.toHaveBeenCalled()
  })
  it('reset removes the stored list so the profile’s starting set applies', async () => {
    expect(await saveDashboardCards(admin, 'o1', null, lawn.features, OWNER, { reset: true })).toEqual({ ok: true, cards: null })
    expect(mergeOrgSettings).toHaveBeenCalledWith(admin, 'o1', {}, { path: ['dashboardCards'], remove: ['cards'] })
    // …and what is left resolves to the starting set
    expect(resolveDashboard({ dashboardCards: {} }, lawn.dashboard.cards).custom).toBe(false)
  })
  it('a failed write is a 500, never "saved"', async () => {
    mergeOrgSettings.mockResolvedValueOnce({ error: 'boom' })
    expect(await saveDashboardCards(admin, 'o1', { cards: [{ key: 'win-rate' }] }, lawn.features, OWNER)).toMatchObject({ ok: false, status: 500 })
  })

  describe('who may change what (enforced in the writer, not only the screen)', () => {
    const classicList = { cards: [{ key: 'classic-quick-stats' }, { key: 'classic-progress' }] } // leaves out Estimated pay
    it('an admin cannot save a classic sections list (it could hide Estimated pay)', async () => {
      expect(await saveDashboardCards(admin, 'o1', classicList, lawn.features, ROOFING_ADMIN)).toMatchObject({ ok: false, status: 403 })
      expect(mergeOrgSettings).not.toHaveBeenCalled()
    })
    it('an admin cannot switch a classic dashboard to cards, nor a card dashboard back to classic', async () => {
      expect(await saveDashboardCards(admin, 'o1', { cards: [{ key: 'win-rate' }] }, lawn.features, { ...ROOFING_ADMIN, profileId: 'home_builder' })).toMatchObject({ ok: false, status: 403 })
      expect(await saveDashboardCards(admin, 'o1', classicList, lawn.features, ADMIN)).toMatchObject({ ok: false, status: 403 })
      expect(mergeOrgSettings).not.toHaveBeenCalled()
    })
    it('an admin still edits an existing card dashboard', async () => {
      expect((await saveDashboardCards(admin, 'o1', { cards: [{ key: 'win-rate' }] }, lawn.features, ADMIN)).ok).toBe(true)
    })
    it('the owner may save a classic list for a company that is not roofing, and switch it to cards', async () => {
      expect((await saveDashboardCards(admin, 'o1', classicList, lawn.features, BUILDER_OWNER)).ok).toBe(true)
      expect((await saveDashboardCards(admin, 'o1', { cards: [{ key: 'win-rate' }] }, lawn.features, BUILDER_OWNER)).ok).toBe(true)
    })
    it('a roofing company is never switched to cards, not even by its owner', async () => {
      expect(await saveDashboardCards(admin, 'o1', { cards: [{ key: 'win-rate' }] }, lawn.features, ROOFING_OWNER)).toMatchObject({ ok: false, status: 403 })
      expect(mergeOrgSettings).not.toHaveBeenCalled()
    })
    it('reset: an admin cannot undo the owner’s hidden classic sections', async () => {
      expect(await saveDashboardCards(admin, 'o1', null, lawn.features, ROOFING_ADMIN, { reset: true })).toMatchObject({ ok: false, status: 403 })
      expect(mergeOrgSettings).not.toHaveBeenCalled()
      expect((await saveDashboardCards(admin, 'o1', null, lawn.features, ROOFING_OWNER, { reset: true })).ok).toBe(true)
    })
    it('reset: an admin may return a card dashboard to its card starting set, but not change the dashboard type', async () => {
      expect((await saveDashboardCards(admin, 'o1', null, lawn.features, ADMIN, { reset: true })).ok).toBe(true)
      mergeOrgSettings.mockClear()
      // a home_builder company that was switched to cards: starting set is classic, so only the owner resets across
      expect(await saveDashboardCards(admin, 'o1', null, lawn.features, { ...ADMIN, profileId: 'home_builder', startMode: 'classic' }, { reset: true })).toMatchObject({ ok: false, status: 403 })
      expect(mergeOrgSettings).not.toHaveBeenCalled()
    })
  })
})

describe('who is looking', () => {
  it('a field role gets no audience and no money, whatever it was granted', async () => {
    resolveIsFieldRole.mockResolvedValue(true)
    resolveEffectivePermissionNames.mockResolvedValue({ fullAccess: true, permissionNames: new Set(['reports:financials']), denied: new Set() })
    const v = await resolveDashboardViewer(admin, profile('setter'))
    expect([v.audiences.size, v.financials]).toEqual([0, false])
    expect(cardsForViewer(resolveDashboard({}, lawn.dashboard.cards).cards, v, lawn.features)).toEqual([])
  })
  it('owners / admins see everything', async () => {
    const v = await resolveDashboardViewer(admin, profile('admin'))
    expect(Array.from(v.audiences)).toEqual(['owner'])
  })
  it('a salesperson is sales; office staff on the job board are office (not crew)', async () => {
    expect(Array.from((await resolveDashboardViewer(admin, profile('sales_rep'))).audiences)).toEqual(['sales'])
    resolveOpsAccess.mockResolvedValue({ canJobBoard: true })
    expect(Array.from((await resolveDashboardViewer(admin, profile('operations'))).audiences)).toEqual(['office'])
  })
  it('a super admin is the owner even in the operations role', async () => {
    resolveOpsAccess.mockResolvedValue({ canJobBoard: true })
    const v = await resolveDashboardViewer(admin, { ...profile('operations'), is_super_admin: true })
    expect(Array.from(v.audiences)).toEqual(['owner'])
  })
  it('billing comes from the money:record / billing gate, never from the role name', async () => {
    callerCanAccessJobBilling.mockResolvedValue(true)
    const v = await resolveDashboardViewer(admin, profile('bookkeeper'))
    expect([Array.from(v.audiences).includes('billing'), v.books, v.financials]).toEqual([true, true, false])
  })
  it('a field tech is crew only with no money, whatever it was granted, narrowed to every crew it is on', async () => {
    resolveEffectivePermissionNames.mockResolvedValue({ fullAccess: true, permissionNames: new Set(['reports:financials']), denied: new Set() })
    loadCrewSubIds.mockResolvedValue({ all: ['crew-a', 'crew-b'], led: [] })
    const v = await resolveDashboardViewer(admin, profile('field_tech'))
    expect([Array.from(v.audiences), v.financials, v.books, v.ledSubIds]).toEqual([['crew'], false, false, ['crew-a', 'crew-b']])
  })
  it('a field tech whose crew lookup fails gets nothing', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    loadCrewSubIds.mockRejectedValue(new Error('db down'))
    expect((await resolveDashboardViewer(admin, profile('field_tech'))).audiences.size).toBe(0)
  })
  it('a crew lead in a custom role is crew only, narrowed to the crews they lead', async () => {
    loadCrewSubIds.mockResolvedValue({ all: ['crew-a'], led: ['crew-a'] })
    const v = await resolveDashboardViewer(admin, profile('crew_lead'))
    expect([Array.from(v.audiences), v.ledSubIds]).toEqual([['crew'], ['crew-a']])
  })
  it('crews are found whether or not they track time (the lookup has no time-tracking filter)', async () => {
    await resolveDashboardViewer(admin, profile('crew_lead'))
    expect(loadCrewSubIds).toHaveBeenCalledWith(admin, 'o1', 'u1')
  })
  it('a failed crew lookup fails closed: no crew access, never the office view', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    loadCrewSubIds.mockRejectedValue(new Error('db down'))
    resolveOpsAccess.mockResolvedValue({ canJobBoard: true })
    const ops = await resolveDashboardViewer(admin, profile('operations'))
    // office staff see every crew, so the lookup is not what lets them in — but it never turns them into crew
    expect([Array.from(ops.audiences), ops.ledSubIds]).toEqual([['office'], null])
    resolveOpsAccess.mockResolvedValue({ canJobBoard: false })
    const lead = await resolveDashboardViewer(admin, profile('crew_lead'))
    expect(lead.audiences.size).toBe(0)
    // a salesperson keeps what is not about crews
    resolveOpsAccess.mockResolvedValue({ canJobBoard: false })
    expect(Array.from((await resolveDashboardViewer(admin, profile('sales_rep'))).audiences)).toEqual(['sales'])
  })
})

const owner: DashboardViewerInfo = { userId: 'u1', audiences: new Set<DashboardAudience>(['owner']), financials: true, ledSubIds: null }
const visit = (id: string, status: string, subId: string, extra: Record<string, unknown> = {}) => ({ id, status, subId, subName: subId.toUpperCase(), moved: false, skipReason: null, ...extra })
const cardsFor = (viewer: DashboardViewerInfo, features = lawn.features) => cardsForViewer(resolveDashboard({}, lawn.dashboard.cards).cards, viewer, features)
const byKey = (out: CardData[], key: string) => out.find((c) => c.key === key)

describe('the numbers come from the existing sources', () => {
  it('billed this week: the report runner, over the company’s Sunday-to-Saturday as exact instants', async () => {
    runReport.mockResolvedValue({ summary: { value: 4200 }, rows: [], scanned: 3 })
    const out = await loadDashboardCardData(admin, { profile: profile('admin'), viewer: owner, cards: cardsFor(owner), features: lawn.features, now: NOW })
    expect((byKey(out, 'billed-week') as TileData).value).toBe(4200)
    const call = runReport.mock.calls.find(([, , spec]) => spec.dataset === 'revenue')!
    // rpt_revenue.event_date is a calendar day: the week's first and last DAY, both inclusive
    expect(call[3]).toEqual({ bounds: { start: '2026-11-08', end: '2026-11-14' } })
    // a timestamp column (rpt_sales.signed_at) gets the exact instants
    runReport.mockClear()
    await loadDashboardCardData(admin, { profile: profile('admin'), viewer: owner, cards: cardsFor(owner), features: lawn.features, now: NOW })
    const sales = runReport.mock.calls.find(([, , sp]) => sp.dataset === 'sales')!
    expect(sales[3]).toEqual({ bounds: { start: '2026-11-08T00:00:00.000Z', end: '2026-11-14T23:59:59.999Z' } })
    // the spec's own rolling date is never what a "this week" card reads
    expect(DASHBOARD_CARDS.filter((c) => c.source.kind === 'report' && c.source.range === 'week').map((c) => c.key)).toEqual(
      expect.arrayContaining(['billed-week', 'collected-week', 'quotes-won-week', 'dollars-sold-week', 'salespeople'])
    )
  })

  it('billed and collected share one scan of the revenue view', async () => {
    runReport.mockResolvedValue({ summary: { value: 4200 }, rows: [{ group: 'Total', value: 4200, sum_collected: 3100, rows: 5 }], scanned: 5 })
    const out = await loadDashboardCardData(admin, { profile: profile('admin'), viewer: owner, cards: cardsFor(owner), features: lawn.features, now: NOW })
    const revenueRuns = runReport.mock.calls.filter(([, , spec]) => spec.dataset === 'revenue')
    expect(revenueRuns).toHaveLength(1)
    expect(revenueRuns[0][2]).toMatchObject({ metric: { kind: 'sum', column: 'billed' }, alsoSum: ['collected'] })
    expect([(byKey(out, 'billed-week') as TileData).value, (byKey(out, 'collected-week') as TileData).value]).toEqual([4200, 3100])
  })

  it('the 30-day win rate keeps its own rolling window (no bounds passed)', async () => {
    runReport.mockResolvedValue({ summary: null, rows: [{ group: 'Total', value: 40 }], scanned: 10 })
    await loadDashboardCardData(admin, { profile: profile('admin'), viewer: owner, cards: cardsFor(owner), features: lawn.features, now: NOW })
    const call = runReport.mock.calls.find(([, , spec]) => spec.dataset === 'opportunities')!
    expect(call[2].date).toEqual({ preset: '30d' })
    expect(call[3]).toEqual({})
  })

  it('the salespeople leaderboard is one row per user id; the name is only the label', async () => {
    runReport.mockImplementation(async (_a: unknown, _c: unknown, spec: { groupBy?: string }) =>
      spec.groupBy === 'closer_user_id'
        ? { summary: null, scanned: 3, rows: [{ group: 'u-1', value: 900, rows: 2 }, { group: 'u-2', value: 500, rows: 1 }, { group: '(none)', value: 10, rows: 1 }] }
        : { summary: { value: 0 }, rows: [], scanned: 0 })
    userNames.mockReturnValue([{ id: 'u-1', full_name: 'Sam Lee' }, { id: 'u-2', full_name: 'Sam Lee' }])
    const out = await loadDashboardCardData(admin, { profile: profile('admin'), viewer: owner, cards: cardsFor(owner), features: lawn.features, now: NOW })
    const lb = byKey(out, 'salespeople') as LeaderboardData
    expect(lb.rows).toEqual([
      { id: 'u-1', name: 'Sam Lee', values: [2, 900] },
      { id: 'u-2', name: 'Sam Lee', values: [1, 500] },
      { id: '(none)', name: 'No closer', values: [1, 10] },
    ])
  })

  it('a failed read is a dash, never a false 0', async () => {
    runReport.mockRejectedValue(new Error('db down'))
    loadVisits.mockRejectedValue(new Error('db down'))
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const out = await loadDashboardCardData(admin, { profile: profile('admin'), viewer: owner, cards: cardsFor(owner), features: lawn.features, now: NOW })
    expect((byKey(out, 'billed-week') as TileData).value).toBeNull()
    expect((byKey(out, 'visits-done-week') as TileData).value).toBeNull()
    expect((byKey(out, 'crews') as LeaderboardData).failed).toBe(true)
  })

  it('unpaid and overdue reads the unpaid-invoices loader', async () => {
    runReport.mockResolvedValue({ summary: { value: 0 }, rows: [], scanned: 0 })
    loadUnpaidInvoices.mockResolvedValue({ capped: false, rows: [{ balanceCents: 15000, dueAt: '2026-11-01T00:00:00Z' }, { balanceCents: 5000, dueAt: '2026-11-20T00:00:00Z' }] })
    const out = await loadDashboardCardData(admin, { profile: profile('admin'), viewer: owner, cards: cardsFor(owner), features: lawn.features, now: NOW })
    expect(byKey(out, 'unpaid-overdue')).toMatchObject({ value: 200, sub: '2 unpaid · 1 overdue' })
  })

  it('visits done vs scheduled, skipped with top reasons, rain-day moves — one visits load', async () => {
    runReport.mockResolvedValue({ summary: { value: 0 }, rows: [], scanned: 0 })
    loadVisits.mockResolvedValue([
      visit('1', 'completed', 'a'), visit('2', 'completed', 'a'), visit('3', 'scheduled', 'a', { moved: true }),
      visit('4', 'skipped', 'b', { skipReason: 'rain' }), visit('5', 'skipped', 'b', { skipReason: 'rain' }), visit('6', 'skipped', 'b', { skipReason: 'customer_away' }),
      visit('7', 'cancelled', 'b'),
    ])
    const out = await loadDashboardCardData(admin, { profile: profile('admin'), viewer: owner, cards: cardsFor(owner), features: lawn.features, now: NOW })
    expect(byKey(out, 'visits-done-week')).toMatchObject({ value: 2, sub: 'of 6 scheduled this week' })
    expect((byKey(out, 'visits-skipped-week') as TileData).value).toBe(3)
    expect((byKey(out, 'visits-moved-week') as TileData).value).toBe(1)
    expect(loadVisits).toHaveBeenCalledTimes(1)
    expect(loadVisits.mock.calls[0][2]).toMatchObject({ from: '2026-11-08', to: '2026-11-14', accessNotes: false })
  })

  it('a crew lead sees only their crew, and the crews table never carries money', async () => {
    const lead: DashboardViewerInfo = { userId: 'u9', audiences: new Set<DashboardAudience>(['crew']), financials: false, ledSubIds: ['a'] }
    loadVisits.mockResolvedValue([visit('1', 'completed', 'a'), visit('2', 'skipped', 'a', { skipReason: 'rain' }), visit('3', 'completed', 'b')])
    const out = await loadDashboardCardData(admin, { profile: profile('crew_lead'), viewer: lead, cards: cardsFor(lead), features: lawn.features, now: NOW })
    expect(out.map((c) => c.key)).toEqual(['visits-done-week', 'visits-skipped-week', 'visits-moved-week', 'crews', 'my-day', 'my-visits-left', 'my-hours-today'])
    const crews = byKey(out, 'crews') as LeaderboardData
    expect(crews.rows.map((r) => r.name)).toEqual(['A'])
    expect(crews.columns.map((c) => c.format)).not.toContain('money')
    expect(crews.columns.map((c) => c.label)).not.toEqual(expect.arrayContaining([expect.stringMatching(/revenue|dollar|\$/i)]))
    expect(runReport).not.toHaveBeenCalled()
    expect(loadUnpaidInvoices).not.toHaveBeenCalled()
  })

  it('crew hours: finished work on that crew’s visits, over the same week as the visits, with no clock closed (only with time tracking on)', async () => {
    loadVisits.mockResolvedValue([visit('v1', 'completed', 'a'), visit('v2', 'completed', 'b')])
    loadWorkSecondsByStop.mockResolvedValue(new Map([['v1', 9000]]))
    const features = { ...lawn.features, timeTracking: true }
    const out = await loadDashboardCardData(admin, { profile: profile('admin'), viewer: owner, cards: cardsFor(owner, features), features, now: NOW })
    const crews = byKey(out, 'crews') as LeaderboardData
    expect(crews.columns.map((c) => c.key)).toEqual(['done', 'hours', 'skips'])
    expect(crews.rows.find((r) => r.id === 'a')!.values).toEqual([1, 2.5, 0])
    expect(crews.rows.find((r) => r.id === 'b')!.values).toEqual([1, 0, 0])
    // one window for visits and hours: the company's Sunday 00:00 to Saturday 23:59:59.999
    expect(loadWorkSecondsByStop.mock.calls[0][2]).toEqual({ fromIso: '2026-11-08T00:00:00.000Z', toIso: '2026-11-14T23:59:59.999Z', workOrderIds: ['v1', 'v2'] })
    expect(loadVisits.mock.calls[0][2]).toMatchObject({ from: '2026-11-08', to: '2026-11-14' })
  })

  it('hours that cannot be read show a dash, not 0', async () => {
    loadVisits.mockResolvedValue([visit('v1', 'completed', 'a')])
    loadWorkSecondsByStop.mockResolvedValue(null)
    const features = { ...lawn.features, timeTracking: true }
    const out = await loadDashboardCardData(admin, { profile: profile('admin'), viewer: owner, cards: cardsFor(owner, features), features, now: NOW })
    expect((byKey(out, 'crews') as LeaderboardData).rows[0].values).toEqual([1, null, 0])
  })

  it('a salesperson’s report is narrowed to their own deals; a report the runner refuses is not drawn', async () => {
    const rep: DashboardViewerInfo = { userId: 'u7', audiences: new Set<DashboardAudience>(['sales']), financials: false, ledSubIds: null }
    runReport.mockImplementation(async (_a: unknown, ctx: { scope: string }, spec: { groupBy?: string }) => {
      if (spec.groupBy === 'closer_user_id') throw new ReportAccessError('nope')
      return { summary: { value: 2 }, rows: [{ group: 'Total', value: 40 }], scanned: 2, ctx }
    })
    const out = await loadDashboardCardData(admin, { profile: profile('sales_rep'), viewer: rep, cards: cardsFor(rep), features: lawn.features, now: NOW })
    for (const [, ctx] of runReport.mock.calls) expect([ctx.scope, ctx.scopedUserIds]).toEqual(['own', ['u7']])
    // the runner refused the salespeople table: it is not drawn; every other sales card is, from the same own-deals scope
    expect(out.map((c) => c.key)).not.toContain('salespeople')
    expect(out.map((c) => c.key)).toEqual(expect.arrayContaining(['quotes-won-week', 'win-rate', 'dollars-sold-week']))
  })

  it('every drawn card of the starting set is one of the catalog’s', () => {
    for (const { card } of cardsFor(owner)) expect(DASHBOARD_CARDS).toContain(card)
  })
})

describe('dashboardWindow: the company’s week as exact instants (clock changes)', () => {
  const ZONE = 'America/New_York'
  const w = (iso: string) => { const x = dashboardWindow(new Date(iso), ZONE); return [x.from, x.weekEnd, x.fromIso, x.toIso] }

  it('an ordinary week runs Sunday 00:00 to Saturday 23:59:59.999 local', () => {
    expect(w('2026-11-11T15:00:00Z')).toEqual(['2026-11-08', '2026-11-14', '2026-11-08T05:00:00.000Z', '2026-11-15T04:59:59.999Z'])
  })
  it('March: the week the clocks spring forward is 167 hours, and the week before ends on EST', () => {
    expect(w('2026-03-10T15:00:00Z')).toEqual(['2026-03-08', '2026-03-14', '2026-03-08T05:00:00.000Z', '2026-03-15T03:59:59.999Z'])
    expect(w('2026-03-04T15:00:00Z')).toEqual(['2026-03-01', '2026-03-07', '2026-03-01T05:00:00.000Z', '2026-03-08T04:59:59.999Z'])
    // 03:00 EDT on the changeover Sunday is still that Sunday's week
    expect(w('2026-03-08T07:00:00Z')[0]).toBe('2026-03-08')
    // the last second before spring-forward is the Saturday of the week before
    expect(w('2026-03-08T04:59:59Z')[0]).toBe('2026-03-01')
  })
  it('November: the week the clocks fall back is 169 hours, and the week before ends on EDT', () => {
    expect(w('2026-11-03T15:00:00Z')).toEqual(['2026-11-01', '2026-11-07', '2026-11-01T04:00:00.000Z', '2026-11-08T04:59:59.999Z'])
    expect(w('2026-10-28T15:00:00Z')).toEqual(['2026-10-25', '2026-10-31', '2026-10-25T04:00:00.000Z', '2026-11-01T03:59:59.999Z'])
    // 01:30 EST (the second 1:30) on the changeover Sunday is still that Sunday's week
    expect(w('2026-11-01T06:30:00Z')[0]).toBe('2026-11-01')
    // 23:59:59 EDT Saturday is the week before
    expect(w('2026-11-01T03:59:59Z')[0]).toBe('2026-10-25')
  })
  it('the end is the last millisecond before the next week, so adjacent weeks never overlap or leave a gap', () => {
    for (const day of ['2026-03-01', '2026-03-08', '2026-10-25', '2026-11-01']) {
      const a = dashboardWindow(new Date(`${day}T15:00:00Z`), ZONE)
      const b = dashboardWindow(new Date(Date.parse(a.toIso) + 1), ZONE)
      expect(Date.parse(b.fromIso)).toBe(Date.parse(a.toIso) + 1)
    }
  })
  it('a company in another zone gets its own midnight', () => {
    const x = dashboardWindow(new Date('2026-11-11T15:00:00Z'), 'America/Los_Angeles')
    expect([x.fromIso, x.toIso]).toEqual(['2026-11-08T08:00:00.000Z', '2026-11-15T07:59:59.999Z'])
  })
})
