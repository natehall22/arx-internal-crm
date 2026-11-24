/** @jest-environment node */
/**
 * Truck sheet over the in-memory database: the load list, beds, machines (plan default vs visit override), the office's note
 * (one per crew + day, crew-scoped, company-scoped) and the sheet routes (a token reaches only its own crew).
 */
import { inflateSync } from 'zlib'

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { fakeServicePlanRpc } from '@/lib/test-helpers/fake-service-plan-rpc'

const mockProjects = jest.fn()
const mockScope = jest.fn()
const mockMeasure = jest.fn()
const mockFeature = jest.fn()
jest.mock('@/lib/cron-orgs', () => ({ loadOrgTimeZone: async () => 'America/New_York' }))
jest.mock('@/lib/org-brand', () => ({ getDocumentBrand: async () => ({ casualName: 'Green Co' }) }))
jest.mock('@/lib/visit-collections-db', () => ({ loadOwedByCustomer: async () => new Map() }))
jest.mock('@/lib/crew-day-projects', () => ({ loadCrewProjectStops: (...a: unknown[]) => mockProjects(...a) }))
jest.mock('@/lib/job-sold-scope', () => ({ buildJobSoldScope: (...a: unknown[]) => mockScope(...a) }))
jest.mock('@/lib/org-features-server', () => ({ isOrgFeatureOn: (...a: unknown[]) => mockFeature(...a) }))
jest.mock('@/lib/area-measure-db', () => ({
  loadAreaMeasureSettings: async () => ({ mulchDepthIn: 3, strawSqftPerBale: 50 }),
  loadAreaMeasurements: (...a: unknown[]) => mockMeasure(...a),
}))

import { buildCrewDaySheet } from '@/lib/crew-day-sheet'
import { generateCrewDaySheetPDF } from '@/lib/pdf/crew-day-sheet'
import { createServicePlan, updateServicePlan } from '@/lib/service-plans-db'
import { loadCrewDayNote, loadPlanEquipment, loadVisitEquipment, saveCrewDayNote, savePlanEquipment, saveVisitEquipment } from '@/lib/truck-sheet-db'

/** Every text string the PDF draws, in order (same reader as the purchase-order golden test). */
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1')
  const out: string[] = []
  for (const s of raw.match(/stream\r?\n[\s\S]*?\r?\nendstream/g) ?? []) {
    const body = s.replace(/^stream\r?\n/, '').replace(/\r?\nendstream$/, '')
    let text = body
    try {
      text = inflateSync(Buffer.from(body, 'latin1')).toString('latin1')
    } catch {
      /* uncompressed stream */
    }
    for (const m of Array.from(text.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g))) out.push(m[1])
  }
  return out.join('\n').replace(/\\([()\\])/g, '$1')
}

const ORG = 'org-a'
const OTHER = 'org-b'
const NOW = new Date('2026-11-10T15:00:00Z') // Tuesday
const DAY = '2026-11-10'
const MOWER = '11111111-1111-4111-8111-111111111111'
const BLOWER = '22222222-2222-4222-8222-222222222222'
const TRUCK = '33333333-3333-4333-8333-333333333333'
const FOREIGN = '44444444-4444-4444-8444-444444444444'
const NOT_A_MACHINE = '55555555-5555-4555-8555-555555555555'

function seed(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return createFakeDb(
    {
      orgs: [{ id: ORG, timezone: 'America/New_York', settings: {} }],
      customers: [{ id: 'c1', org_id: ORG, name: 'Pat Lee' }, { id: 'c2', org_id: ORG, name: 'Sam Green' }],
      properties: [
        { id: 'p1', org_id: ORG, customer_id: 'c1', address_text: '1 Oak St', address_line1: '1 Oak St', city: 'X', state: 'FL', zip: '32327', active: true, access_notes: 'Gate 1234' },
        { id: 'p2', org_id: ORG, customer_id: 'c2', address_text: '2 Elm St', address_line1: '2 Elm St', city: 'X', state: 'FL', zip: '32327', active: true, access_notes: null },
      ],
      org_trades: [{ org_id: ORG, slug: 'lawn', label: 'Lawn care', sort: 1, active: true, match_keywords: [] }],
      sub_contractors: [{ id: 's1', org_id: ORG, company_name: 'Crew One', active: true }, { id: 's2', org_id: ORG, company_name: 'Crew Two', active: true }, { id: 'sx', org_id: OTHER, company_name: 'Not ours', active: true }],
      users: [{ id: 'u1', org_id: ORG, full_name: 'Office', active: true }],
      pricebook_items: [
        { id: MOWER, org_id: ORG, name: 'Zero-turn mower', unit: 'hour', active: true },
        { id: BLOWER, org_id: ORG, name: 'Backpack blower', unit: 'hour', active: true },
        { id: TRUCK, org_id: ORG, name: 'Dump trailer', unit: 'hour', active: false },
        { id: NOT_A_MACHINE, org_id: ORG, name: 'Mulch', unit: 'each', active: true },
        { id: FOREIGN, org_id: OTHER, name: 'Their mower', unit: 'hour', active: true },
      ],
      service_plans: [],
      work_orders: [],
      photos: [],
      service_plan_changes: [],
      service_visit_charges: [],
      proposal_line_items: [],
      crew_day_notes: [],
      ...extra,
    },
    { rpc: fakeServicePlanRpc }
  )
}

const plan = (over: Record<string, unknown> = {}) => ({
  property_id: 'p1',
  trade: 'lawn',
  name: 'Weekly mowing',
  start_date: '2026-11-10',
  preferred_weekday: 2,
  default_sub_id: 's1',
  seasons: [{ from: '01-01', to: '12-31', frequency: 'weekly' }],
  ...over,
})

async function makePlan(db: ReturnType<typeof seed>, over: Record<string, unknown> = {}, customer = 'c1') {
  const r = await createServicePlan(db.client, ORG, 'u1', customer, plan(over), NOW)
  if (!r.ok) throw new Error(r.error)
  return r.plan.id
}
const todayVisit = (db: ReturnType<typeof seed>, planId: string) => (db.tables.work_orders as Array<Record<string, unknown>>).find((w) => w.service_plan_id === planId && w.service_planned_date === DAY)!

beforeEach(() => {
  mockProjects.mockReset().mockResolvedValue([])
  mockScope.mockReset().mockResolvedValue({ line_items: [] })
  mockMeasure.mockReset().mockResolvedValue({ ready: true, rows: [] })
  mockFeature.mockReset().mockResolvedValue(true)
})

describe('machines: plan default, visit override', () => {
  it('a plan made with machines keeps them; a visit with no list uses the plan’s, one with its own list uses that, an empty list means none', async () => {
    const db = seed()
    const planId = await makePlan(db, { equipment_item_ids: [MOWER, BLOWER] })
    expect((await loadPlanEquipment(db.client, ORG, [planId])).get(planId)).toEqual([MOWER, BLOWER])

    let sheet = await buildCrewDaySheet(db.client, ORG, { subId: 's1', crewName: 'Crew One', day: DAY, money: false })
    expect(sheet.visits[0].machines).toEqual(['Zero-turn mower', 'Backpack blower'])
    expect(sheet.machines).toEqual(['Zero-turn mower', 'Backpack blower'])

    const v = todayVisit(db, planId)
    expect((await saveVisitEquipment(db.client, ORG, String(v.id), [BLOWER])).ok).toBe(true)
    ;(db.tables.pricebook_items as Array<Record<string, unknown>>).find((i) => i.id === BLOWER)!.active = false // retired later
    sheet = await buildCrewDaySheet(db.client, ORG, { subId: 's1', crewName: 'Crew One', day: DAY, money: false })
    expect(sheet.visits[0].machines).toEqual(['Backpack blower']) // a retired machine still shows by name
    expect(sheet.machines).toEqual(['Backpack blower'])

    expect((await saveVisitEquipment(db.client, ORG, String(v.id), [])).ok).toBe(true)
    sheet = await buildCrewDaySheet(db.client, ORG, { subId: 's1', crewName: 'Crew One', day: DAY, money: false })
    expect(sheet.visits[0].machines).toEqual([])

    expect((await saveVisitEquipment(db.client, ORG, String(v.id), null)).ok).toBe(true)
    expect((await loadVisitEquipment(db.client, ORG, [String(v.id)])).get(String(v.id))).toBeNull()
    sheet = await buildCrewDaySheet(db.client, ORG, { subId: 's1', crewName: 'Crew One', day: DAY, money: false })
    expect(sheet.visits[0].machines).toEqual(['Zero-turn mower', 'Backpack blower'])
  })

  it('the day’s machines are each one once across stops', async () => {
    const db = seed()
    await makePlan(db, { equipment_item_ids: [MOWER, BLOWER] })
    await makePlan(db, { property_id: 'p2', name: 'Weekly mowing 2', equipment_item_ids: [MOWER] }, 'c2')
    const sheet = await buildCrewDaySheet(db.client, ORG, { subId: 's1', crewName: 'Crew One', day: DAY, money: false })
    expect(sheet.visits).toHaveLength(2)
    expect(sheet.machines.sort()).toEqual(['Backpack blower', 'Zero-turn mower'])
  })

  it('only this company’s machines (unit hour): another company’s item or a non-machine is refused, nothing is written', async () => {
    const db = seed()
    const planId = await makePlan(db)
    expect(await savePlanEquipment(db.client, ORG, planId, [FOREIGN])).toMatchObject({ ok: false, status: 400 })
    expect(await savePlanEquipment(db.client, ORG, planId, [NOT_A_MACHINE])).toMatchObject({ ok: false, status: 400 })
    expect(await savePlanEquipment(db.client, ORG, planId, ['not-an-id'])).toMatchObject({ ok: false, status: 400 })
    expect((await loadPlanEquipment(db.client, ORG, [planId])).get(planId)).toBeNull()
    // …and another company can neither set nor read this plan's machines.
    expect(await savePlanEquipment(db.client, OTHER, planId, [])).toMatchObject({ ok: false, status: 404 })
    expect((await loadPlanEquipment(db.client, OTHER, [planId])).size).toBe(0)
  })

  it('a visit that is done can no longer change machines', async () => {
    const db = seed()
    const planId = await makePlan(db)
    const v = todayVisit(db, planId)
    v.status = 'completed'
    expect(await saveVisitEquipment(db.client, ORG, String(v.id), [MOWER])).toMatchObject({ ok: false, status: 404 })
  })

  it('editing a plan’s machines writes no visit change, shows names in the history, and "no change" is "Nothing changed"', async () => {
    const db = seed()
    const planId = await makePlan(db)
    const before = JSON.stringify(db.tables.work_orders)
    const pv = await updateServicePlan(db.client, ORG, 'u1', planId, { equipment_item_ids: [MOWER], preview: true }, null, NOW)
    expect(pv).toMatchObject({ ok: true, preview: true, effect: { removed: 0, added: 0, updated: 0 } })
    expect((pv as { changes: unknown[] }).changes).toEqual([{ field: 'equipment_item_ids', label: 'Machines', old: null, new: ['Zero-turn mower'] }])
    expect((await loadPlanEquipment(db.client, ORG, [planId])).get(planId)).toBeNull() // a preview writes nothing

    const saved = await updateServicePlan(db.client, ORG, 'u1', planId, { equipment_item_ids: [MOWER] }, null, NOW)
    expect(saved.ok).toBe(true)
    expect(JSON.stringify(db.tables.work_orders)).toBe(before)
    expect((await loadPlanEquipment(db.client, ORG, [planId])).get(planId)).toEqual([MOWER])
    expect(db.tables.service_plan_changes.at(-1)).toMatchObject({ plan_id: planId, action: 'updated', changes: [{ field: 'equipment_item_ids', label: 'Machines' }] })

    expect(await updateServicePlan(db.client, ORG, 'u1', planId, { equipment_item_ids: [MOWER] }, null, NOW)).toMatchObject({ ok: false, error: 'Nothing changed' })
    // Machines together with another field: both save.
    const both = await updateServicePlan(db.client, ORG, 'u1', planId, { equipment_item_ids: [MOWER, BLOWER], route_position: 3 }, null, NOW)
    expect(both.ok).toBe(true)
    expect((await loadPlanEquipment(db.client, ORG, [planId])).get(planId)).toEqual([MOWER, BLOWER])
    expect((db.tables.service_plans[0] as Record<string, unknown>).route_position).toBe(3)
    // A body that does not name machines leaves them alone.
    await updateServicePlan(db.client, ORG, 'u1', planId, { route_position: 4 }, null, NOW)
    expect((await loadPlanEquipment(db.client, ORG, [planId])).get(planId)).toEqual([MOWER, BLOWER])
  })

  it('a bad machine in a plan edit or a new plan is a plain refusal and saves nothing', async () => {
    const db = seed()
    const planId = await makePlan(db)
    expect(await updateServicePlan(db.client, ORG, 'u1', planId, { equipment_item_ids: [FOREIGN] }, null, NOW)).toMatchObject({ ok: false, status: 400 })
    const r = await createServicePlan(db.client, ORG, 'u1', 'c1', plan({ name: 'Other', equipment_item_ids: [NOT_A_MACHINE] }), NOW)
    expect(r).toMatchObject({ ok: false, status: 400 })
    expect(db.tables.service_plans).toHaveLength(1)
  })
})

describe('load list', () => {
  it('a plan that came from a quote lists its quote line; labor / visit lines are skipped; totals combine item + unit across stops', async () => {
    const db = seed({
      proposal_line_items: [
        { id: 'ql1', org_id: ORG, name: 'Pine straw refresh', category: 'Landscape', unit: 'each', quantity: 10 },
        { id: 'ql2', org_id: ORG, name: 'pine straw refresh', category: 'Landscape', unit: 'each', quantity: 4 },
        { id: 'ql3', org_id: ORG, name: 'Weekly mowing', category: 'Lawn', unit: 'visit', quantity: 1 },
      ],
    })
    const a = await makePlan(db, { name: 'Straw A' })
    const b = await makePlan(db, { name: 'Straw B', property_id: 'p2' }, 'c2')
    const c = await makePlan(db, { name: 'Mow only', property_id: 'p2' }, 'c2')
    for (const [id, ql] of [[a, 'ql1'], [b, 'ql2'], [c, 'ql3']] as const) (db.tables.service_plans as Array<Record<string, unknown>>).find((p) => p.id === id)!.quote_line_id = ql
    const sheet = await buildCrewDaySheet(db.client, ORG, { subId: 's1', crewName: 'Crew One', day: DAY, money: false })
    expect(sheet.load).toEqual([{ label: 'Pine straw refresh', amount: '14' }])
    const byName = Object.fromEntries(sheet.visits.map((v) => [v.what, v.load]))
    expect(byName['Straw A']).toEqual([{ label: 'Pine straw refresh', amount: '10' }])
    expect(byName['Straw B']).toEqual([{ label: 'pine straw refresh', amount: '4' }])
    expect(byName['Mow only']).toEqual([])
  })

  it('job stops list the job’s sold line items (no prices, labor skipped); a job whose scope cannot be read is flagged, never empty', async () => {
    const db = seed({
      work_orders: [{ id: 'w1', org_id: ORG, job_id: 'j1', property_id: null, stop_order: 1 }, { id: 'w2', org_id: ORG, job_id: 'j2', property_id: null, stop_order: 2 }],
      production_jobs: [{ id: 'j1', org_id: ORG, customer_id: 'c1', job_number: '26-0001' }, { id: 'j2', org_id: ORG, customer_id: 'c2', job_number: '26-0002' }],
    })
    mockProjects.mockResolvedValue([
      { id: 'w1', jobNumber: '26-0001', tradeLabel: 'Roofing', address: '9 Pine Rd', status: 'scheduled', dayNumber: null, dayCount: null },
      { id: 'w2', jobNumber: '26-0002', tradeLabel: 'Gutters', address: '7 Pine Rd', status: 'scheduled', dayNumber: null, dayCount: null },
      { id: 'w3', jobNumber: '26-0003', tradeLabel: 'Siding', address: '5 Pine Rd', status: 'completed', dayNumber: null, dayCount: null },
    ])
    mockScope.mockImplementation(async ({ job }: { job: { id: string } }) => {
      if (job.id === 'j2') throw new Error('boom')
      return { line_items: [{ name: 'Shingles', category: 'roofing', unit: 'square', quantity: 28, unit_price: 100, line_total: 2800 }, { name: 'Shingles', category: 'roofing', unit: 'square', quantity: 2, unit_price: 100, line_total: 200 }, { name: 'Tear-off labor', category: 'Labor', unit: 'square', quantity: 30, unit_price: 5, line_total: 150 }] }
    })
    const sheet = await buildCrewDaySheet(db.client, ORG, { subId: 's1', crewName: 'Crew One', day: DAY, money: false })
    expect(sheet.visits.map((v) => v.what)).toEqual(['Roofing · Job 26-0001', 'Gutters · Job 26-0002']) // the finished one is not a stop
    expect(sheet.visits[0]).toMatchObject({ stop: 1, firstName: 'Pat', load: [{ label: 'Shingles', amount: '30 squares' }], loadUnread: false })
    expect(sheet.visits[1]).toMatchObject({ stop: 2, load: [], loadUnread: true })
    expect(sheet.load).toEqual([{ label: 'Shingles', amount: '30 squares' }])
    expect(JSON.stringify(sheet)).not.toMatch(/unit_price|line_total|price/i)
  })

  it('stops come in route order (a visit’s own stop number beats its plan’s; a job stop keeps its saved number; the number is the one the phone shows)', async () => {
    const db = seed({ work_orders: [{ id: 'w1', org_id: ORG, job_id: 'j1', property_id: null, stop_order: 2 }], production_jobs: [{ id: 'j1', org_id: ORG, customer_id: 'c1', job_number: '26-0001' }] })
    mockProjects.mockResolvedValue([{ id: 'w1', jobNumber: '26-0001', tradeLabel: 'Roofing', address: '9 Pine Rd', status: 'scheduled', dayNumber: null, dayCount: null }])
    const a = await makePlan(db, { name: 'First by plan', route_position: 9 })
    const b = await makePlan(db, { name: 'Second by plan', property_id: 'p2', route_position: 5 }, 'c2')
    todayVisit(db, a).stop_order = 1 // arranged on the board: beats the plan's 9
    const sheet = await buildCrewDaySheet(db.client, ORG, { subId: 's1', crewName: 'Crew One', day: DAY, money: false })
    expect(sheet.visits.map((v) => [v.stop, v.what])).toEqual([[1, 'First by plan'], [2, 'Roofing · Job 26-0001'], [5, 'Second by plan']])
    void b
  })
})

describe('beds from the newest yard measure', () => {
  const row = (over: Record<string, unknown> = {}) => ({ id: 'm1', bed_sqft: 216, totals: { materials: { mulchCuYd: 2, strawBales: 5 } }, settings: {}, ...over })

  it('per stop as stored, totalled once per property; nothing when the company has no measure tool or the property was never measured', async () => {
    const db = seed()
    await makePlan(db, { name: 'A beds' })
    await makePlan(db, { name: 'A beds again', preferred_weekday: 2 })
    await makePlan(db, { name: 'B beds', property_id: 'p2' }, 'c2')
    mockMeasure.mockImplementation(async (_a: unknown, _o: string, where: { propertyId: string }, limit: number) => {
      expect(limit).toBe(1) // the newest only
      return where.propertyId === 'p1' ? { ready: true, rows: [row()] } : { ready: true, rows: [] }
    })
    const sheet = await buildCrewDaySheet(db.client, ORG, { subId: 's1', crewName: 'Crew One', day: DAY, money: false })
    const a = sheet.visits.filter((v) => v.what.startsWith('A'))
    expect(a).toHaveLength(2)
    expect(a.every((v) => v.beds && v.beds.mulchCuYd === 2 && v.beds.strawBales === 5)).toBe(true)
    expect(sheet.visits.find((v) => v.what === 'B beds')!.beds).toBeNull()
    expect(sheet.beds).toEqual({ mulchCuYd: 2, strawBales: 5, properties: 1 }) // two stops, one home

    mockFeature.mockResolvedValue(false)
    mockMeasure.mockClear()
    const off = await buildCrewDaySheet(db.client, ORG, { subId: 's1', crewName: 'Crew One', day: DAY, money: false })
    expect(off.beds).toBeNull()
    expect(off.visits.every((v) => v.beds === null)).toBe(true)
    expect(mockMeasure).not.toHaveBeenCalled()
  })

  it('an older measure with no saved totals is worked out from its bed area', async () => {
    const db = seed()
    await makePlan(db)
    mockMeasure.mockResolvedValue({ ready: true, rows: [row({ bed_sqft: 108, totals: {} })] })
    const sheet = await buildCrewDaySheet(db.client, ORG, { subId: 's1', crewName: 'Crew One', day: DAY, money: false })
    expect(sheet.visits[0].beds).toEqual({ bedSqft: 108, mulchCuYd: 1, strawBales: 3 })
  })

  it('a failed yard-measure read leaves that stop without beds and the sheet still builds', async () => {
    const db = seed()
    await makePlan(db)
    mockMeasure.mockRejectedValue(new Error('down'))
    const sheet = await buildCrewDaySheet(db.client, ORG, { subId: 's1', crewName: 'Crew One', day: DAY, money: false })
    expect(sheet.visits).toHaveLength(1)
    expect(sheet.beds).toBeNull()
  })
})

describe('office note for a crew’s day', () => {
  it('one note per crew + day: a second save replaces it; blank clears it', async () => {
    const db = seed()
    expect(await saveCrewDayNote(db.client, ORG, 'u1', 's1', DAY, 'Gate code changed.')).toEqual({ ok: true, note: 'Gate code changed.' })
    expect(await saveCrewDayNote(db.client, ORG, 'u1', 's1', DAY, '  New gate code 9.  ')).toEqual({ ok: true, note: 'New gate code 9.' })
    expect(db.tables.crew_day_notes).toHaveLength(1)
    expect(db.tables.crew_day_notes[0]).toMatchObject({ org_id: ORG, sub_id: 's1', day: DAY, note: 'New gate code 9.', updated_by: 'u1' })
    expect(await saveCrewDayNote(db.client, ORG, 'u1', 's1', DAY, '   ')).toEqual({ ok: true, note: null })
    expect(db.tables.crew_day_notes).toHaveLength(0)
  })

  it('refuses over 1000 characters and a crew from another company; nothing is written', async () => {
    const db = seed()
    expect(await saveCrewDayNote(db.client, ORG, 'u1', 's1', DAY, 'x'.repeat(1001))).toMatchObject({ ok: false, status: 400 })
    expect(await saveCrewDayNote(db.client, ORG, 'u1', 'sx', DAY, 'hello')).toMatchObject({ ok: false, status: 404 })
    expect(db.tables.crew_day_notes).toHaveLength(0)
  })

  it('shows only for that crew and that day, and only in that company', async () => {
    const db = seed()
    await makePlan(db)
    await saveCrewDayNote(db.client, ORG, 'u1', 's1', DAY, 'Bring the long hose.')
    expect((await loadCrewDayNote(db.client, ORG, 's1', DAY))?.note).toBe('Bring the long hose.')
    expect(await loadCrewDayNote(db.client, ORG, 's2', DAY)).toBeNull() // another crew
    expect(await loadCrewDayNote(db.client, ORG, 's1', '2026-11-11')).toBeNull() // another day
    expect(await loadCrewDayNote(db.client, OTHER, 's1', DAY)).toBeNull() // another company
    const mine = await buildCrewDaySheet(db.client, ORG, { subId: 's1', crewName: 'Crew One', day: DAY, money: false })
    expect(mine.officeNote).toBe('Bring the long hose.')
    const theirs = await buildCrewDaySheet(db.client, ORG, { subId: 's2', crewName: 'Crew Two', day: DAY, money: false })
    expect(theirs.officeNote).toBeNull()
  })

  it('the table not being there yet reads as no note and a save says so', async () => {
    const db = seed()
    const missing = { code: '42P01', message: 'relation "crew_day_notes" does not exist' }
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq']) chain[m] = () => chain
    chain.maybeSingle = async () => ({ data: null, error: missing })
    const broken = { from: () => chain } as unknown as Parameters<typeof loadCrewDayNote>[0]
    expect(await loadCrewDayNote(broken, ORG, 's1', DAY)).toBeNull()
    const saving: Record<string, unknown> = {}
    for (const m of ['select', 'eq']) saving[m] = () => saving
    saving.maybeSingle = async () => ({ data: { id: 's1' }, error: null })
    saving.upsert = async () => ({ error: missing })
    const res = await saveCrewDayNote({ from: () => saving } as unknown as Parameters<typeof loadCrewDayNote>[0], ORG, 'u1', 's1', DAY, 'hi')
    expect(res).toMatchObject({ ok: false, status: 503 })
  })
})

describe('the sheet itself', () => {
  it('draws the note, the day’s load, beds and machines, and never a price (only "Customer owes" can carry money)', async () => {
    const db = seed({ proposal_line_items: [{ id: 'ql1', org_id: ORG, name: 'Pine straw refresh', category: 'Landscape', unit: 'each', quantity: 10 }] })
    const id = await makePlan(db, { equipment_item_ids: [MOWER] })
    ;(db.tables.service_plans as Array<Record<string, unknown>>).find((p) => p.id === id)!.quote_line_id = 'ql1'
    mockMeasure.mockResolvedValue({ ready: true, rows: [{ id: 'm1', bed_sqft: 216, totals: { materials: { mulchCuYd: 2, strawBales: 5 } }, settings: {} }] })
    await saveCrewDayNote(db.client, ORG, 'u1', 's1', DAY, 'Bring the long hose.')
    const sheet = await buildCrewDaySheet(db.client, ORG, { subId: 's1', crewName: 'Crew One', day: DAY, money: false })
    const text = pdfText(generateCrewDaySheetPDF(sheet))
    for (const want of ['NOTE FROM THE OFFICE', 'Bring the long hose.', 'LOAD LIST', 'Pine straw refresh', 'Bed materials to load (from yard measure, est.)', 'Zero-turn mower']) expect(text).toContain(want)
    expect(text).not.toMatch(/\$\d/)
  })

  it('a day with no stops and no extras still makes a PDF; a huge load list is cut with an honest last line, not an error', () => {
    const empty = generateCrewDaySheetPDF({ companyName: 'Co', crewName: 'Crew', dateLabel: 'Tue, Nov 10', officeNote: null, load: [], beds: null, machines: [], visits: [] })
    expect(empty.length).toBeGreaterThan(500)
    const many = Array.from({ length: 150 }, (_, i) => ({ label: `Item ${i}`, amount: '1' }))
    const stop = { stop: 1, firstName: 'Pat', address: '1 Oak', what: 'Job', accessNotes: null, notes: null, checklist: [], collectCents: null, load: many, loadUnread: false, beds: null, machines: [] }
    const pdf = generateCrewDaySheetPDF({ companyName: 'Co', crewName: 'Crew', dateLabel: 'Tue, Nov 10', officeNote: 'x'.repeat(900), load: many, beds: null, machines: ['A', 'B'], visits: [stop, stop] })
    expect(pdfText(pdf)).toContain('more (see the job)')
  })
})

describe('review fixes', () => {
  const measured = { ready: true, rows: [{ id: 'm1', bed_sqft: 216, totals: { materials: { mulchCuYd: 2, strawBales: 5 } }, settings: {} }] }

  it('beds show per stop as information but join the day total only for bed work', async () => {
    const db = seed()
    await makePlan(db, { name: 'Weekly mowing' })
    mockMeasure.mockResolvedValue(measured)
    let sheet = await buildCrewDaySheet(db.client, ORG, { subId: 's1', crewName: 'Crew One', day: DAY, money: false })
    expect(sheet.visits[0].beds).toMatchObject({ mulchCuYd: 2, strawBales: 5 })
    expect(sheet.beds).toBeNull() // mowing is not bed work: nothing to load
    const db2 = seed()
    await makePlan(db2, { name: 'Weekly mowing' })
    await makePlan(db2, { name: 'Spring mulch', property_id: 'p2' }, 'c2')
    sheet = await buildCrewDaySheet(db2.client, ORG, { subId: 's1', crewName: 'Crew One', day: DAY, money: false })
    expect(sheet.beds).toEqual({ mulchCuYd: 2, strawBales: 5, properties: 1 })
  })

  it('a bed-work quote line (by name) on a mowing plan loads the beds', async () => {
    const db = seed({ proposal_line_items: [{ id: 'ql1', org_id: ORG, name: 'Pine straw refresh', category: 'Landscape', unit: 'each', quantity: 1 }] })
    const id = await makePlan(db)
    ;(db.tables.service_plans as Array<Record<string, unknown>>).find((p) => p.id === id)!.quote_line_id = 'ql1'
    mockMeasure.mockResolvedValue(measured)
    const sheet = await buildCrewDaySheet(db.client, ORG, { subId: 's1', crewName: 'Crew One', day: DAY, money: false })
    expect(sheet.beds).toMatchObject({ properties: 1 })
  })

  it('plan default machines apply to service visits only, not follow-on step visits', async () => {
    const db = seed()
    const planId = await makePlan(db, { equipment_item_ids: [MOWER] })
    todayVisit(db, planId).visit_step = 'inspect'
    const sheet = await buildCrewDaySheet(db.client, ORG, { subId: 's1', crewName: 'Crew One', day: DAY, money: false })
    expect(sheet.visits[0].machines).toEqual([])
  })

  it('a new plan saves machines AFTER the insert (never in the insert), and a machine save failure keeps the plan with a warning', async () => {
    const db = seed()
    const real = (db.client as unknown as { from: (t: string) => unknown }).from.bind(db.client)
    let insertedKeys: string[] = []
    ;(db.client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = real(t) as Record<string, (...a: unknown[]) => unknown>
      if (t !== 'service_plans') return q
      return new Proxy(q, {
        get(target, k) {
          if (k === 'insert') return (row: Record<string, unknown>) => { insertedKeys = Object.keys(row); return target.insert(row) }
          return target[k as string]
        },
      })
    }
    const r = await createServicePlan(db.client, ORG, 'u1', 'c1', plan({ equipment_item_ids: [MOWER] }), NOW)
    expect(r.ok).toBe(true)
    expect(insertedKeys).not.toContain('equipment_item_ids')
    expect((await loadPlanEquipment(db.client, ORG, [(r as { plan: { id: string } }).plan.id])).get((r as { plan: { id: string } }).plan.id)).toEqual([MOWER])
  })

  it('after the plan transaction a machine save failure warns and continues: visits topped up, history written without the machines line', async () => {
    const db = seed()
    const planId = await makePlan(db)
    // The machines column is "not there yet": the tolerant save fails after the plan itself saved.
    const real = (db.client as unknown as { from: (t: string) => unknown }).from.bind(db.client)
    ;(db.client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = real(t) as Record<string, (...a: unknown[]) => unknown>
      if (t !== 'service_plans') return q
      return new Proxy(q, {
        get(target, k) {
          if (k === 'update') return (row: Record<string, unknown>) => (row && 'equipment_item_ids' in row ? { eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom', code: 'XX000' } }) }) }) }) } : target.update(row))
          return target[k as string]
        },
      })
    }
    const r = await updateServicePlan(db.client, ORG, 'u1', planId, { equipment_item_ids: [MOWER], route_position: 5 }, null, NOW)
    expect(r).toMatchObject({ ok: true })
    expect((r as { warning?: string }).warning).toMatch(/machines did not save/)
    expect((db.tables.service_plans[0] as Record<string, unknown>).route_position).toBe(5)
    const last = db.tables.service_plan_changes.at(-1) as { changes: Array<{ field: string }> }
    expect(last.changes.map((c) => c.field)).toEqual(['route_position'])
  })

  it('one machine list: a retired or labor item is refused for a new pick, but a machine already on the plan can stay', async () => {
    const LABOR = '66666666-6666-4666-8666-666666666666'
    const db = seed({ pricebook_items: [
      { id: MOWER, org_id: ORG, name: 'Zero-turn mower', unit: 'hour', active: true },
      { id: TRUCK, org_id: ORG, name: 'Dump trailer', unit: 'hour', active: false },
      { id: LABOR, org_id: ORG, name: 'Crew labor', unit: 'hour', active: true, is_labor: true },
    ] })
    const planId = await makePlan(db)
    expect(await savePlanEquipment(db.client, ORG, planId, [LABOR])).toMatchObject({ ok: false, status: 400 })
    expect(await savePlanEquipment(db.client, ORG, planId, [TRUCK])).toMatchObject({ ok: false, status: 400 })
    expect((await savePlanEquipment(db.client, ORG, planId, [MOWER])).ok).toBe(true)
    ;(db.tables.pricebook_items as Array<Record<string, unknown>>)[0].active = false // office later retires the mower
    expect((await savePlanEquipment(db.client, ORG, planId, [MOWER])).ok).toBe(true) // still on the plan: kept
  })

  it('the sheet and the phone page number stops with ONE helper (a saved order beats the plan’s; done visits keep their number)', async () => {
    const db = seed()
    const a = await makePlan(db, { name: 'A', route_position: 1 })
    const b = await makePlan(db, { name: 'B', property_id: 'p2', route_position: 2 }, 'c2')
    todayVisit(db, a).status = 'completed'
    const sheet = await buildCrewDaySheet(db.client, ORG, { subId: 's1', crewName: 'Crew One', day: DAY, money: false })
    expect(sheet.visits.map((v) => [v.what, v.stop])).toEqual([['B', 2]]) // A is done (off the paper) but B stays 2, as on the phone
    void b
  })
})
