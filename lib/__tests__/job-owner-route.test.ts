/** @jest-environment node */
/**
 * Explicit job owner: one write path (PUT /api/ops/jobs/[id]/owner), gated on the existing jobs:edit check; owners are
 * active office / production people only; works (409, no 500) before the owner migration is applied.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

let profile: Record<string, unknown> | null = null
let canEditJobs = true
let ownerColumnMissing = false
let fake = createFakeDb({})

jest.mock('@/lib/auth', () => ({
  requireAuthApi: async () => {
    if (!profile) throw new Error('no session')
    return { authUser: { id: profile.id }, profile }
  },
}))
jest.mock('@/lib/ops-access', () => ({ resolveOpsAccess: async () => ({ canEditJobs }) }))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const c = fake.client as unknown as { from: (t: string) => Record<string, unknown> }
    return {
      ...(fake.client as object),
      from: (t: string) => {
        const b = c.from(t)
        if (t !== 'production_jobs' || !ownerColumnMissing) return b
        return { ...b, update: () => ({ eq: () => ({ eq: async () => ({ error: { code: '42703', message: 'column "owner_user_id" of relation "production_jobs" does not exist' } }) }) }) }
      },
    }
  },
}))

import { GET, PUT } from '@/app/api/ops/jobs/[id]/owner/route'
import { isJobOwnerCandidate } from '@/lib/job-owner'

const ORG = 'org-1'
const put = (userId: unknown, id = 'j1') => PUT(new Request('http://x/api/ops/jobs/j1/owner', { method: 'PUT', body: JSON.stringify({ userId }) }), { params: { id } })
const job = () => fake.tables.production_jobs.find((j) => j.id === 'j1')!

beforeEach(() => {
  profile = { id: 'ops1', org_id: ORG, role: 'operations' }
  canEditJobs = true
  ownerColumnMissing = false
  fake = createFakeDb({
    production_jobs: [{ id: 'j1', org_id: ORG, owner_user_id: null }, { id: 'j-other', org_id: 'org-2', owner_user_id: null }],
    users: [
      { id: 'steve', org_id: ORG, full_name: 'Steve Potts', role: 'operations', active: true, custom_role_id: null },
      { id: 'andrew', org_id: ORG, full_name: 'Andrew Waltz', role: 'admin', active: true, custom_role_id: null },
      { id: 'closer', org_id: ORG, full_name: 'Casey Closer', role: 'closer', active: true, custom_role_id: null },
      { id: 'setter', org_id: ORG, full_name: 'Sam Setter', role: 'setter', active: true, custom_role_id: null },
      { id: 'custom-setter', org_id: ORG, full_name: 'Cus Tom', role: 'custom', active: true, custom_role_id: 'cr1' },
      { id: 'gone', org_id: ORG, full_name: 'Gone Person', role: 'operations', active: false, custom_role_id: null },
      { id: 'elsewhere', org_id: 'org-2', full_name: 'Other Org', role: 'operations', active: true, custom_role_id: null },
    ],
    custom_roles: [{ id: 'cr1', org_id: ORG, name: 'door_setter', display_name: 'Door Setter' }],
  })
})

describe('who can set the owner (existing jobs:edit gate)', () => {
  it('no session → 401; no jobs:edit (field roles never have it) → 403; nothing written', async () => {
    profile = null
    expect((await put('steve')).status).toBe(401)
    expect((await GET()).status).toBe(401)
    profile = { id: 's', org_id: ORG, role: 'setter' }
    canEditJobs = false
    expect((await put('steve')).status).toBe(403)
    expect((await GET()).status).toBe(403)
    expect(job().owner_user_id).toBeNull()
  })

  it('jobs:edit → sets and clears the owner', async () => {
    const res = await put('steve')
    expect(res.status).toBe(200)
    expect(job().owner_user_id).toBe('steve')
    expect((await put(null)).status).toBe(200)
    expect(job().owner_user_id).toBeNull()
  })
})

describe('who can be the owner', () => {
  it('the picker lists active office / production people of this org only', async () => {
    const body = await (await GET()).json()
    expect(body.candidates).toEqual([{ id: 'andrew', name: 'Andrew Waltz' }, { id: 'steve', name: 'Steve Potts' }])
  })
  it.each(['closer', 'setter', 'custom-setter', 'gone', 'elsewhere', 'nobody'])('%s is refused (400)', async (id) => {
    expect((await put(id)).status).toBe(400)
    expect(job().owner_user_id).toBeNull()
  })
  it('role rule', () => {
    expect(isJobOwnerCandidate({ role: 'operations' })).toBe(true)
    expect(isJobOwnerCandidate({ role: 'custom', customRoleName: 'Setter Manager' })).toBe(true)
    for (const role of ['closer', 'sales_rep', 'setter', 'canvasser', 'inside_sales', 'call_center', 'sub', '']) expect(isJobOwnerCandidate({ role })).toBe(false)
    expect(isJobOwnerCandidate({ role: 'admin', active: false })).toBe(false)
  })
})

it('a job in another org is not found', async () => {
  expect((await put('steve', 'j-other')).status).toBe(404)
})

it('bad body → 400', async () => {
  expect((await PUT(new Request('http://x', { method: 'PUT', body: '{}' }), { params: { id: 'j1' } })).status).toBe(400)
  expect((await put(42)).status).toBe(400)
})

it('before the owner migration: 409 with a plain message, never a 500', async () => {
  ownerColumnMissing = true
  const res = await put('steve')
  expect(res.status).toBe(409)
  expect((await res.json()).error).toMatch(/not switched on yet/)
})
