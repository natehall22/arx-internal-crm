import { createFakeDb } from '@/lib/test-helpers/fake-db'
import {
  applyVisitAction,
  bulkShiftVisits,
  createServicePlan,
  ensureServiceVisits,
  loadCrewVisit,
  loadVisits,
  resolveCrewDay,
  rotateCrewDayToken,
  updateServicePlan,
} from '@/lib/service-plans-db'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'

jest.mock('@/lib/cron-orgs', () => ({ loadOrgTimeZone: async () => 'America/New_York' }))

const ORG = 'org-a'
const OTHER = 'org-b'
// Tuesday 2026-11-10, 10:00 in New York.
const NOW = new Date('2026-11-10T15:00:00Z')

function seed(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return createFakeDb({
    orgs: [{ id: ORG, timezone: DEFAULT_TIMEZONE, settings: { servicePlans: { standardTier: { price: 39, billingBasis: 'per_month', maxStories: 3, maxPitchRise: 10 } } } }],
    customers: [{ id: 'c1', org_id: ORG, name: 'Pat' }, { id: 'c2', org_id: OTHER, name: 'Other co' }],
    properties: [
      { id: 'p1', org_id: ORG, customer_id: 'c1', address_text: '1 Oak St, Crawfordville FL', address_line1: '1 Oak St', city: 'Crawfordville', state: 'FL', zip: '32327', active: true, lat: 30.1, lng: -84.3, access_notes: 'Gate 1234' },
      { id: 'p2', org_id: OTHER, customer_id: 'c2', address_text: 'Elsewhere', active: true },
    ],
    org_trades: [{ org_id: ORG, slug: 'lawn', label: 'Lawn care', sort: 1, active: true, match_keywords: [] }],
    sub_contractors: [{ id: 's1', org_id: ORG, company_name: 'Crew One', active: true }, { id: 's2', org_id: ORG, company_name: 'Crew Two', active: true }, { id: 'sx', org_id: OTHER, company_name: 'Not ours', active: true }],
    users: [{ id: 'u1', org_id: ORG, full_name: 'Office', active: true }, { id: 'insp', org_id: ORG, full_name: 'Inspector', active: true }],
    service_plans: [],
    work_orders: [],
    photos: [],
    crew_day_links: [],
    ...extra,
  })
}

const weekly = {
  property_id: 'p1',
  trade: 'lawn',
  name: 'Weekly mowing',
  price: 45,
  billing_basis: 'per_visit',
  start_date: '2026-11-03',
  preferred_weekday: 2,
  default_sub_id: 's1',
  seasons: [{ from: '01-01', to: '12-31', frequency: 'weekly' }],
}

const visitsOf = (db: ReturnType<typeof seed>, planId: string) =>
  (db.tables.work_orders as Array<Record<string, unknown>>).filter((w) => w.service_plan_id === planId).sort((a, b) => String(a.service_planned_date).localeCompare(String(b.service_planned_date)))

describe('ensureServiceVisits — the one generator', () => {
  it('creating a plan fills today through the 6-week horizon, from today on (no past visits)', async () => {
    const db = seed()
    const r = await createServicePlan(db.client, ORG, 'u1', 'c1', weekly, NOW)
    expect(r.ok).toBe(true)
    const planId = (r as { plan: { id: string } }).plan.id
    const v = visitsOf(db, planId)
    expect(v.map((x) => x.service_planned_date)).toEqual(['2026-11-10', '2026-11-17', '2026-11-24', '2026-12-01', '2026-12-08', '2026-12-15'])
    expect(v[0]).toMatchObject({ org_id: ORG, work_order_type: 'service_visit', visit_step: 'service', status: 'scheduled', scheduled_date: '2026-11-10', service_price: 45, service_taxable: false, assigned_sub_id: 's1', trade: 'lawn', property_id: 'p1', customer_id: 'c1', address: '1 Oak St' })
    expect(v[0].job_id ?? null).toBeNull()
  })

  it('is idempotent: running again (or the next morning) never doubles a visit, and only adds the new day', async () => {
    const db = seed()
    const r = await createServicePlan(db.client, ORG, 'u1', 'c1', weekly, NOW)
    const planId = (r as { plan: { id: string } }).plan.id
    expect((await ensureServiceVisits(db.client, ORG, { now: NOW })).created).toBe(0)
    expect(visitsOf(db, planId)).toHaveLength(6)
    const nextWeek = new Date('2026-11-17T15:00:00Z')
    await ensureServiceVisits(db.client, ORG, { now: nextWeek })
    expect(visitsOf(db, planId).map((x) => x.service_planned_date).slice(-1)).toEqual(['2026-12-22'])
    expect(visitsOf(db, planId)).toHaveLength(7)
  })

  it('a moved visit is never put back on its old day', async () => {
    const db = seed()
    const r = await createServicePlan(db.client, ORG, 'u1', 'c1', weekly, NOW)
    const planId = (r as { plan: { id: string } }).plan.id
    expect((await bulkShiftVisits(db.client, ORG, { from: '2026-11-17', to: '2026-11-17', days: 2, subId: 'all' })).moved).toBe(1)
    await ensureServiceVisits(db.client, ORG, { now: NOW })
    const v = visitsOf(db, planId)
    expect(v).toHaveLength(6)
    expect(v.find((x) => x.service_planned_date === '2026-11-17')).toMatchObject({ scheduled_date: '2026-11-19' })
  })

  it('a paused plan with a resume date comes back on that date; an end date that passed ends the plan', async () => {
    const db = seed()
    const r = await createServicePlan(db.client, ORG, 'u1', 'c1', weekly, NOW)
    const planId = (r as { plan: { id: string } }).plan.id
    await updateServicePlan(db.client, ORG, 'u1', planId, {}, { action: 'pause', until: '2026-12-01' }, NOW)
    expect(visitsOf(db, planId).map((x) => x.service_planned_date)).toEqual(['2026-11-10', '2026-12-01', '2026-12-08', '2026-12-15'])
    await ensureServiceVisits(db.client, ORG, { now: new Date('2026-12-01T15:00:00Z') })
    expect((db.tables.service_plans[0] as Record<string, unknown>)).toMatchObject({ status: 'active', paused_until: null })

    await updateServicePlan(db.client, ORG, 'u1', planId, { end_date: '2026-12-08' }, null, new Date('2026-12-01T15:00:00Z'))
    await ensureServiceVisits(db.client, ORG, { now: new Date('2026-12-09T15:00:00Z') })
    expect((db.tables.service_plans[0] as Record<string, unknown>).status).toBe('ended')
    expect(visitsOf(db, planId).every((x) => String(x.service_planned_date) <= '2026-12-08')).toBe(true)
  })
})

describe('editing a plan regenerates future unstarted visits only', () => {
  it('a new weekday replaces the future visits; done, skipped and today’s visits are history', async () => {
    const db = seed()
    const r = await createServicePlan(db.client, ORG, 'u1', 'c1', weekly, NOW)
    const planId = (r as { plan: { id: string } }).plan.id
    const v = visitsOf(db, planId)
    // Today's visit done; next week's skipped for rain; a crew picked by hand on the 24th.
    expect((await applyVisitAction(db.client, ORG, String(v[0].id), { action: 'done' }, { userId: 'u1', subId: null }, { now: NOW })).ok).toBe(true)
    v[1].status = 'skipped'
    v[1].skip_reason = 'rain'
    v[2].assigned_sub_id = 's2'

    const u = await updateServicePlan(db.client, ORG, 'u1', planId, { preferred_weekday: 4, price: 50, default_sub_id: 's2' }, null, NOW)
    expect(u.ok).toBe(true)
    const after = visitsOf(db, planId)
    const byDate = Object.fromEntries(after.map((x) => [x.service_planned_date, x]))
    expect(byDate['2026-11-10']).toMatchObject({ status: 'completed', service_price: 45 }) // history unchanged
    expect(byDate['2026-11-17']).toMatchObject({ status: 'skipped', service_price: 45 })
    expect(byDate['2026-11-24']).toBeUndefined() // old Tuesday slots after today are gone…
    expect(byDate['2026-11-12']).toMatchObject({ status: 'scheduled', service_price: 50, assigned_sub_id: 's2' }) // …Thursdays take their place
    expect(after.filter((x) => weekdayOf(String(x.service_planned_date)) === 4).length).toBeGreaterThan(4)
  })

  it('keeps a future visit that has photos (cancelled, not deleted)', async () => {
    const db = seed()
    const r = await createServicePlan(db.client, ORG, 'u1', 'c1', weekly, NOW)
    const planId = (r as { plan: { id: string } }).plan.id
    const target = visitsOf(db, planId).find((x) => x.service_planned_date === '2026-11-24')!
    db.tables.photos.push({ id: 'ph1', org_id: ORG, work_order_id: target.id, job_id: null, deleted_at: null })
    await updateServicePlan(db.client, ORG, 'u1', planId, { preferred_weekday: 4 }, null, NOW)
    expect(db.tables.work_orders.find((w) => w.id === target.id)).toMatchObject({ status: 'cancelled' })
  })

  it('price tiers: standard takes the company price only for a qualifying home; custom is the override', async () => {
    const db = seed()
    const bad = await createServicePlan(db.client, ORG, 'u1', 'c1', { ...weekly, price_tier: 'standard', stories: 4, pitch_rise: 6 }, NOW)
    expect(bad).toEqual({ ok: false, status: 400, error: expect.stringContaining('stories') })
    const ok = await createServicePlan(db.client, ORG, 'u1', 'c1', { ...weekly, price_tier: 'standard', stories: 2, pitch_rise: 8, price: 1 }, NOW)
    expect(ok.ok && ok.plan).toMatchObject({ price: 39, billing_basis: 'per_month', price_tier: 'standard' })
    // A monthly plan's visits carry no per-visit price.
    const id = (ok as { plan: { id: string } }).plan.id
    expect(visitsOf(db, id)[0].service_price).toBeNull()
  })

  it('refuses another company’s property, crew or customer', async () => {
    const db = seed()
    expect((await createServicePlan(db.client, ORG, 'u1', 'c1', { ...weekly, property_id: 'p2' }, NOW)).ok).toBe(false)
    expect((await createServicePlan(db.client, ORG, 'u1', 'c1', { ...weekly, default_sub_id: 'sx' }, NOW)).ok).toBe(false)
    expect((await createServicePlan(db.client, ORG, 'u1', 'c1', { ...weekly, trade: 'roofing' }, NOW)).ok).toBe(false)
  })
})

describe('visits: skip, done + follow-on inspection, bulk shift', () => {
  it('done on a plan with a follow-on creates one inspection for the inspector, once', async () => {
    const db = seed()
    const r = await createServicePlan(db.client, ORG, 'u1', 'c1', { ...weekly, follow_up: 'inspection', follow_up_days: 1, follow_up_user_id: 'insp' }, NOW)
    const planId = (r as { plan: { id: string } }).plan.id
    const first = visitsOf(db, planId)[0]
    await applyVisitAction(db.client, ORG, String(first.id), { action: 'done' }, { userId: null, subId: 's1' }, { now: NOW })
    const insp = visitsOf(db, planId).filter((x) => x.visit_step === 'inspection')
    expect(insp).toHaveLength(1)
    expect(insp[0]).toMatchObject({ parent_visit_id: first.id, scheduled_date: '2026-11-11', assigned_user_id: 'insp', assigned_sub_id: null, status: 'scheduled' })
    // The inspector needs a result.
    expect(await applyVisitAction(db.client, ORG, String(insp[0].id), { action: 'done' }, { userId: 'insp', subId: null }, { now: NOW })).toMatchObject({ ok: false, status: 400 })
    expect((await applyVisitAction(db.client, ORG, String(insp[0].id), { action: 'done', result: 'green' }, { userId: 'insp', subId: null }, { now: NOW })).ok).toBe(true)
    expect(visitsOf(db, planId).filter((x) => x.visit_step === 'inspection')).toHaveLength(1) // no inspection of an inspection
  })

  it('skip records the reason; a closed visit cannot be skipped again; another company’s visit is not found', async () => {
    const db = seed()
    const r = await createServicePlan(db.client, ORG, 'u1', 'c1', weekly, NOW)
    const v = visitsOf(db, (r as { plan: { id: string } }).plan.id)[0]
    expect((await applyVisitAction(db.client, ORG, String(v.id), { action: 'skip', reason: 'customer' }, { userId: 'u1', subId: null }, { now: NOW })).ok).toBe(true)
    expect(db.tables.work_orders.find((w) => w.id === v.id)).toMatchObject({ status: 'skipped', skip_reason: 'customer' })
    expect((await applyVisitAction(db.client, ORG, String(v.id), { action: 'skip', reason: 'rain' }, { userId: 'u1', subId: null }, { now: NOW })).ok).toBe(false)
    expect(await applyVisitAction(db.client, OTHER, String(v.id), { action: 'done' }, { userId: 'u1', subId: null }, { now: NOW })).toMatchObject({ status: 404 })
  })

  it('bulk shift moves only scheduled visits on those days, for one crew when asked', async () => {
    const db = seed()
    const a = await createServicePlan(db.client, ORG, 'u1', 'c1', weekly, NOW)
    const b = await createServicePlan(db.client, ORG, 'u1', 'c1', { ...weekly, name: 'Hedges', default_sub_id: 's2' }, NOW)
    const aId = (a as { plan: { id: string } }).plan.id
    const bId = (b as { plan: { id: string } }).plan.id
    const done = visitsOf(db, aId).find((x) => x.service_planned_date === '2026-11-17')!
    done.status = 'completed'
    const res = await bulkShiftVisits(db.client, ORG, { from: '2026-11-17', to: '2026-11-24', days: 1, subId: 's2' })
    expect(res.moved).toBe(2)
    expect(visitsOf(db, bId).filter((x) => x.scheduled_date !== x.service_planned_date).map((x) => x.scheduled_date)).toEqual(['2026-11-18', '2026-11-25'])
    expect(visitsOf(db, aId).every((x) => x.scheduled_date === x.service_planned_date)).toBe(true)
  })
})

describe('crew phone link', () => {
  it('rotating replaces the link; the crew sees and acts on only its own visits from yesterday and today', async () => {
    const db = seed()
    const r = await createServicePlan(db.client, ORG, 'u1', 'c1', weekly, NOW)
    const planId = (r as { plan: { id: string } }).plan.id
    const first = await rotateCrewDayToken(db.client, ORG, 's1', 'u1')
    const second = await rotateCrewDayToken(db.client, ORG, 's1', 'u1')
    if (!first.ok || !second.ok) throw new Error('link failed')
    expect(await resolveCrewDay(db.client, first.token)).toBeNull()
    const crew = await resolveCrewDay(db.client, second.token)
    expect(crew).toEqual({ orgId: ORG, subId: 's1', crewName: 'Crew One' })
    expect(db.tables.crew_day_links).toHaveLength(1)

    const v = visitsOf(db, planId)
    expect(await loadCrewVisit(db.client, crew!, String(v[0].id), NOW)).toMatchObject({ id: v[0].id })
    expect(await loadCrewVisit(db.client, crew!, String(v[1].id), NOW)).toBeNull() // next week: not yet
    expect(await rotateCrewDayToken(db.client, ORG, 'sx', 'u1')).toMatchObject({ ok: false, status: 404 })
    expect(await resolveCrewDay(db.client, 'short')).toBeNull()

    const today = await loadVisits(db.client, ORG, { from: '2026-11-10', to: '2026-11-10', subId: 's1', accessNotes: true })
    expect(today).toHaveLength(1)
    expect(today[0]).toMatchObject({ address: '1 Oak St, Crawfordville FL', accessNotes: 'Gate 1234', subName: 'Crew One', step: 'service' })
    const hidden = await loadVisits(db.client, ORG, { from: '2026-11-10', to: '2026-11-10', accessNotes: false })
    expect(hidden[0].accessNotes).toBeNull()
  })
})

function weekdayOf(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay()
}
