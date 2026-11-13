/** @jest-environment node */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

let signedIn = true
let profile: Record<string, unknown> = { id: 'u1', org_id: 'org-1', role: 'admin', is_super_admin: true, active: true }
let ops = { canJobBoard: true, canEditJobs: true }
let customerEdit = true

const state = {
  db: createFakeDb({}),
}
function reset() {
  state.db = createFakeDb(
    {
      orgs: [{ id: 'org-1', settings: {} }],
      customers: [{ id: 'c1', org_id: 'org-1', category: null, name: 'A' }, { id: 'cx', org_id: 'org-2', category: null }],
      production_jobs: [
        { id: 'j1', org_id: 'org-1', customer_id: 'c1', category: null },
        { id: 'jx', org_id: 'org-2', customer_id: 'cx', category: null },
      ],
    },
    {
      rpc: {
        merge_org_settings: (args, tables) => {
          const org = tables.orgs.find((o) => o.id === args.p_org_id)!
          const path = args.p_path as string[]
          org.settings = { ...(org.settings as object), [path[0]]: { ...(args.p_set as object) } }
          return { data: null, error: null }
        },
      },
    }
  )
}

jest.mock('@/lib/auth', () => ({
  requireAuthApi: async () => {
    if (!signedIn) throw new Error('nope')
    return { authUser: { id: 'u1' }, profile }
  },
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => state.db.client }))
jest.mock('@/lib/ops-access', () => ({ resolveOpsAccess: async () => ops }))
jest.mock('@/lib/effective-permissions', () => ({ resolveEffectivePermissionNames: async () => [] }))
jest.mock('@/lib/permissions', () => ({
  canEditCustomerRecordsFromPermissionNames: () => customerEdit,
  isRepLikeCustomerRecordRole: () => false,
  canAccessCustomerRecordsFromPermissionNames: () => true,
}))
jest.mock('@/lib/customer-file/customer-read', () => ({ loadCustomerForCaller: async () => ({ ok: false, status: 404 }) }))

import { GET, POST } from '@/app/api/categories/route'
import { GET as JOB_GET, PATCH as JOB_PATCH } from '@/app/api/ops/jobs/[id]/category/route'
import { PATCH as CUSTOMER_PATCH } from '@/app/api/customers/[id]/route'

const json = (body: unknown) => new Request('https://crm.example/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const params = (id: string) => ({ params: { id } })

beforeEach(() => {
  signedIn = true
  profile = { id: 'u1', org_id: 'org-1', role: 'admin', is_super_admin: true, active: true }
  ops = { canJobBoard: true, canEditJobs: true }
  customerEdit = true
  reset()
})

describe('/api/categories', () => {
  it('signed out: 401 on both', async () => {
    signedIn = false
    expect((await GET()).status).toBe(401)
    expect((await POST(json({ action: 'add', label: 'X' }))).status).toBe(401)
  })
  it('any signed-in role reads the list (field roles see the category)', async () => {
    profile = { id: 'u2', org_id: 'org-1', role: 'setter', is_super_admin: false, active: true }
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).categories.map((c: { slug: string }) => c.slug)).toEqual(['residential', 'commercial', 'new_build'])
  })
  it('only an owner (super admin) edits the list — role admin is not enough', async () => {
    profile = { id: 'u2', org_id: 'org-1', role: 'admin', is_super_admin: false, active: true }
    expect((await POST(json({ action: 'add', label: 'Multi family' }))).status).toBe(403)
    profile = { id: 'u1', org_id: 'org-1', role: 'admin', is_super_admin: true, active: true }
    const res = await POST(json({ action: 'add', label: 'Multi family' }))
    expect(res.status).toBe(200)
    expect((await res.json()).categories.map((c: { slug: string }) => c.slug)).toContain('multi_family')
    expect((await POST(json({ action: 'add', label: 'multi family' }))).status).toBe(409)
    expect((await POST(json({}))).status).toBe(400)
  })
})

describe('job category route', () => {
  it('needs the job board to read and job edit to change', async () => {
    ops = { canJobBoard: false, canEditJobs: false }
    expect((await JOB_GET(new Request('https://x'), params('j1'))).status).toBe(403)
    ops = { canJobBoard: true, canEditJobs: false }
    const g = await JOB_GET(new Request('https://x'), params('j1'))
    expect(g.status).toBe(200)
    expect((await g.json()).canEdit).toBe(false)
    expect((await JOB_PATCH(json({ category: 'commercial' }), params('j1'))).status).toBe(403)
  })
  it('override and clear; effective = job ?? customer', async () => {
    await CUSTOMER_PATCH(json({ category: 'residential' }), params('c1'))
    expect((await (await JOB_GET(new Request('https://x'), params('j1'))).json())).toMatchObject({ jobCategory: null, customerCategory: 'residential', effective: 'residential' })
    expect((await JOB_PATCH(json({ category: 'new_build' }), params('j1'))).status).toBe(200)
    expect((await (await JOB_GET(new Request('https://x'), params('j1'))).json())).toMatchObject({ jobCategory: 'new_build', effective: 'new_build' })
    expect((await JOB_PATCH(json({ category: null }), params('j1'))).status).toBe(200)
    expect((await (await JOB_GET(new Request('https://x'), params('j1'))).json()).effective).toBe('residential')
  })
  it('bad slug 400, missing body 400, another company’s job 404', async () => {
    expect((await JOB_PATCH(json({ category: 'spa' }), params('j1'))).status).toBe(400)
    expect((await JOB_PATCH(json({}), params('j1'))).status).toBe(400)
    expect((await JOB_PATCH(json({ category: 'commercial' }), params('jx'))).status).toBe(404)
    expect((await JOB_GET(new Request('https://x'), params('jx'))).status).toBe(404)
  })
})

describe('PATCH /api/customers/[id] category', () => {
  it('sets only the category (no other field needed) and clears it', async () => {
    const res = await CUSTOMER_PATCH(json({ category: 'commercial' }), params('c1'))
    expect(res.status).toBe(200)
    expect((await res.json()).customer.category).toBe('commercial')
    expect(state.db.tables.customers.find((c) => c.id === 'c1')?.category).toBe('commercial')
    await CUSTOMER_PATCH(json({ category: '' }), params('c1'))
    expect(state.db.tables.customers.find((c) => c.id === 'c1')?.category).toBeNull()
  })
  it('refused without customer-edit access, for an unknown slug, and for another company’s customer', async () => {
    customerEdit = false
    expect((await CUSTOMER_PATCH(json({ category: 'commercial' }), params('c1'))).status).toBe(403)
    customerEdit = true
    expect((await CUSTOMER_PATCH(json({ category: 'spa' }), params('c1'))).status).toBe(400)
    expect((await CUSTOMER_PATCH(json({ category: 'commercial' }), params('cx'))).status).toBe(404)
  })
})
