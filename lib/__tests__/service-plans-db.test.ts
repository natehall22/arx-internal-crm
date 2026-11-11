import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { fakeServicePlanRpc } from '@/lib/test-helpers/fake-service-plan-rpc'
import {
  applyTemplateToPlans,
  applyVisitAction,
  bulkShiftVisits,
  createCustomerWithPlan,
  createServicePlan,
  loadChangeHistory,
  saveTemplate,
  ensureServiceVisits,
  loadCrewVisit,
  loadVisits,
  loadVisitsPage,
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
    orgs: [{ id: ORG, timezone: DEFAULT_TIMEZONE, settings: {} }],
    customers: [{ id: 'c1', org_id: ORG, name: 'Pat' }, { id: 'c2', org_id: OTHER, name: 'Other co' }],
    properties: [
      { id: 'p1', org_id: ORG, customer_id: 'c1', address_text: '1 Oak St, Crawfordville FL', address_line1: '1 Oak St', city: 'Crawfordville', state: 'FL', zip: '32327', active: true, lat: 30.1, lng: -84.3, access_notes: 'Gate 1234' },
      { id: 'p2', org_id: OTHER, customer_id: 'c2', address_text: 'Elsewhere', active: true },
    ],
    org_trades: [{ org_id: ORG, slug: 'lawn', label: 'Lawn care', sort: 1, active: true, match_keywords: [] }, { org_id: ORG, slug: 'gutters', label: 'Gutters', sort: 2, active: true, match_keywords: [] }],
    sub_contractors: [{ id: 's1', org_id: ORG, company_name: 'Crew One', active: true }, { id: 's2', org_id: ORG, company_name: 'Crew Two', active: true }, { id: 'sx', org_id: OTHER, company_name: 'Not ours', active: true }],
    users: [{ id: 'u1', org_id: ORG, full_name: 'Office', active: true }, { id: 'insp', org_id: ORG, full_name: 'Inspector', active: true }],
    service_plans: [],
    work_orders: [],
    photos: [],
    crew_day_links: [],
    service_plan_templates: [],
    service_plan_changes: [],
    service_visit_charges: [],
    ...extra,
  }, { rpc: fakeServicePlanRpc })
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

const chargeOf = (db: ReturnType<typeof seed>, id: string) => {
  const c = (db.tables.service_visit_charges as Array<Record<string, unknown>>).find((x) => x.work_order_id === id)
  return c ? { price: c.price, taxable: c.taxable } : null
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
    expect(v[0]).toMatchObject({ org_id: ORG, work_order_type: 'service_visit', visit_step: 'service', status: 'scheduled', scheduled_date: '2026-11-10', assigned_sub_id: 's1', trade: 'lawn', property_id: 'p1', customer_id: 'c1', address: '1 Oak St' })
    // The price snapshot lives beside the visit (service role only), never on work_orders.
    expect(v[0].service_price).toBeUndefined()
    expect(chargeOf(db, String(v[0].id))).toEqual({ price: 45, taxable: false })
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
    expect(byDate['2026-11-10']).toMatchObject({ status: 'completed' }) // history unchanged
    expect(chargeOf(db, String(byDate['2026-11-10'].id))?.price).toBe(45)
    expect(byDate['2026-11-17']).toMatchObject({ status: 'skipped' })
    expect(chargeOf(db, String(byDate['2026-11-17'].id))?.price).toBe(45)
    expect(byDate['2026-11-24']).toBeUndefined() // old Tuesday slots after today are gone…
    expect(byDate['2026-11-12']).toMatchObject({ status: 'scheduled', assigned_sub_id: 's2' }) // …Thursdays take their place
    expect(chargeOf(db, String(byDate['2026-11-12'].id))?.price).toBe(50)
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

  it('price tiers come from the plan’s own rules: a tier only for a qualifying home; custom is the override', async () => {
    const db = seed()
    const pricing = { fields: [{ key: 'stories', label: 'Stories' }, { key: 'pitch', label: 'Pitch' }], tiers: [{ key: 'standard', label: 'Standard', price: 39, billingBasis: 'per_month', conditions: [{ field: 'stories', op: 'lte', value: 3 }, { field: 'pitch', op: 'lte', value: 10 }] }], allowCustom: true }
    const bad = await createServicePlan(db.client, ORG, 'u1', 'c1', { ...weekly, pricing, tier_key: 'standard', pricing_inputs: { stories: 4, pitch: 6 } }, NOW)
    expect(bad).toEqual({ ok: false, status: 400, error: expect.stringContaining('Stories') })
    const ok = await createServicePlan(db.client, ORG, 'u1', 'c1', { ...weekly, pricing, tier_key: 'standard', pricing_inputs: { stories: 2, pitch: 8 }, price: 1 }, NOW)
    expect(ok.ok && ok.plan).toMatchObject({ price: 39, billing_basis: 'per_month', tier_key: 'standard' })
    // A monthly plan's visits carry no per-visit price.
    const id = (ok as { plan: { id: string } }).plan.id
    expect(chargeOf(db, String(visitsOf(db, id)[0].id))?.price).toBeNull()
  })

  it('refuses another company’s property, crew or customer', async () => {
    const db = seed()
    expect((await createServicePlan(db.client, ORG, 'u1', 'c1', { ...weekly, property_id: 'p2' }, NOW)).ok).toBe(false)
    expect((await createServicePlan(db.client, ORG, 'u1', 'c1', { ...weekly, default_sub_id: 'sx' }, NOW)).ok).toBe(false)
    expect((await createServicePlan(db.client, ORG, 'u1', 'c1', { ...weekly, trade: 'roofing' }, NOW)).ok).toBe(false)
  })
})

describe('visits: skip, done + follow-on inspection, bulk shift', () => {
  it('done on a plan with a follow-on step creates one step visit for its person, once', async () => {
    const db = seed()
    const steps = [{ key: 'inspection', label: 'Roof inspection', daysAfter: 1, assignTo: 'person', userId: 'insp', results: [{ key: 'green', label: 'Green', tone: 'good' }, { key: 'yellow', label: 'Yellow', tone: 'watch' }, { key: 'red', label: 'Red', tone: 'bad' }] }]
    const r = await createServicePlan(db.client, ORG, 'u1', 'c1', { ...weekly, steps }, NOW)
    const planId = (r as { plan: { id: string } }).plan.id
    const first = visitsOf(db, planId)[0]
    await applyVisitAction(db.client, ORG, String(first.id), { action: 'done' }, { userId: null, subId: 's1' }, { now: NOW })
    const insp = visitsOf(db, planId).filter((x) => x.visit_step === 'inspection')
    expect(insp).toHaveLength(1)
    expect(insp[0]).toMatchObject({ parent_visit_id: first.id, scheduled_date: '2026-11-11', assigned_user_id: 'insp', assigned_sub_id: null, status: 'scheduled' })
    // The inspector needs a result.
    expect(await applyVisitAction(db.client, ORG, String(insp[0].id), { action: 'done' }, { userId: 'insp', subId: null }, { now: NOW })).toMatchObject({ ok: false, status: 400 })
    expect(await applyVisitAction(db.client, ORG, String(insp[0].id), { action: 'done', result: 'purple' }, { userId: 'insp', subId: null }, { now: NOW })).toMatchObject({ ok: false, status: 400 })
    expect((await applyVisitAction(db.client, ORG, String(insp[0].id), { action: 'done', result: 'green' }, { userId: 'insp', subId: null }, { now: NOW })).ok).toBe(true)
    expect(db.tables.work_orders.find((w) => w.id === insp[0].id)).toMatchObject({ status: 'completed', step_result: 'green', title: 'Weekly mowing — Roof inspection' })
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

describe('templates: copied at sale, never change a sold plan, pushed on purpose with a preview', () => {
  const tmpl = {
    name: 'Roof & gutter care',
    trade: 'gutters',
    seasons: [{ from: '01-01', to: '12-31', frequency: 'weekly' }],
    billing_basis: 'per_month',
    taxable: true,
    pricing: { fields: [{ key: 'stories', label: 'Stories' }], tiers: [{ key: 'standard', label: 'Standard', price: 39, billingBasis: 'per_month', conditions: [{ field: 'stories', op: 'lte', value: 3 }] }], allowCustom: true },
    steps: [{ key: 'inspection', label: 'Roof inspection', daysAfter: 2, assignTo: 'person', userId: 'insp', results: [{ key: 'ok', label: 'OK', tone: 'good' }] }],
  }

  it('a plan copies the template; editing the template bumps its version and leaves the plan alone; push previews then applies', async () => {
    const db = seed()
    const t = await saveTemplate(db.client, ORG, 'u1', null, tmpl)
    if (!t.ok) throw new Error(t.error)
    const sold = await createServicePlan(db.client, ORG, 'u1', 'c1', { template_id: t.template.id, property_id: 'p1', start_date: '2026-11-03', preferred_weekday: 2, tier_key: 'standard', pricing_inputs: { stories: 2 } }, NOW)
    if (!sold.ok) throw new Error(sold.error)
    expect(sold.plan).toMatchObject({ name: 'Roof & gutter care', trade: 'gutters', taxable: true, price: 39, template_id: t.template.id, template_version: 1 })
    expect(sold.plan.steps[0].label).toBe('Roof inspection')

    // Owner raises the price and changes the schedule on the template.
    const edited = await saveTemplate(db.client, ORG, 'u1', t.template.id, { pricing: { ...tmpl.pricing, tiers: [{ ...tmpl.pricing.tiers[0], price: 45 }] }, seasons: [{ from: '01-01', to: '12-31', frequency: 'every_2_weeks' }] })
    if (!edited.ok) throw new Error(edited.error)
    expect(edited.template.version).toBe(2)
    const before = visitsOf(db, sold.plan.id).map((v) => ({ ...v }))
    expect((db.tables.service_plans[0] as Record<string, unknown>).price).toBe(39) // sold plan untouched

    const preview = await applyTemplateToPlans(db.client, ORG, 'u1', t.template.id, { preview: true, now: NOW })
    if (!preview.ok) throw new Error(preview.error)
    expect(preview.plans).toBe(1)
    expect(preview.effect.removed).toBeGreaterThan(0)
    expect(visitsOf(db, sold.plan.id)).toEqual(before) // preview wrote nothing

    const applied = await applyTemplateToPlans(db.client, ORG, 'u1', t.template.id, { preview: false, now: NOW })
    if (!applied.ok) throw new Error(applied.error)
    expect(applied.effect).toEqual(preview.effect)
    expect(db.tables.service_plans[0]).toMatchObject({ price: 45, template_version: 2 })
    // History: plan created + template applied; template created + updated.
    const planHistory = await loadChangeHistory(db.client, ORG, { planId: sold.plan.id })
    expect(planHistory.map((h) => h.action).sort()).toEqual(['created', 'template_applied'])
    expect(planHistory.find((h) => h.action === 'template_applied')?.lines.join(' ')).toContain('Price: 39 → 45')
    expect((await loadChangeHistory(db.client, ORG, { templateId: t.template.id })).map((h) => h.action).sort()).toEqual(['created', 'updated'])
    // Nothing behind any more: a second push touches nothing.
    const again = await applyTemplateToPlans(db.client, ORG, 'u1', t.template.id, { preview: true, now: NOW })
    expect(again.ok && again.plans).toBe(0)
  })

  it('a push that drops the plan’s tier keeps its price as custom and says so', async () => {
    const db = seed()
    const t = await saveTemplate(db.client, ORG, 'u1', null, tmpl)
    if (!t.ok) throw new Error(t.error)
    await createServicePlan(db.client, ORG, 'u1', 'c1', { template_id: t.template.id, property_id: 'p1', start_date: '2026-11-03', tier_key: 'standard', pricing_inputs: { stories: 3 } }, NOW)
    await saveTemplate(db.client, ORG, 'u1', t.template.id, { pricing: { ...tmpl.pricing, tiers: [{ ...tmpl.pricing.tiers[0], conditions: [{ field: 'stories', op: 'lte', value: 2 }] }] } })
    const r = await applyTemplateToPlans(db.client, ORG, 'u1', t.template.id, { preview: false, now: NOW })
    expect(r.ok && r.needsPriceCheck).toEqual(['Roof & gutter care'])
    expect(db.tables.service_plans[0]).toMatchObject({ price: 39, tier_key: null })
  })

  it('templates refuse another company’s crew / person and unknown trades', async () => {
    const db = seed()
    expect((await saveTemplate(db.client, ORG, 'u1', null, { ...tmpl, trade: 'pool' })).ok).toBe(false)
    expect((await saveTemplate(db.client, ORG, 'u1', null, { ...tmpl, steps: [{ ...tmpl.steps[0], userId: 'nobody' }] })).ok).toBe(false)
  })
})

describe('plan edits: preview first, future only, history kept', () => {
  it('preview writes nothing; save changes property / crew / steps for future visits only and records who and what', async () => {
    const db = seed({ properties: [] })
    db.tables.properties.push(
      { id: 'p1', org_id: ORG, customer_id: 'c1', address_text: '1 Oak St', active: true },
      { id: 'p3', org_id: ORG, customer_id: 'c1', address_text: '9 Elm St', address_line1: '9 Elm St', active: true }
    )
    const r = await createServicePlan(db.client, ORG, 'u1', 'c1', weekly, NOW)
    if (!r.ok) throw new Error(r.error)
    const id = r.plan.id
    const todays = visitsOf(db, id)[0]
    const snapshot = JSON.stringify(db.tables.work_orders)

    const pv = await updateServicePlan(db.client, ORG, 'u1', id, { property_id: 'p3', default_sub_id: 's2', price: 50, preview: true }, null, NOW)
    expect(pv).toMatchObject({ ok: true, preview: true, effect: { removed: 0, added: 0, updated: 5 } })
    expect(JSON.stringify(db.tables.work_orders)).toBe(snapshot)
    expect(db.tables.service_plan_changes.filter((c) => c.action === 'updated')).toHaveLength(0)

    const saved = await updateServicePlan(db.client, ORG, 'u1', id, { property_id: 'p3', default_sub_id: 's2', price: 50 }, null, NOW)
    expect(saved).toMatchObject({ ok: true, effect: { removed: 0, added: 0, updated: 5 } })
    const after = visitsOf(db, id)
    expect(after[0]).toMatchObject({ id: todays.id, property_id: 'p1', assigned_sub_id: 's1' }) // today unchanged
    expect(chargeOf(db, String(todays.id))?.price).toBe(45)
    expect(after.slice(1).every((v) => v.property_id === 'p3' && chargeOf(db, String(v.id))?.price === 50 && v.assigned_sub_id === 's2' && v.address === '9 Elm St')).toBe(true)
    const h = await loadChangeHistory(db.client, ORG, { planId: id })
    const upd = h.find((x) => x.action === 'updated')!
    expect(upd.by).toBe('Office')
    expect(upd.lines).toEqual(expect.arrayContaining(['Property: 1 Oak St → 9 Elm St', 'Crew: Crew One → Crew Two', 'Price: 45 → 50']))
    expect(upd.effect).toEqual({ removed: 0, added: 0, updated: 5 })
    // Saving the same values again changes nothing and says so.
    expect(await updateServicePlan(db.client, ORG, 'u1', id, { price: 50 }, null, NOW)).toMatchObject({ ok: false, error: 'Nothing changed' })
  })

  it('pause shows its effect before saving and is in the history', async () => {
    const db = seed()
    const r = await createServicePlan(db.client, ORG, 'u1', 'c1', weekly, NOW)
    if (!r.ok) throw new Error(r.error)
    const pv = await updateServicePlan(db.client, ORG, 'u1', r.plan.id, { preview: true }, { action: 'pause', until: null }, NOW)
    expect(pv).toMatchObject({ ok: true, preview: true, effect: { removed: 5, added: 0 } })
    await updateServicePlan(db.client, ORG, 'u1', r.plan.id, {}, { action: 'pause', until: null }, NOW)
    expect((await loadChangeHistory(db.client, ORG, { planId: r.plan.id })).map((x) => x.action)).toContain('paused')
  })
})

describe('crew link expiry', () => {
  it('an expired link is dead before anyone replaces it', async () => {
    const db = seed()
    const link = await rotateCrewDayToken(db.client, ORG, 's1', 'u1')
    if (!link.ok) throw new Error('link')
    expect(link.expiresInDays).toBe(30)
    expect(await resolveCrewDay(db.client, link.token)).not.toBeNull()
    expect(await resolveCrewDay(db.client, link.token, new Date(Date.now() + 31 * 86_400_000))).toBeNull()
    db.tables.crew_day_links[0].expires_at = new Date(Date.now() - 1000).toISOString()
    expect(await resolveCrewDay(db.client, link.token)).toBeNull()
  })
})

describe('review fixes', () => {
  it('a trade change reaches upcoming visits (and the preview counts them)', async () => {
    const db = seed()
    const r = await createServicePlan(db.client, ORG, 'u1', 'c1', weekly, NOW)
    if (!r.ok) throw new Error(r.error)
    const pv = await updateServicePlan(db.client, ORG, 'u1', r.plan.id, { trade: 'gutters', preview: true }, null, NOW)
    expect(pv).toMatchObject({ ok: true, effect: { updated: 5 } })
    await updateServicePlan(db.client, ORG, 'u1', r.plan.id, { trade: 'gutters' }, null, NOW)
    const v = visitsOf(db, r.plan.id)
    expect(v[0].trade).toBe('lawn') // today's visit is history
    expect(v.slice(1).every((x) => x.trade === 'gutters')).toBe(true)
  })

  it('re-ordered seasons (or jsonb key order) are not a change: no history line, "Nothing changed"', async () => {
    const db = seed()
    const seasons = [{ from: '04-01', to: '10-31', frequency: 'weekly' }, { from: '01-01', to: '03-31', frequency: 'monthly' }, { from: '11-01', to: '12-31', frequency: 'monthly' }]
    const r = await createServicePlan(db.client, ORG, 'u1', 'c1', { ...weekly, seasons }, NOW)
    if (!r.ok) throw new Error(r.error)
    // Stored jsonb comes back with its keys in another order.
    const row = db.tables.service_plans[0] as Record<string, unknown>
    row.seasons = (row.seasons as Array<Record<string, unknown>>).map((x) => ({ frequency: x.frequency, to: x.to, from: x.from }))
    const again = await updateServicePlan(db.client, ORG, 'u1', r.plan.id, { seasons: [...seasons].reverse() }, null, NOW)
    expect(again).toMatchObject({ ok: false, error: 'Nothing changed' })
    const pv = await updateServicePlan(db.client, ORG, 'u1', r.plan.id, { seasons, preview: true }, null, NOW)
    expect(pv).toMatchObject({ ok: true, changes: [], effect: { removed: 0, added: 0, updated: 0 } })
  })

  it('the generator refuses slots planned from a plan version a save has since replaced', async () => {
    const db = seed()
    const r = await createServicePlan(db.client, ORG, 'u1', 'c1', weekly, NOW)
    if (!r.ok) throw new Error(r.error)
    // (fake inserts carry no column defaults: give the row the version a board load would have read)
    ;(db.tables.service_plans[0] as Record<string, unknown>).updated_at = 'v1'
    const stale = 'v1'
    await updateServicePlan(db.client, ORG, 'u1', r.plan.id, { preferred_weekday: 4 }, null, NOW)
    const before = visitsOf(db, r.plan.id).length
    const { data } = await (db.client as unknown as { rpc: (n: string, a: unknown) => Promise<{ data: unknown }> }).rpc('service_plan_add_visits', {
      p_org_id: ORG,
      p_plan_id: r.plan.id,
      p_plan_updated_at: stale,
      p_rows: [{ visit_step: 'service', service_planned_date: '2026-11-24', scheduled_date: '2026-11-24' }],
    })
    expect(data).toBe(-1)
    expect(visitsOf(db, r.plan.id)).toHaveLength(before)
  })

  it('a save that lost the race to another save is refused (409), nothing half-written', async () => {
    const db = seed()
    const r = await createServicePlan(db.client, ORG, 'u1', 'c1', weekly, NOW)
    if (!r.ok) throw new Error(r.error)
    ;(db.tables.service_plans[0] as Record<string, unknown>).updated_at = 'v1'
    await updateServicePlan(db.client, ORG, 'u1', r.plan.id, { price: 50 }, null, NOW)
    const snapshot = JSON.stringify(db.tables.work_orders)
    const late = await updateServicePlan(db.client, ORG, 'u1', r.plan.id, { preferred_weekday: 4, expectedUpdatedAt: 'v1' }, null, NOW)
    expect(late).toMatchObject({ ok: false, status: 409 })
    expect(JSON.stringify(db.tables.work_orders)).toBe(snapshot)
  })

  it('a template push updates the plans it can and lists the one it could not', async () => {
    const db = seed()
    const t = await saveTemplate(db.client, ORG, 'u1', null, { name: 'Lawn', trade: 'lawn', seasons: [{ from: '01-01', to: '12-31', frequency: 'weekly' }], billing_basis: 'per_visit', pricing: { fields: [], tiers: [], allowCustom: true }, steps: [] })
    if (!t.ok) throw new Error(t.error)
    const a = await createServicePlan(db.client, ORG, 'u1', 'c1', { template_id: t.template.id, property_id: 'p1', start_date: '2026-11-03', price: 40 }, NOW)
    const b = await createServicePlan(db.client, ORG, 'u1', 'c1', { template_id: t.template.id, property_id: 'p1', start_date: '2026-11-03', price: 40, name: 'Second' }, NOW)
    if (!a.ok || !b.ok) throw new Error('setup')
    await saveTemplate(db.client, ORG, 'u1', t.template.id, { seasons: [{ from: '01-01', to: '12-31', frequency: 'every_2_weeks' }] })
    const real = fakeServicePlanRpc.service_plan_save
    const spy = jest.spyOn(fakeServicePlanRpc, 'service_plan_save').mockImplementation((args, tables) => {
      if (args.p_plan_id === b.plan.id) throw Object.assign(new Error('boom'), { code: 'XX000' })
      return real(args, tables)
    })
    const r = await applyTemplateToPlans(db.client, ORG, 'u1', t.template.id, { preview: false, now: NOW })
    spy.mockRestore()
    if (!r.ok) throw new Error(r.error)
    expect(r.plans).toBe(1)
    expect(r.failed).toEqual([{ planId: b.plan.id, name: 'Second', error: 'Could not save the plan' }])
    expect(r.summary).toContain('1 can’t be updated: Second')
    expect((db.tables.service_plans as Array<Record<string, unknown>>).find((p) => p.id === a.plan.id)?.template_version).toBe(2)
    expect((db.tables.service_plans as Array<Record<string, unknown>>).find((p) => p.id === b.plan.id)?.template_version).toBe(1)
  })

  it('"new price starts on" keeps today’s price before that day — on visits made now and made later', async () => {
    const db = seed()
    const r = await createServicePlan(db.client, ORG, 'u1', 'c1', weekly, NOW)
    if (!r.ok) throw new Error(r.error)
    const pv = await updateServicePlan(db.client, ORG, 'u1', r.plan.id, { price: 50, price_starts_on: '2026-12-01', preview: true }, null, NOW)
    expect(pv).toMatchObject({ ok: true, effect: { updated: 3 } })
    const saved = await updateServicePlan(db.client, ORG, 'u1', r.plan.id, { price: 50, price_starts_on: '2026-12-01' }, null, NOW)
    if (!saved.ok || !('plan' in saved)) throw new Error('save')
    expect(saved.plan).toMatchObject({ price: 50, previous_price: 45, price_starts_on: '2026-12-01' })
    const priceOn = (ymd: string) => chargeOf(db, String(visitsOf(db, r.plan.id).find((v) => v.service_planned_date === ymd)?.id))?.price
    expect(priceOn('2026-11-24')).toBe(45)
    expect(priceOn('2026-12-01')).toBe(50)
    // Later: the generator gives a new slot the price in effect on its day.
    const later = new Date('2026-11-24T15:00:00Z')
    await ensureServiceVisits(db.client, ORG, { now: later, planIds: [r.plan.id] })
    expect(priceOn('2026-12-29')).toBe(50)
    // An edit with no date makes the new price apply now (and clears the schedule).
    const now2 = await updateServicePlan(db.client, ORG, 'u1', r.plan.id, { price: 55 }, null, NOW)
    if (!now2.ok || !('plan' in now2)) throw new Error('save')
    expect(now2.plan).toMatchObject({ price: 55, previous_price: null, price_starts_on: null })
    expect(priceOn('2026-11-24')).toBe(55)
    expect(await updateServicePlan(db.client, ORG, 'u1', r.plan.id, { price: 60, price_starts_on: 'soon' }, null, NOW)).toMatchObject({ ok: false, status: 400 })
  })

  it('the visits list pages instead of silently stopping, and says how many there are', async () => {
    const db = seed()
    for (let i = 0; i < 3; i++) await createServicePlan(db.client, ORG, 'u1', 'c1', { ...weekly, name: `Plan ${i}` }, NOW)
    const first = await loadVisitsPage(db.client, ORG, { from: '2026-11-10', to: '2026-12-31', accessNotes: false, limit: 10 })
    expect(first.total).toBe(18)
    expect(first.visits).toHaveLength(10)
    expect(first.hasMore).toBe(true)
    const rest = await loadVisitsPage(db.client, ORG, { from: '2026-11-10', to: '2026-12-31', accessNotes: false, limit: 10, offset: 10 })
    expect(rest.visits).toHaveLength(8)
    expect(rest.hasMore).toBe(false)
    expect((await loadVisits(db.client, ORG, { from: '2026-11-10', to: '2026-12-31', accessNotes: false })).length).toBe(18)
  })
})

describe('new customer + plan in one go', () => {
  const plan = { trade: 'lawn', name: 'Weekly mowing', price: 45, start_date: '2026-11-10', seasons: [{ from: '01-01', to: '12-31', frequency: 'weekly' }] }
  const property = { address_line1: '9 Pine Ln', city: 'Crawfordville', state: 'FL', zip: '32327', access_notes: 'Gate 9999' }
  it('creates the customer, their property and the plan (visits on the calendar)', async () => {
    const db = seed()
    const r = await createCustomerWithPlan(db.client, ORG, 'u1', { customer: { name: 'Sam New', phone: '850-555-0199' }, property, plan }, { accessNotes: true, now: NOW })
    if (!r.ok) throw new Error(r.error)
    expect(r.matchedExisting).toBe(false)
    const cust = (db.tables.customers as Array<Record<string, unknown>>).find((c) => c.id === r.customerId)
    expect(cust).toMatchObject({ org_id: ORG, name: 'Sam New' })
    const prop = (db.tables.properties as Array<Record<string, unknown>>).find((p) => p.customer_id === r.customerId)
    expect(prop).toMatchObject({ org_id: ORG, address_line1: '9 Pine Ln', access_notes: 'Gate 9999' })
    expect(r.plan.property_id).toBe(prop?.id)
    expect(visitsOf(db, r.plan.id).length).toBeGreaterThan(0)
  })
  it('a bad plan creates nobody; a missing name or address is refused first', async () => {
    const db = seed()
    const before = db.tables.customers.length
    expect(await createCustomerWithPlan(db.client, ORG, 'u1', { customer: { name: 'Sam' }, property, plan: { ...plan, trade: 'nope' } }, { accessNotes: true, now: NOW })).toMatchObject({ ok: false, status: 400 })
    expect(await createCustomerWithPlan(db.client, ORG, 'u1', { customer: { name: '' }, property, plan }, { accessNotes: true, now: NOW })).toMatchObject({ ok: false, error: 'Enter the customer’s name' })
    expect(await createCustomerWithPlan(db.client, ORG, 'u1', { customer: { name: 'Sam' }, property: { city: 'X' }, plan }, { accessNotes: true, now: NOW })).toMatchObject({ ok: false, status: 400 })
    expect(db.tables.customers.length).toBe(before)
  })
})

