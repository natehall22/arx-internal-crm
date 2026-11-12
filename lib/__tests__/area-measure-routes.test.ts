/** @jest-environment node */
/**
 * Measure yard routes against the in-memory fake DB: feature switch, company fence (another company's ids are 404),
 * who may read / save, totals recomputed on the server, history kept (inserts only), owner-only settings.
 */
import { NextResponse } from 'next/server'

import { mergeSettingsAt } from '@/lib/org-settings'
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import type { ThreadViewer } from '@/lib/threads/visibility'

const ORG = 'org-1'
const OTHER = 'org-2'
let viewer: ThreadViewer
let superAdmin = false
let featureOn = true
let db: ReturnType<typeof createFakeDb>

const baseViewer = (over: Partial<ThreadViewer> = {}): ThreadViewer => ({
  userId: 'u-me', orgId: ORG, ownerLike: false, jobBoard: false, jobEdit: false, jobFinancials: false, managerLike: false,
  closerLike: false, setterLike: false, pricingBarred: false, insideSales: false, ...over,
})

const pts = [{ lat: 30.1, lng: -84.2 }, { lat: 30.1, lng: -84.1 }, { lat: 30.2, lng: -84.1 }]
const lawn = { id: 'l1', type: 'lawn', name: 'Front', points: pts, sqft: 10000 }
const bed = { id: 'b1', type: 'bed', name: null, points: pts, sqft: 540 }
const house = { id: 'h1', type: 'cutout', name: 'House', points: pts, sqft: 2500 }
const edge = { id: 'e1', type: 'line', name: 'Edging', points: pts.slice(0, 2), feet: 120 }

function seed(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  db = createFakeDb(
    {
      orgs: [{ id: ORG, settings: { areaMeasure: { mulchDepthIn: 4, strawSqftPerBale: 40 } } }, { id: OTHER, settings: {} }],
      customers: [
        { id: 'c1', org_id: ORG, name: 'Ann', address_text: '5 Elm St' },
        { id: 'c2', org_id: ORG, name: 'Bob', address_text: '9 Oak St' },
        { id: 'cx', org_id: OTHER, name: 'Other co' },
      ],
      leads: [
        { id: 'l-1', org_id: ORG, owner_user_id: 'u-me', homeowner_name: 'Lead One', address_text: '1 Lead Ln', lat: 30.1, lng: -84.2 },
        { id: 'l-2', org_id: ORG, owner_user_id: 'u-else', homeowner_name: 'Lead Two', address_text: '2 Lead Ln' },
        { id: 'lx', org_id: OTHER, owner_user_id: 'u-x', homeowner_name: 'Theirs' },
      ],
      opportunities: [
        { id: 'd1', org_id: ORG, customer_id: 'c1', lead_id: null, owner_user_id: 'u-me', setter_user_id: null, address_text: '5 Elm St', status: 'open' },
        { id: 'd2', org_id: ORG, customer_id: 'c2', lead_id: null, owner_user_id: 'u-else', setter_user_id: null, address_text: '9 Oak St', status: 'open' },
        { id: 'dx', org_id: OTHER, customer_id: 'cx', lead_id: null, owner_user_id: 'u-x', setter_user_id: null },
      ],
      properties: [
        { id: 'p1', org_id: ORG, customer_id: 'c1', address_text: '5 Elm St, Tallahassee FL', lat: 30.11, lng: -84.22, active: true },
        { id: 'p2', org_id: ORG, customer_id: 'c2', address_text: '9 Oak St', lat: null, lng: null, active: true },
        { id: 'px', org_id: OTHER, customer_id: 'cx', address_text: '1 Other', active: true },
      ],
      scheduled_appointments: [],
      area_measurements: [],
      ...extra,
    },
    {
      rpc: {
        merge_org_settings: (args, tables) => {
          const row = tables.orgs.find((o) => o.id === args.p_org_id)
          if (!row) return null
          row.settings = mergeSettingsAt(row.settings, args.p_path as string[], args.p_set as Record<string, unknown>, (args.p_remove as string[]) ?? [])
          return null
        },
      },
    }
  )
}

jest.mock('@/lib/threads/api', () => {
  const actual = jest.requireActual('@/lib/threads/api')
  return { ...actual, threadAuth: async () => ({ admin: db.client, profile: { id: viewer.userId, org_id: viewer.orgId, role: 'x' }, viewer }) }
})
jest.mock('@/lib/auth', () => ({
  requireAuthApi: async () => ({ profile: { id: 'u-me', org_id: ORG, role: 'admin', is_super_admin: superAdmin } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/org-features-server', () => ({
  orgFeatureOffResponse: async () => (featureOn ? null : NextResponse.json({ error: 'off', code: 'feature_off' }, { status: 403 })),
  isOrgFeatureOn: async () => featureOn,
}))

import * as route from '@/app/api/area-measure/route'
import * as settingsRoute from '@/app/api/area-measure/settings/route'

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://crm.test/api/area-measure', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const get = (qs: string) => new Request(`https://crm.test/api/area-measure?${qs}`)
const patch = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://crm.test/api/area-measure/settings', { method: 'PATCH', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const saved = () => db.tables.area_measurements

beforeEach(() => {
  viewer = baseViewer({ ownerLike: true })
  superAdmin = false
  featureOn = true
  seed()
})

describe('feature switch', () => {
  it('off: nothing is read or written', async () => {
    featureOn = false
    expect((await route.POST(post({ customerId: 'c1', shapes: [lawn] }))).status).toBe(403)
    expect((await route.GET(get('customer_id=c1'))).status).toBe(403)
    expect(saved()).toHaveLength(0)
  })
})

describe('saving', () => {
  it('saves to the customer: company id stamped, totals computed here with the company numbers, request totals ignored', async () => {
    const res = await route.POST(post({ customerId: 'c1', propertyId: 'p1', opportunityId: 'd1', shapes: [lawn, house, bed, edge], lawn_sqft: 999999, totals: { lawnSqft: 1 }, org_id: OTHER, address: 'typed addr', lat: 30.15, lng: -84.15 }))
    expect(res.status).toBe(201)
    expect(saved()).toHaveLength(1)
    const row = saved()[0]
    expect(row).toMatchObject({ org_id: ORG, customer_id: 'c1', property_id: 'p1', opportunity_id: 'd1', lead_id: null, created_by: 'u-me', address_text: 'typed addr', lat: 30.15, lng: -84.15 })
    expect([row.lawn_sqft, row.bed_sqft, row.cutout_sqft, row.line_feet]).toEqual([7500, 540, 2500, 120])
    // 540 sq ft at 4 in = 6.67 cu yd; 540 / 40 = 13.5 -> 14 bales (the company's numbers, saved with the row)
    expect(row.totals).toMatchObject({ lawnSqft: 7500, materials: { mulchCuYd: 6.67, strawBales: 14, mulchDepthIn: 4, strawSqftPerBale: 40 } })
    expect(row.settings).toEqual({ mulchDepthIn: 4, strawSqftPerBale: 40 })
    expect((row.shapes as unknown[]).length).toBe(4)
  })
  it('the deal fills in the customer; the property address is the default address', async () => {
    expect((await route.POST(post({ opportunityId: 'd1', shapes: [lawn] }))).status).toBe(201)
    expect(saved()[0]).toMatchObject({ customer_id: 'c1', opportunity_id: 'd1', address_text: '5 Elm St' })
    expect((await route.POST(post({ propertyId: 'p1', shapes: [lawn] }))).status).toBe(201)
    expect(saved()[1]).toMatchObject({ customer_id: 'c1', property_id: 'p1', address_text: '5 Elm St, Tallahassee FL' })
  })
  it('saves to a lead', async () => {
    expect((await route.POST(post({ leadId: 'l-1', shapes: [lawn] }))).status).toBe(201)
    expect(saved()[0]).toMatchObject({ lead_id: 'l-1', customer_id: null, address_text: '1 Lead Ln', org_id: ORG })
  })
  it('keeps history: every save is a new row, nothing is updated or deleted', async () => {
    await route.POST(post({ customerId: 'c1', shapes: [lawn] }))
    await route.POST(post({ customerId: 'c1', shapes: [lawn, bed] }))
    expect(saved()).toHaveLength(2)
    expect(saved()[0].id).not.toBe(saved()[1].id)
    expect(db.writes.filter((w) => w.table === 'area_measurements').map((w) => w.op)).toEqual(['insert', 'insert'])
    const list = (await (await route.GET(get('customer_id=c1'))).json()) as { rows: unknown[]; latest: { bed_sqft: number } }
    expect(list.rows).toHaveLength(2)
  })
  it('needs something to save to, and valid shapes', async () => {
    expect((await route.POST(post({ shapes: [lawn] }))).status).toBe(400)
    expect((await route.POST(post({ customerId: 'c1', shapes: [] }))).status).toBe(400)
    expect((await route.POST(post({ customerId: 'c1', shapes: [{ ...lawn, sqft: -4 }] }))).status).toBe(400)
    expect((await route.POST(post({ customerId: 'c1', shapes: 'x' }))).status).toBe(400)
    expect((await route.POST(post(null))).status).toBe(400)
    expect(saved()).toHaveLength(0)
  })
})

describe('company fence', () => {
  it("another company's customer, property, deal or lead is not found, and nothing is written", async () => {
    for (const body of [{ customerId: 'cx' }, { propertyId: 'px' }, { opportunityId: 'dx' }, { leadId: 'lx' }, { customerId: 'c1', propertyId: 'px' }, { customerId: 'cx', opportunityId: 'd1' }]) {
      const res = await route.POST(post({ ...body, shapes: [lawn] }))
      expect([JSON.stringify(body), [404, 400].includes(res.status)]).toEqual([JSON.stringify(body), true])
    }
    expect(saved()).toHaveLength(0)
  })
  it("a property of ANOTHER customer of this company can't be hung on this customer", async () => {
    expect((await route.POST(post({ customerId: 'c1', propertyId: 'p2', shapes: [lawn] }))).status).toBe(404)
    expect(saved()).toHaveLength(0)
  })
  it('a deal and a customer that disagree are refused', async () => {
    expect((await route.POST(post({ customerId: 'c2', opportunityId: 'd1', shapes: [lawn] }))).status).toBe(400)
  })
  it("a list never includes another company's rows, even ones pointing at this customer", async () => {
    seed({
      area_measurements: [
        { id: 'm-mine', org_id: ORG, customer_id: 'c1', property_id: null, lawn_sqft: 1, bed_sqft: 0, cutout_sqft: 0, line_feet: 0, shapes: [], totals: {}, settings: {}, created_at: '2026-01-01T00:00:00Z' },
        { id: 'm-theirs', org_id: OTHER, customer_id: 'c1', property_id: null, lawn_sqft: 9, bed_sqft: 0, cutout_sqft: 0, line_feet: 0, shapes: [], totals: {}, settings: {}, created_at: '2026-02-01T00:00:00Z' },
      ],
    })
    const body = (await (await route.GET(get('customer_id=c1'))).json()) as { rows: Array<{ id: string }> }
    expect(body.rows.map((r) => r.id)).toEqual(['m-mine'])
    expect((await route.GET(get('customer_id=cx'))).status).toBe(404)
  })
  it('a different company never saves into this one through a forged origin', async () => {
    expect((await route.POST(post({ customerId: 'c1', shapes: [lawn] }, { origin: 'https://evil.test', host: 'crm.test' }))).status).toBe(403)
    expect((await route.POST(post({ customerId: 'c1', shapes: [lawn] }, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
    expect(saved()).toHaveLength(0)
  })
})

describe('permissions', () => {
  it('a closer saves on a deal they own, and cannot open anyone else\'s', async () => {
    viewer = baseViewer({ closerLike: true })
    expect((await route.POST(post({ opportunityId: 'd1', shapes: [lawn] }))).status).toBe(201)
    expect((await route.POST(post({ opportunityId: 'd2', shapes: [lawn] }))).status).toBe(404)
    expect((await route.POST(post({ customerId: 'c2', shapes: [lawn] }))).status).toBe(404)
    expect((await route.GET(get('customer_id=c2'))).status).toBe(404)
    expect(saved()).toHaveLength(1)
  })
  it('a setter (field role) may look at a deal they set but never save', async () => {
    seed()
    db.tables.opportunities.find((o) => o.id === 'd1')!.setter_user_id = 'u-me'
    db.tables.opportunities.find((o) => o.id === 'd1')!.owner_user_id = 'u-else'
    viewer = baseViewer({ setterLike: true })
    expect((await route.GET(get('opportunity_id=d1'))).status).toBe(200)
    const res = await route.POST(post({ opportunityId: 'd1', shapes: [lawn] }))
    expect(res.status).toBe(403)
    expect(saved()).toHaveLength(0)
  })
  it('inside sales and pricing-barred roles cannot save either', async () => {
    viewer = baseViewer({ jobBoard: true, insideSales: true })
    expect((await route.POST(post({ customerId: 'c1', shapes: [lawn] }))).status).toBe(403)
    viewer = baseViewer({ jobBoard: true, pricingBarred: true })
    expect((await route.POST(post({ customerId: 'c1', shapes: [lawn] }))).status).toBe(403)
  })
  it('a lead is for its owner and company-wide viewers', async () => {
    viewer = baseViewer({ closerLike: true })
    expect((await route.POST(post({ leadId: 'l-2', shapes: [lawn] }))).status).toBe(404)
    expect((await route.POST(post({ leadId: 'l-1', shapes: [lawn] }))).status).toBe(201)
    viewer = baseViewer({ managerLike: true })
    expect((await route.POST(post({ leadId: 'l-2', shapes: [lawn] }))).status).toBe(201)
  })
  it("a customer's access does not open someone else's lead named beside it", async () => {
    viewer = baseViewer({ closerLike: true })
    expect((await route.POST(post({ customerId: 'c1', leadId: 'l-2', shapes: [lawn] }))).status).toBe(404)
    expect(saved()).toHaveLength(0)
  })
  it('a job-board person who is not an owner may save for any customer of the company', async () => {
    viewer = baseViewer({ jobBoard: true })
    expect((await route.POST(post({ customerId: 'c2', shapes: [lawn] }))).status).toBe(201)
  })
})

describe('company materials settings', () => {
  it('anyone who can use the tool reads them; only an owner changes them', async () => {
    const read = (await (await settingsRoute.GET()).json()) as { settings: unknown; canEdit: boolean }
    expect(read).toEqual({ settings: { mulchDepthIn: 4, strawSqftPerBale: 40 }, canEdit: false })
    expect((await settingsRoute.PATCH(patch({ mulchDepthIn: 2 }))).status).toBe(403)
    expect(db.tables.orgs[0].settings).toEqual({ areaMeasure: { mulchDepthIn: 4, strawSqftPerBale: 40 } })
  })
  it('an owner saves one key and the rest of the company settings are untouched', async () => {
    superAdmin = true
    db.tables.orgs[0].settings = { areaMeasure: { mulchDepthIn: 4, strawSqftPerBale: 40 }, brand: { shortName: 'Keep me' } }
    const res = await settingsRoute.PATCH(patch({ mulchDepthIn: 2.5 }))
    expect(res.status).toBe(200)
    expect(db.tables.orgs[0].settings).toEqual({ areaMeasure: { mulchDepthIn: 2.5, strawSqftPerBale: 40 }, brand: { shortName: 'Keep me' } })
    // the other company is never touched
    expect(db.tables.orgs[1].settings).toEqual({})
    // the next save uses the new number
    await route.POST(post({ customerId: 'c1', shapes: [bed] }))
    expect(saved()[0].settings).toEqual({ mulchDepthIn: 2.5, strawSqftPerBale: 40 })
  })
  it('refuses out-of-range, unknown and forged requests', async () => {
    superAdmin = true
    expect((await settingsRoute.PATCH(patch({ mulchDepthIn: 40 }))).status).toBe(400)
    expect((await settingsRoute.PATCH(patch({ price: 1 }))).status).toBe(400)
    expect((await settingsRoute.PATCH(patch({}))).status).toBe(400)
    expect((await settingsRoute.PATCH(patch({ mulchDepthIn: 2 }, { origin: 'https://evil.test', host: 'crm.test' }))).status).toBe(403)
    featureOn = false
    expect((await settingsRoute.PATCH(patch({ mulchDepthIn: 2 }))).status).toBe(404)
  })
})
