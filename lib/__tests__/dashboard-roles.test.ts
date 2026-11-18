import type { OrgFeatures } from '@/lib/org-features'
/** @jest-environment node */
import { DASHBOARD_CARDS, applyDashboardWords, cardsForViewer, dashboardIsEmpty, resolveDashboard, type CardData, type DashboardAudience, type DashboardViewer } from '@/lib/dashboard-cards'
import { DATASETS } from '@/lib/reporting/catalog'
import { datasetOffered } from '@/lib/reporting/run'
import { agingBucketId, planContractValue, plansToRenew } from '@/lib/dashboard-role-loaders'
import { resolveOrgProfile } from '@/lib/org-profile'
import type { ServicePlan } from '@/lib/service-plans'

const lawn = resolveOrgProfile({ profile: { id: 'lawn_landscape', version: 6 } })
const builder = resolveOrgProfile({ profile: { id: 'home_builder', version: 1 } })
const viewer = (audiences: DashboardAudience[], extra: Partial<DashboardViewer> = {}): DashboardViewer => ({ audiences: new Set(audiences), financials: false, ...extra })
const keys = (v: DashboardViewer, p = lawn) => cardsForViewer(resolveDashboard({}, p.dashboard.cards).cards, v, p.features).map((c) => c.card.key)
const cards = (v: DashboardViewer, p = lawn) => cardsForViewer(resolveDashboard({}, p.dashboard.cards).cards, v, p.features).map((c) => c.card)

describe('each role gets cards built for its job', () => {
  it('owner: health and leaks, with the money ones only for reports:financials', () => {
    const noMoney = keys(viewer(['owner']))
    expect(noMoney).toEqual(expect.arrayContaining(['cancellations-month', 'visits-done-week']))
    for (const c of cards(viewer(['owner']))) expect(c.money === 'financials' || c.money === 'books').toBe(false)
    const money = keys(viewer(['owner'], { financials: true, books: true }))
    expect(money).toEqual(expect.arrayContaining(['billed-week', 'collected-week', 'unpaid-overdue', 'revenue-per-crew-hour']))
  })
  it('owner does not get the salesperson’s or crew’s own-day cards', () => {
    const k = keys(viewer(['owner'], { financials: true, books: true }))
    // (my-quotes-out is shared: an owner sees every open quote, a salesperson their own)
    for (const own of ['my-followups', 'my-sales-goal', 'my-day', 'my-visits-left', 'my-hours-today']) expect(k).not.toContain(own)
  })
  it('office: today’s problems, with no money', () => {
    const k = keys(viewer(['office']))
    expect(k).toEqual(expect.arrayContaining(['office-crews-today', 'office-carried-over', 'office-skipped', 'office-unassigned', 'office-callbacks']))
    for (const c of cards(viewer(['office']))) expect(c.money).toBeFalsy()
  })
  it('salesperson: own quotes with money only for their own deals', () => {
    const c = cards(viewer(['sales']))
    expect(c.map((x) => x.key)).toEqual(expect.arrayContaining(['my-quotes-out', 'my-followups', 'won-vs-lost', 'my-sales-goal']))
    for (const x of c) expect(['own', undefined, null]).toContain(x.money ?? undefined)
  })
  it('crew lead and field tech: My day, hours — never money', () => {
    const k = cards(viewer(['crew']))
    expect(k.map((x) => x.key)).toEqual(expect.arrayContaining(['my-day', 'my-visits-left']))
    for (const c of k) expect(c.money).toBeFalsy()
  })
  it('billing: aging, unbilled visits and QuickBooks problems need the books gate', () => {
    expect(keys(viewer(['billing']))).toEqual([])
    const k = keys(viewer(['billing'], { books: true }), { ...lawn, features: { ...lawn.features, quickbooks: true } })
    expect(k).toEqual(expect.arrayContaining(['ar-aging', 'unbilled-visits', 'qb-problems', 'collected-week']))
  })
  it('QuickBooks problems are hidden while the company does not use QuickBooks', () => {
    expect(keys(viewer(['billing'], { books: true }), { ...lawn, features: { ...lawn.features, quickbooks: false } })).not.toContain('qb-problems')
  })
  it('a field role (no audience) gets nothing, even with money flags set', () => {
    expect(keys(viewer([], { financials: false }))).toEqual([])
  })
})

describe('server-side narrowing is in the catalog, not the screen', () => {
  it('a crew-only viewer is offered no money card at all, and no card from another audience', () => {
    for (const c of cards(viewer(['crew']))) {
      expect(c.audience).toContain('crew')
      expect(c.money).toBeFalsy()
    }
  })
  it('the books gate: money:record shows the books cards but not the financials-only ones', () => {
    const k = cards(viewer(['billing'], { books: true }))
    expect(k.some((c) => c.money === 'financials')).toBe(false)
    expect(k.some((c) => c.money === 'books')).toBe(true)
  })
  it('without books or financials no books card is ever offered, whatever the audience', () => {
    for (const a of ['owner', 'office', 'sales', 'crew', 'billing'] as const) {
      for (const c of cards(viewer([a]))) expect(c.money).not.toBe('books')
    }
  })
})

describe('off-season and the empty state', () => {
  it('off-season swaps the weekly cards for renewals, unpaid balances and next season’s plans (owner and office)', () => {
    const inSeason = keys(viewer(['owner', 'office']))
    const off = keys(viewer(['owner', 'office'], { offSeason: true, financials: true, books: true }))
    expect(off).toEqual(expect.arrayContaining(['renewals-open', 'next-season-plans']))
    expect(inSeason).not.toContain('renewals-open')
    expect(off).not.toContain('office-crews-today')
  })
  it('off-season never touches a crew or sales view', () => {
    expect(keys(viewer(['crew'], { offSeason: true }))).toEqual(keys(viewer(['crew'])))
  })
  const tile = (value: number | null, extra: Partial<CardData> = {}) => ({ kind: 'tile', key: 'k', label: 'k', display: 'count', value, goal: null, ...extra }) as CardData
  it('all real zeros and empty lists = a new company', () => {
    expect(dashboardIsEmpty([tile(0), { kind: 'leaderboard', key: 'l', label: 'l', columns: [], rows: [], empty: '', failed: false } as CardData])).toBe(true)
  })
  it('a failed read or a single real number is not empty', () => {
    expect(dashboardIsEmpty([tile(0), tile(null)])).toBe(false)
    expect(dashboardIsEmpty([tile(0), tile(3)])).toBe(false)
    expect(dashboardIsEmpty([])).toBe(false)
  })
})

describe('project companies (grading) get a project dashboard from the same catalog', () => {
  it('owner sees backlog, jobs in progress, cost against estimate and change orders', () => {
    const k = keys(viewer(['owner', 'office'], { financials: true, books: true }), builder)
    expect(k).toEqual(expect.arrayContaining(['projects-backlog', 'projects-active', 'projects-cost-vs-estimate', 'change-orders-month']))
  })
  it('backlog dollars and costs need reports:financials; the count of active projects does not', () => {
    const k = keys(viewer(['owner']), builder)
    expect(k).toContain('projects-active')
    expect(k).not.toContain('projects-backlog')
    expect(k).not.toContain('projects-cost-vs-estimate')
  })
})

const plan = (o: Partial<ServicePlan>): ServicePlan => ({
  id: 'p1', org_id: 'o', customer_id: 'c1', property_id: 'h1', trade: 'lawn', name: 'Mow', description: null, service_lines: [], price: 50, previous_price: null, price_starts_on: null,
  billing_basis: 'per_visit', taxable: false, pricing: {} as never, pricing_inputs: {}, tier_key: null, steps: [], template_id: null, template_version: null, default_sub_id: null, route_position: null,
  created_by: 'u', created_at: '2026-01-01', updated_at: '2026-01-01', status: 'active', start_date: '2026-01-07', end_date: null, paused_until: null,
  seasons: [{ from: '01-01', to: '12-31', frequency: 'weekly' }], preferred_weekday: 3, ...o,
}) as ServicePlan

describe('planContractValue: what a plan bills, from its own schedule', () => {
  it('per visit: each Wednesday in November at the price in effect that day', () => {
    expect(planContractValue(plan({}), '2026-11-01', '2026-11-30')).toEqual({ value: 200, counted: true })
    expect(planContractValue(plan({ previous_price: 40, price_starts_on: '2026-11-15' }), '2026-11-01', '2026-11-30')).toEqual({ value: 180, counted: true })
  })
  it('per month: the plan price once for each month that has a visit', () => {
    expect(planContractValue(plan({ billing_basis: 'per_month', price: 100 }), '2026-11-01', '2027-01-31')).toEqual({ value: 300, counted: true })
  })
  it('per year: the yearly price once', () => {
    expect(planContractValue(plan({ billing_basis: 'per_year', price: 1200 }), '2026-11-01', '2027-10-31')).toEqual({ value: 1200, counted: true })
  })
  it('per hour and unpriced plans are not counted (left out, not guessed)', () => {
    expect(planContractValue(plan({ billing_basis: 'per_hour' }), '2026-11-01', '2026-11-30')).toEqual({ value: 0, counted: false })
    expect(planContractValue(plan({ price: null }), '2026-11-01', '2026-11-30').counted).toBe(false)
  })
  it('an ended or paused plan bills nothing in the window', () => {
    expect(planContractValue(plan({ status: 'ended', end_date: '2026-10-01' }), '2026-11-01', '2026-11-30').value).toBe(0)
  })
})

describe('agingBucketId: company calendar days, either side of a clock change', () => {
  it('no due date or not yet due is current', () => {
    expect(agingBucketId(null, '2026-11-11')).toBe('current')
    expect(agingBucketId('2026-11-11T00:00:00Z', '2026-11-11')).toBe('current')
    expect(agingBucketId('2026-12-01T00:00:00Z', '2026-11-11')).toBe('current')
  })
  it('buckets at 1, 30, 31, 60, 61, 90 and 91 days late', () => {
    const ids = [1, 30, 31, 60, 61, 90, 91].map((n) => {
      const d = new Date(Date.UTC(2026, 10, 11) - n * 86_400_000).toISOString()
      return agingBucketId(d, '2026-11-11')
    })
    expect(ids).toEqual(['d1', 'd1', 'd31', 'd31', 'd61', 'd61', 'd90'])
  })
  it('counts calendar days across the November fall-back (a 25-hour day is still one day)', () => {
    expect(agingBucketId('2026-10-31T00:00:00Z', '2026-11-02')).toBe('d1')
    expect(agingBucketId('2026-11-01T00:00:00Z', '2026-11-02')).toBe('d1')
  })
})

describe('plansToRenew', () => {
  it('lists plans that ended or end within 60 days, earliest first, unless the same home has another active plan', () => {
    const ending = plan({ id: 'a', end_date: '2026-12-15' })
    const ended = plan({ id: 'b', customer_id: 'c2', end_date: '2026-10-01', status: 'ended' })
    const covered = plan({ id: 'c', customer_id: 'c3', property_id: 'h3', end_date: '2026-12-01' })
    const cover = plan({ id: 'd', customer_id: 'c3', property_id: 'h3', end_date: null })
    const far = plan({ id: 'e', customer_id: 'c4', end_date: '2027-06-01' })
    expect(plansToRenew([ending, ended, covered, cover, far], '2026-11-11').map((p) => p.id)).toEqual(['b', 'a'])
  })
})

describe('the catalog has no card without a real source', () => {
  it('the one unavailable card says why', () => {
    const none = DASHBOARD_CARDS.filter((c) => c.source.kind === 'none')
    expect(none.map((c) => c.key)).toEqual(['visit-hours-vs-plan'])
  })
})

describe('review fixes', () => {
  it('the visits and time report views are applied (no longer pending) but still need their features; time is finance-only', () => {
    expect(DATASETS.visits.viewPending).toBeFalsy()
    expect(DATASETS.time.viewPending).toBeFalsy()
    expect(DATASETS.time.financeOnly).toBe(true)
    const off = { servicePlans: false, timeTracking: false } as unknown as OrgFeatures
    const on = { servicePlans: true, timeTracking: true } as unknown as OrgFeatures
    expect(datasetOffered({ features: off }, 'visits')).toBe(false)
    expect(datasetOffered({ features: off }, 'time')).toBe(false)
    expect(datasetOffered({ features: on }, 'visits')).toBe(true)
    expect(datasetOffered({ features: on }, 'time')).toBe(true)
    expect(datasetOffered({ features: undefined }, 'revenue')).toBe(true)
  })
  it('hours that add up everyone’s clocked time are called person-hours', () => {
    const labels = DASHBOARD_CARDS.filter((c) => ['revenue-per-crew-hour', 'my-hours-today'].includes(c.key)).map((c) => c.label)
    expect(labels).toEqual(['Revenue per person-hour', 'Person-hours today'])
  })
  it('a builder’s own word for a job replaces the whole word in the card’s words only', () => {
    const tile = { kind: 'tile', key: 'k', label: 'Jobs in progress', display: 'count', value: 2, goal: null, sub: 'of 3 jobs' } as CardData
    const list = { kind: 'list', key: 'l', label: 'Visits', count: 1, empty: 'No job today.', failed: false, rows: [{ id: '1', title: 'Fix the job-site gate', detail: 'job notes' }] } as CardData
    const [a, b] = applyDashboardWords([tile, list], { job: 'Project', jobs: 'Projects' }) as Array<{ label: string; sub?: string; empty?: string; rows?: Array<{ title: string; detail: string }> }>
    expect([a.label, a.sub, b.empty]).toEqual(['Projects in progress', 'of 3 projects', 'No project today.'])
    expect(b.rows![0]).toEqual({ id: '1', title: 'Fix the job-site gate', detail: 'job notes' })
    expect(applyDashboardWords([tile], { job: 'Job', jobs: 'Jobs' })[0]).toBe(tile)
  })
  it('the billing-only viewer does not also get the salesperson view', () => {
    expect(keys(viewer(['billing'], { books: true }))).not.toContain('my-quotes-out')
  })
})
