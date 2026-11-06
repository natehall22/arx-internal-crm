/** @jest-environment node */
/**
 * /api/admin/user-permissions — one auth door (requireAuthApi), the same roles for read and write,
 * and the target user must be in the caller's org.
 */
import { NextRequest } from 'next/server'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

let authResult: unknown = null
jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(async () => {
    if (!authResult) throw new Error('Unauthorized')
    return authResult
  }),
}))
jest.mock('@/lib/money-permission-guard', () => ({
  actorIsOwner: jest.fn(async () => true),
  moneyPermissionIds: jest.fn(async () => new Set<string>()),
  lockMoneyPermissions: (next: string[]) => next,
}))

let db: ReturnType<typeof createFakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { GET, PUT } from '@/app/api/admin/user-permissions/route'

const as = (id: string, role: string, org = 'org-a') => ({
  authUser: { id, email: null },
  profile: { id, org_id: org, role },
})
const get = (userId: string) =>
  GET(new NextRequest(`https://crm.example/api/admin/user-permissions?userId=${userId}`))
const put = (body: unknown) =>
  PUT(
    new NextRequest('https://crm.example/api/admin/user-permissions', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  )

beforeEach(() => {
  authResult = as('u-admin', 'admin')
  db = createFakeDb({
    users: [
      { id: 'u-admin', org_id: 'org-a', role: 'admin' },
      { id: 'u-rep', org_id: 'org-a', role: 'sales_rep' },
      { id: 'u-other', org_id: 'org-b', role: 'sales_rep' },
    ],
    user_permissions: [
      { user_id: 'u-rep', org_id: 'org-a', permission_id: 'p1' },
      { user_id: 'u-other', org_id: 'org-b', permission_id: 'p9' },
    ],
  })
})

describe('GET', () => {
  test('no session → 401', async () => {
    authResult = null
    expect((await get('u-rep')).status).toBe(401)
  })
  test('a non-admin role → 403 (was readable by any signed-in user)', async () => {
    authResult = as('u-rep', 'sales_rep')
    expect((await get('u-rep')).status).toBe(403)
  })
  test('a user in another org → 404, no ids returned', async () => {
    const res = await get('u-other')
    expect(res.status).toBe(404)
    expect(JSON.stringify(await res.json())).not.toContain('p9')
  })
  test('admin and regional_manager read a same-org user', async () => {
    for (const role of ['admin', 'regional_manager']) {
      authResult = as('u-admin', role)
      const res = await get('u-rep')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ permission_ids: ['p1'] })
    }
  })
})

describe('PUT', () => {
  test('no session → 401, non-admin → 403, nothing written', async () => {
    authResult = null
    expect((await put({ user_id: 'u-rep', permission_ids: ['p2'] })).status).toBe(401)
    authResult = as('u-rep', 'sales_rep')
    expect((await put({ user_id: 'u-rep', permission_ids: ['p2'] })).status).toBe(403)
    expect(db.writes).toEqual([])
  })
  test('a user in another org → 404, nothing written', async () => {
    expect((await put({ user_id: 'u-other', permission_ids: ['p2'] })).status).toBe(404)
    expect(db.writes).toEqual([])
  })
  test('same-org save still replaces the grants', async () => {
    const res = await put({ user_id: 'u-rep', permission_ids: ['p2'] })
    expect(res.status).toBe(200)
    expect(db.tables.user_permissions.filter((r) => r.user_id === 'u-rep')).toEqual([
      expect.objectContaining({ org_id: 'org-a', permission_id: 'p2', granted_by: 'u-admin' }),
    ])
  })
})
