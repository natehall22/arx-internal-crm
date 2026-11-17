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
const loadCrewsLedBy = jest.fn(async (..._a: unknown[]): Promise<Array<{ subId: string }>> => [])
const loadTimeWeek = jest.fn(async (..._a: unknown[]): Promise<unknown> => ({ ready: true, people: [] }))
jest.mock('@/lib/time-tracking-db', () => ({ loadCrewsLedBy: (...a: unknown[]) => loadCrewsLedBy(...a), loadTimeWeek: (...a: unknown[]) => loadTimeWeek(...a) }))
const runReport = jest.fn()
const buildReportContext = jest.fn(async () => ({ orgId: 'o1', userId: 'u', scope: 'all', finance: true, canExport: true, scopedUserIds: null }))
jest.mock('@/lib/reporting/run', () => {
  const actual = jest.requireActual('@/lib/reporting/run')
  return { ...actual, runReport: (...a: unknown[]) => runReport(...a), buildReportContext: (...a: unknown[]) => (buildReportContext as jest.Mock)(...a) }
})
const loadVisits = jest.fn(async (..._a: unknown[]): Promise<unknown[]> => [])
const loadServicePlans = jest.fn(async (..._a: unknown[]): Promise<unknown> => ({ ready: true, plans: [] }))
jest.mock('@/lib/service-plans-db', () => ({ loadVisits: (...a: unknown[]) => loadVisits(...a), loadServicePlans: (...a: unknown[]) => loadServicePlans(...a) }))
const loadUnpaidInvoices = jest.fn(async (..._a: unknown[]): Promise<unknown> => ({ rows: [], capped: false }))
jest.mock('@/lib/service-billing-db', () => ({ loadUnpaidInvoices: (...a: unknown[]) => loadUnpaidInvoices(...a) }))
jest.mock('@/lib/cron-orgs', () => ({ loadOrgTimeZone: async () => 'UTC' }))

import { DASHBOARD_CARDS, cardsForViewer, resolveDashboard, type CardData, type DashboardAudience, type LeaderboardData, type TileData } from '@/lib/dashboard-cards'
import { loadDashboardCardData, resolveDashboardViewer, saveDashboardCards, type DashboardViewerInfo } from '@/lib/dashboard-cards-server'
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
  loadCrewsLedBy.mockResolvedValue([])
  buildReportContext.mockResolvedValue({ orgId: 'o1', userId: 'u1', scope: 'all', finance: true, canExport: true, scopedUserIds: null })
})

describe('saveDashboardCards: the one writer', () => {
  it('saves a valid list at path [dashboardCards]', async () => {
    const r = await saveDashboardCards(admin, 'o1', { cards: [{ key: 'win-rate' }, { key: 'billed-week', goal: 5000 }] }, lawn.features)
    expect(r.ok).toBe(true)
    expect(mergeOrgSettings).toHaveBeenCalledWith(admin, 'o1', { cards: [{ key: 'win-rate', goal: null }, { key: 'billed-week', goal: 5000 }] }, { path: ['dashboardCards'] })
  })
  it('writes nothing for a key outside the catalog, a card with no source or a feature that is off', async () => {
    for (const cards of [[{ key: 'doors-knocked' }], [{ key: 'mrr' }], [{ key: 'classic-quick-stats' }, { key: 'win-rate' }]]) {
      const r = await saveDashboardCards(admin, 'o1', { cards }, lawn.features)
      expect(r).toMatchObject({ ok: false, status: 400 })
    }
    expect((await saveDashboardCards(admin, 'o1', { cards: [{ key: 'crews' }] }, { ...DEFAULT_ORG_FEATURES, servicePlans: false })).ok).toBe(false)
    expect(mergeOrgSettings).not.toHaveBeenCalled()
  })
  it('reset removes the stored list so the profile’s starting set applies', async () => {
    expect(await saveDashboardCards(admin, 'o1', null, lawn.features, { reset: true })).toEqual({ ok: true, cards: null })
    expect(mergeOrgSettings).toHaveBeenCalledWith(admin, 'o1', {}, { path: ['dashboardCards'], remove: ['cards'] })
    // …and what is left resolves to the starting set
    expect(resolveDashboard({ dashboardCards: {} }, lawn.dashboard.cards).custom).toBe(false)
  })
  it('a failed write is a 500, never "saved"', async () => {
    mergeOrgSettings.mockResolvedValueOnce({ error: 'boom' })
    expect(await saveDashboardCards(admin, 'o1', { cards: [{ key: 'win-rate' }] }, lawn.features)).toMatchObject({ ok: false, status: 500 })
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
  it('a salesperson is sales; office staff on the job board are crew', async () => {
    expect(Array.from((await resolveDashboardViewer(admin, profile('sales_rep'))).audiences)).toEqual(['sales'])
    resolveOpsAccess.mockResolvedValue({ canJobBoard: true })
    expect(Array.from((await resolveDashboardViewer(admin, profile('operations'))).audiences)).toEqual(['crew'])
  })
  it('a crew lead in a custom role is crew only, narrowed to the crews they lead', async () => {
    loadCrewsLedBy.mockResolvedValue([{ subId: 'crew-a' }])
    const v = await resolveDashboardViewer(admin, profile('crew_lead'))
    expect([Array.from(v.audiences), v.ledSubIds]).toEqual([['crew'], ['crew-a']])
  })
})

const owner: DashboardViewerInfo = { userId: 'u1', audiences: new Set<DashboardAudience>(['owner']), financials: true, ledSubIds: null }
const visit = (id: string, status: string, subId: string, extra: Record<string, unknown> = {}) => ({ id, status, subId, subName: subId.toUpperCase(), moved: false, skipReason: null, ...extra })
const cardsFor = (viewer: DashboardViewerInfo, features = lawn.features) => cardsForViewer(resolveDashboard({}, lawn.dashboard.cards).cards, viewer, features)
const byKey = (out: CardData[], key: string) => out.find((c) => c.key === key)

describe('the numbers come from the existing sources', () => {
  it('billed this week: the report runner, Sunday through today in the company’s day', async () => {
    runReport.mockResolvedValue({ summary: { value: 4200 }, rows: [], scanned: 3 })
    const out = await loadDashboardCardData(admin, { profile: profile('admin'), viewer: owner, cards: cardsFor(owner), features: lawn.features, now: NOW })
    expect((byKey(out, 'billed-week') as TileData).value).toBe(4200)
    const call = runReport.mock.calls.find(([, , spec]) => spec.dataset === 'revenue' && spec.metric.column === 'billed')!
    expect(call[2].date).toEqual({ preset: 'custom', start: '2026-11-08', end: '2026-11-11' })
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
    expect(out.map((c) => c.key)).toEqual(['visits-done-week', 'visits-skipped-week', 'visits-moved-week', 'crews'])
    const crews = byKey(out, 'crews') as LeaderboardData
    expect(crews.rows.map((r) => r.name)).toEqual(['A'])
    expect(crews.columns.map((c) => c.format)).not.toContain('money')
    expect(crews.columns.map((c) => c.label)).not.toEqual(expect.arrayContaining([expect.stringMatching(/revenue|dollar|\$/i)]))
    expect(runReport).not.toHaveBeenCalled()
    expect(loadUnpaidInvoices).not.toHaveBeenCalled()
  })

  it('crew hours come from the time week’s work entries on that crew’s visits (only with the time clock on)', async () => {
    loadVisits.mockResolvedValue([visit('v1', 'completed', 'a'), visit('v2', 'completed', 'b')])
    loadTimeWeek.mockResolvedValue({
      ready: true,
      people: [{ entries: [
        { kind: 'work', workOrderId: 'v1', startedAt: '2026-11-10T13:00:00Z', endedAt: '2026-11-10T15:30:00Z' },
        { kind: 'break', workOrderId: 'v1', startedAt: '2026-11-10T14:00:00Z', endedAt: '2026-11-10T14:30:00Z' },
        { kind: 'work', workOrderId: 'other', startedAt: '2026-11-10T13:00:00Z', endedAt: '2026-11-10T15:00:00Z' },
      ] }],
    })
    const features = { ...lawn.features, timeTracking: true }
    const out = await loadDashboardCardData(admin, { profile: profile('admin'), viewer: owner, cards: cardsFor(owner, features), features, now: NOW })
    const crews = byKey(out, 'crews') as LeaderboardData
    expect(crews.columns.map((c) => c.key)).toEqual(['done', 'hours', 'skips'])
    expect(crews.rows.find((r) => r.id === 'a')!.values).toEqual([1, 2.5, 0])
    expect(crews.rows.find((r) => r.id === 'b')!.values).toEqual([1, 0, 0])
  })

  it('a salesperson’s report is narrowed to their own deals; a report the runner refuses is not drawn', async () => {
    const rep: DashboardViewerInfo = { userId: 'u7', audiences: new Set<DashboardAudience>(['sales']), financials: false, ledSubIds: null }
    runReport.mockImplementation(async (_a: unknown, ctx: { scope: string }, spec: { groupBy?: string }) => {
      if (spec.groupBy === 'closer') throw new ReportAccessError('nope')
      return { summary: { value: 2 }, rows: [{ group: 'Total', value: 40 }], scanned: 2, ctx }
    })
    const out = await loadDashboardCardData(admin, { profile: profile('sales_rep'), viewer: rep, cards: cardsFor(rep), features: lawn.features, now: NOW })
    for (const [, ctx] of runReport.mock.calls) expect([ctx.scope, ctx.scopedUserIds]).toEqual(['own', ['u7']])
    expect(out.map((c) => c.key)).toEqual(['quotes-won-week', 'win-rate', 'dollars-sold-week'])
  })

  it('every drawn card of the starting set is one of the catalog’s', () => {
    for (const { card } of cardsFor(owner)) expect(DASHBOARD_CARDS).toContain(card)
  })
})
