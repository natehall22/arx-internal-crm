/** @jest-environment node */
/**
 * Routes for properties, customer documents and custom fields, against the in-memory fake DB: who may read / write,
 * company fence (another company's ids are 404), field-role rules, and what lands in the tables.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import type { ThreadViewer } from '@/lib/threads/visibility'

const ORG = 'org-1'
const OTHER = 'org-2'
let viewer: ThreadViewer
let superAdmin = false
let db: ReturnType<typeof createFakeDb>
const rpcCalls: Array<Record<string, unknown>> = []
const uploads: string[] = []
const removed: string[][] = []

const baseViewer = (over: Partial<ThreadViewer> = {}): ThreadViewer => ({
  userId: 'u-me', orgId: ORG, ownerLike: false, jobBoard: false, jobEdit: false, jobFinancials: false, managerLike: false,
  closerLike: false, setterLike: false, pricingBarred: false, insideSales: false, ...over,
})

function seed() {
  rpcCalls.length = 0
  uploads.length = 0
  removed.length = 0
  db = createFakeDb(
    {
      customers: [
        { id: 'c1', org_id: ORG, name: 'Ann', custom_fields: {} },
        { id: 'cx', org_id: OTHER, name: 'Other co', custom_fields: {} },
      ],
      opportunities: [
        { id: 'd1', org_id: ORG, customer_id: 'c1', owner_user_id: 'u-closer', setter_user_id: 'u-setter' },
      ],
      properties: [
        { id: 'p1', org_id: ORG, customer_id: 'c1', label: null, address_line1: '5 Elm', city: 'Tallahassee', state: 'FL', zip: '32301', address_text: '5 Elm, Tallahassee, FL 32301', access_notes: 'Gate 4421', active: true, source: 'manual', custom_fields: { 'f-prop-office': 'office only', 'f-prop-all': 'everyone' } },
        { id: 'px', org_id: OTHER, customer_id: 'cx', address_text: '1 Other', active: true, source: 'manual', custom_fields: {} },
      ],
      production_jobs: [{ id: 'j1', org_id: ORG, customer_id: 'c1', custom_fields: {} }, { id: 'jx', org_id: OTHER, customer_id: 'cx' }],
      custom_field_definitions: [
        { id: 'f-cust', org_id: ORG, entity: 'customer', label: 'Gate code', field_type: 'text', options: [], required: false, sort: 10, active: true },
        { id: 'f-job', org_id: ORG, entity: 'job', label: 'Crew size', field_type: 'number', options: [], required: true, sort: 10, active: true },
        { id: 'f-prop-office', org_id: ORG, entity: 'property', label: 'Office note', field_type: 'text', options: [], required: false, sort: 10, active: true, visible_to_field: false },
        { id: 'f-prop-all', org_id: ORG, entity: 'property', label: 'Crew note', field_type: 'text', options: [], required: false, sort: 20, active: true, visible_to_field: true },
        { id: 'f-other', org_id: OTHER, entity: 'customer', label: 'Theirs', field_type: 'text', options: [], required: false, sort: 10, active: true },
      ],
      documents: [],
      scheduled_appointments: [],
    },
    {
      rpc: {
        set_custom_field_values: (args, tables) => {
          rpcCalls.push(args)
          const t = args.p_entity === 'customer' ? 'customers' : args.p_entity === 'property' ? 'properties' : 'production_jobs'
          const row = tables[t].find((r) => r.id === args.p_id && r.org_id === args.p_org)
          if (!row) return null
          const next = { ...(row.custom_fields as Record<string, unknown>) }
          for (const k of (args.p_remove as string[]) ?? []) delete next[k]
          Object.assign(next, args.p_set)
          row.custom_fields = next
          return next
        },
      },
    }
  )
  const client = db.client as unknown as Record<string, unknown>
  client.storage = {
    from: () => ({
      createSignedUploadUrl: async (path: string) => {
        uploads.push(path)
        return { data: { token: 'tok' }, error: null }
      },
      list: async (folder: string, opts: { search?: string }) => ({
        data: [{ name: `${opts?.search ?? ''}contract.pdf`, metadata: { size: 10, mimetype: 'application/pdf' } }],
        error: null,
        folder,
      }),
      remove: async (paths: string[]) => {
        removed.push(paths)
        return { error: null }
      },
      createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed/${path}` }, error: null }),
    }),
  }
}

jest.mock('@/lib/threads/api', () => {
  const actual = jest.requireActual('@/lib/threads/api')
  return {
    ...actual,
    threadAuth: async () => ({ admin: db.client, profile: { id: viewer.userId, org_id: viewer.orgId, role: 'x' }, viewer }),
  }
})
jest.mock('@/lib/auth', () => ({
  requireAuthApi: async () => ({ profile: { id: 'u-me', org_id: ORG, role: 'admin', is_super_admin: superAdmin } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import * as propertiesRoute from '@/app/api/customers/[id]/properties/route'
import * as propertyRoute from '@/app/api/properties/[id]/route'
import * as valuesRoute from '@/app/api/custom-fields/values/route'
import * as adminRoute from '@/app/api/admin/custom-fields/route'
import * as docsRoute from '@/app/api/customers/[id]/documents/route'
import * as finalizeRoute from '@/app/api/customers/[id]/documents/finalize/route'
import * as downloadRoute from '@/app/api/customers/[id]/documents/[documentId]/download/route'

const json = (method: string, body?: unknown) =>
  new Request('https://crm.test/x', { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

beforeEach(() => {
  seed()
  superAdmin = false
  viewer = baseViewer({ managerLike: true })
})

describe('properties', () => {
  it('manager lists the customer’s properties with access notes; another company’s customer is 404', async () => {
    const res = await propertiesRoute.GET(json('GET'), { params: { id: 'c1' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.properties.map((p: { id: string }) => p.id)).toEqual(['p1'])
    expect(body.properties[0].access_notes).toBe('Gate 4421')
    expect(body.properties[0].custom_fields).toEqual({ 'f-prop-office': 'office only', 'f-prop-all': 'everyone' })
    expect((await propertiesRoute.GET(json('GET'), { params: { id: 'cx' } })).status).toBe(404)
  })

  it('setter on their own deal sees the property without access notes and cannot add', async () => {
    viewer = baseViewer({ userId: 'u-setter', setterLike: true, pricingBarred: true })
    const body = await (await propertiesRoute.GET(json('GET'), { params: { id: 'c1' } })).json()
    expect(body.properties[0].access_notes).toBeNull()
    expect(body.properties[0].custom_fields).toEqual({ 'f-prop-all': 'everyone' })
    expect(body.canEdit).toBe(false)
    expect((await propertiesRoute.POST(json('POST', { address_line1: '9 Pine' }), { params: { id: 'c1' } })).status).toBe(403)
  })

  it('a closer with no deal for the customer gets 404', async () => {
    viewer = baseViewer({ userId: 'u-stranger', closerLike: true })
    expect((await propertiesRoute.GET(json('GET'), { params: { id: 'c1' } })).status).toBe(404)
  })

  it('add: stamped with the company and customer, address line built', async () => {
    const res = await propertiesRoute.POST(json('POST', { label: 'Office', address_line1: '9 Pine', city: 'Crawfordville', state: 'FL', zip: '32327', org_id: OTHER, customer_id: 'cx' }), { params: { id: 'c1' } })
    expect(res.status).toBe(201)
    const row = db.tables.properties.find((p) => p.label === 'Office')!
    expect(row).toMatchObject({ org_id: ORG, customer_id: 'c1', address_text: '9 Pine, Crawfordville, FL 32327', source: 'manual', created_by: 'u-me' })
  })

  it('edit / turn off; another company’s property is 404 and untouched', async () => {
    const res = await propertyRoute.PATCH(json('PATCH', { active: false }), { params: { id: 'p1' } })
    expect(res.status).toBe(200)
    expect(db.tables.properties.find((p) => p.id === 'p1')!.active).toBe(false)
    expect((await propertyRoute.PATCH(json('PATCH', { label: 'mine now' }), { params: { id: 'px' } })).status).toBe(404)
    expect(db.tables.properties.find((p) => p.id === 'px')!.label).toBeUndefined()
  })
})

describe('custom field values', () => {
  it('customer: validated, merged through the SQL function for this company only', async () => {
    const res = await valuesRoute.PATCH(json('PATCH', { entity: 'customer', id: 'c1', values: { 'f-cust': ' 4421 ' } }))
    expect(res.status).toBe(200)
    expect(rpcCalls).toEqual([{ p_entity: 'customer', p_org: ORG, p_id: 'c1', p_set: { 'f-cust': '4421' }, p_remove: [] }])
  })
  it('another company’s field id or record is refused', async () => {
    expect((await valuesRoute.PATCH(json('PATCH', { entity: 'customer', id: 'c1', values: { 'f-other': 'x' } }))).status).toBe(400)
    expect((await valuesRoute.PATCH(json('PATCH', { entity: 'customer', id: 'cx', values: { 'f-cust': 'x' } }))).status).toBe(404)
    expect(rpcCalls).toEqual([])
  })
  it('job: needs jobs:edit (or owner); field roles get 404; required is enforced', async () => {
    viewer = baseViewer({ jobBoard: true })
    expect((await valuesRoute.PATCH(json('PATCH', { entity: 'job', id: 'j1', values: { 'f-job': 3 } }))).status).toBe(403)
    viewer = baseViewer({ setterLike: true, pricingBarred: true })
    expect((await valuesRoute.PATCH(json('PATCH', { entity: 'job', id: 'j1', values: { 'f-job': 3 } }))).status).toBe(404)
    viewer = baseViewer({ jobBoard: true, jobEdit: true })
    const bad = await valuesRoute.PATCH(json('PATCH', { entity: 'job', id: 'j1', values: { 'f-job': '' } }))
    expect(bad.status).toBe(400)
    expect((await bad.json()).fieldId).toBe('f-job')
    expect((await valuesRoute.PATCH(json('PATCH', { entity: 'job', id: 'j1', values: { 'f-job': '4' } }))).status).toBe(200)
    expect(db.tables.production_jobs.find((j) => j.id === 'j1')!.custom_fields).toEqual({ 'f-job': 4 })
  })
  it('bad entity is a 400', async () => {
    expect((await valuesRoute.PATCH(json('PATCH', { entity: 'users', id: 'c1', values: {} }))).status).toBe(400)
  })
})

describe('Settings → Custom fields (owners only)', () => {
  it('non-owners are refused', async () => {
    expect((await adminRoute.GET()).status).toBe(403)
    expect((await adminRoute.POST(json('POST', { action: 'add', entity: 'job', label: 'X', field_type: 'text' }))).status).toBe(403)
  })
  it('owner: list is this company’s only; add / rules', async () => {
    superAdmin = true
    const list = await (await adminRoute.GET()).json()
    expect(list.definitions.map((d: { id: string }) => d.id).sort()).toEqual(['f-cust', 'f-job', 'f-prop-all', 'f-prop-office'])
    expect((await adminRoute.POST(json('POST', { action: 'update', id: 'f-job', visible_to_field: true }))).status).toBe(400)
    expect((await adminRoute.POST(json('POST', { action: 'update', id: 'f-cust', visible_to_field: true }))).status).toBe(200)
    expect((await adminRoute.POST(json('POST', { action: 'add', entity: 'property', label: 'Mow day', field_type: 'dropdown', options: [] }))).status).toBe(400)
    expect((await adminRoute.POST(json('POST', { action: 'add', entity: 'customer', label: 'gate CODE', field_type: 'text' }))).status).toBe(409)
    const ok = await adminRoute.POST(json('POST', { action: 'add', entity: 'property', label: 'Mow day', field_type: 'dropdown', options: ['Mon', 'Tue', 'mon'] }))
    expect(ok.status).toBe(200)
    expect(db.tables.custom_field_definitions.find((d) => d.label === 'Mow day')).toMatchObject({ org_id: ORG, options: ['Mon', 'Tue'], active: true })
    expect((await adminRoute.POST(json('POST', { action: 'update', id: 'f-other', label: 'hijack' }))).status).toBe(404)
    expect((await adminRoute.POST(json('POST', { action: 'update', id: 'f-cust', options: ['a'] }))).status).toBe(400)
    expect((await adminRoute.POST(json('POST', { action: 'reorder', entity: 'job', order: ['nope'] }))).status).toBe(400)
    expect((await adminRoute.POST(json('POST', { action: 'setActive', id: 'f-job', active: false }))).status).toBe(200)
    expect(db.tables.custom_field_definitions.find((d) => d.id === 'f-job')!.active).toBe(false)
  })
})

describe('customer documents', () => {
  it('register → finalize writes a job-less document under the customer’s folder, with the property', async () => {
    const reg = await docsRoute.POST(json('POST', { filename: 'Service agreement.pdf', propertyId: 'p1' }), { params: { id: 'c1' } })
    expect(reg.status).toBe(200)
    const { documentId, storagePath } = await reg.json()
    expect(storagePath).toBe(`${ORG}/customers/c1/documents/${documentId}_Service_agreement.pdf`)
    const fin = await finalizeRoute.POST(json('POST', { documentId, category: 'contract', title: 'Service agreement', propertyId: 'p1' }), { params: { id: 'c1' } })
    expect(fin.status).toBe(201)
    expect(db.tables.documents[0]).toMatchObject({ id: documentId, org_id: ORG, job_id: null, customer_id: 'c1', property_id: 'p1', category: 'contract', status: 'active' })
    const list = await (await docsRoute.GET(json('GET'), { params: { id: 'c1' } })).json()
    expect(list.documents.map((d: { id: string }) => d.id)).toEqual([documentId])
    const dl = await downloadRoute.GET(json('GET'), { params: { id: 'c1', documentId } })
    expect(dl.status).toBe(302)
  })
  it('another customer’s property, pricing-barred roles and other companies are refused', async () => {
    expect((await docsRoute.POST(json('POST', { filename: 'a.pdf', propertyId: 'px' }), { params: { id: 'c1' } })).status).toBe(400)
    expect((await docsRoute.POST(json('POST', { filename: 'a.pdf' }), { params: { id: 'cx' } })).status).toBe(404)
    viewer = baseViewer({ userId: 'u-setter', setterLike: true, pricingBarred: true })
    expect((await docsRoute.GET(json('GET'), { params: { id: 'c1' } })).status).toBe(404)
    expect(uploads).toEqual([])
  })
  it('a document id from another customer is not downloadable here', async () => {
    db.tables.documents.push({ id: '11111111-1111-1111-1111-111111111111', org_id: ORG, customer_id: 'c2', job_id: null, storage_path: 'x', deleted_at: null })
    expect((await downloadRoute.GET(json('GET'), { params: { id: 'c1', documentId: '11111111-1111-1111-1111-111111111111' } })).status).toBe(404)
  })
})
