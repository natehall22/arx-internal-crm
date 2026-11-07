/** @jest-environment node */
/**
 * /api/permissions grant/revoke — writes go through the service client (RLS writes are admin/owner only), so the
 * route's own checks are the gate: role, owner-only money permissions, same-org target user.
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
let ownerActor = true
jest.mock('@/lib/money-permission-guard', () => ({
  actorIsOwner: jest.fn(async () => ownerActor),
  isMoneyPermissionName: (n: string) => n === 'reports:financials' || n === 'money:record',
}))
jest.mock('@/lib/effective-permissions', () => ({ resolveEffectivePermissionNames: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({
  createClient: () => {
    throw new Error('user-scoped client must not be used for permission writes')
  },
}))

let db: ReturnType<typeof createFakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { POST, DELETE } from '@/app/api/permissions/route'

const as = (id: string, role: string, org = 'org-a') => ({
  authUser: { id, email: null },
  profile: { id, org_id: org, role },
})
const grant = (body: unknown) =>
  POST(
    new NextRequest('https://crm.example/api/permissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
const revoke = (userId: string, name: string) =>
  DELETE(
    new NextRequest(`https://crm.example/api/permissions?user_id=${userId}&permission_name=${name}`, {
      method: 'DELETE',
    })
  )

beforeEach(() => {
  ownerActor = true
  authResult = as('u-rm', 'regional_manager')
  db = createFakeDb({
    permissions: [
      { id: 'p-leads', name: 'leads:view' },
      { id: 'p-fin', name: 'reports:financials' },
    ],
    users: [
      { id: 'u-rm', org_id: 'org-a', role: 'regional_manager' },
      { id: 'u-rep', org_id: 'org-a', role: 'sales_rep' },
      { id: 'u-other', org_id: 'org-b', role: 'sales_rep' },
    ],
    user_permissions: [
      { user_id: 'u-rep', org_id: 'org-a', permission_id: 'p-leads' },
      { user_id: 'u-other', org_id: 'org-b', permission_id: 'p-leads' },
    ],
  })
})

test('no session → 401', async () => {
  authResult = null
  expect((await grant({ user_id: 'u-rep', permission_name: 'leads:view' })).status).toBe(401)
})

test('a setter manager cannot grant', async () => {
  authResult = as('u-sm', 'setter_manager')
  expect((await grant({ user_id: 'u-rep', permission_name: 'leads:view' })).status).toBe(403)
})

test('a regional manager still grants in their own org through the service client', async () => {
  db.tables.user_permissions = []
  const res = await grant({ user_id: 'u-rep', permission_name: 'leads:view' })
  expect(res.status).toBe(200)
  expect(db.tables.user_permissions).toEqual([
    expect.objectContaining({ user_id: 'u-rep', org_id: 'org-a', permission_id: 'p-leads', granted_by: 'u-rm' }),
  ])
})

test('target user in another org → 404 and nothing written', async () => {
  const before = db.tables.user_permissions.length
  expect((await grant({ user_id: 'u-other', permission_name: 'leads:view' })).status).toBe(404)
  expect(db.tables.user_permissions.length).toBe(before)
  expect((await revoke('u-other', 'leads:view')).status).toBe(404)
  expect(db.tables.user_permissions.some((r) => r.user_id === 'u-other')).toBe(true)
})

test('money permissions stay owner-only', async () => {
  ownerActor = false
  expect((await grant({ user_id: 'u-rep', permission_name: 'reports:financials' })).status).toBe(403)
  expect((await revoke('u-rep', 'reports:financials')).status).toBe(403)
})

test('revoke removes only the caller-org row', async () => {
  expect((await revoke('u-rep', 'leads:view')).status).toBe(200)
  expect(db.tables.user_permissions).toEqual([
    expect.objectContaining({ user_id: 'u-other', org_id: 'org-b' }),
  ])
})
