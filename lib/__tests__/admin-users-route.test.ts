/** @jest-environment node */
/**
 * /api/admin/users — managers cannot make anyone (themselves included) an admin, cannot touch admins, cannot
 * switch themselves off, and every role/team/region/manager id must be in the caller's org (security audit H1).
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
jest.mock('@/lib/setter-email', () => ({ getCrmEmailFrom: () => 'x@example.com', getMailTransport: () => ({ sendMail: jest.fn() }) }))
jest.mock('@/lib/money-permission-guard', () => ({
  actorIsOwner: jest.fn(async () => false),
  isMoneyPermissionName: () => false,
  lockMoneyPermissions: (next: string[]) => next,
  moneyPermissionIds: jest.fn(async () => new Set<string>()),
}))

const updateUserById = jest.fn(async (..._args: unknown[]) => ({ error: null }))
const createUser = jest.fn(async (..._args: unknown[]) => ({ data: { user: { id: 'u-new' } }, error: null }))
let db: ReturnType<typeof createFakeDb>
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ ...db.client, auth: { admin: { updateUserById, createUser, deleteUser: jest.fn() } } }),
}))

import { POST, PUT } from '@/app/api/admin/users/route'

const as = (id: string, role: string, org = 'org-a') => ({ authUser: { id, email: null }, profile: { id, org_id: org, role } })
const req = (method: string, body: unknown) =>
  new NextRequest('https://crm.example/api/admin/users', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const put = (body: unknown) => PUT(req('PUT', body))
const user = (id: string) => db.tables.users.find((u) => u.id === id)

beforeEach(() => {
  updateUserById.mockClear()
  authResult = as('u-mgr', 'sales_manager')
  db = createFakeDb({
    users: [
      { id: 'u-admin', org_id: 'org-a', role: 'admin', active: true, custom_role_id: null },
      { id: 'u-mgr', org_id: 'org-a', role: 'sales_manager', active: true, custom_role_id: null },
      { id: 'u-rep', org_id: 'org-a', role: 'sales_rep', active: true, custom_role_id: null },
      { id: 'u-far', org_id: 'org-b', role: 'sales_rep', active: true, custom_role_id: null },
    ],
    custom_roles: [{ id: 'cr-a', org_id: 'org-a' }, { id: 'cr-b', org_id: 'org-b' }],
    teams: [{ id: 't-a', org_id: 'org-a' }, { id: 't-b', org_id: 'org-b' }],
    regions: [{ id: 'r-a', org_id: 'org-a' }],
  })
})

test('no session → 401', async () => {
  authResult = null
  expect((await put({ id: 'u-rep', phone: '1' })).status).toBe(401)
})

test('a manager cannot promote themselves or anyone else', async () => {
  expect((await put({ id: 'u-mgr', role: 'admin' })).status).toBe(403)
  expect((await put({ id: 'u-rep', role: 'admin' })).status).toBe(403)
  expect((await put({ id: 'u-rep', role: 'sales_manager' })).status).toBe(403)
  expect(user('u-mgr')?.role).toBe('sales_manager')
  expect(user('u-rep')?.role).toBe('sales_rep')
})

test('a manager can still edit a rep when the form re-sends the unchanged role', async () => {
  const res = await put({ id: 'u-rep', role: 'sales_rep', phone: '555', team_id: 't-a', custom_role_id: 'cr-a' })
  expect(res.status).toBe(200)
  expect(user('u-rep')).toEqual(expect.objectContaining({ phone: '555', team_id: 't-a', custom_role_id: 'cr-a' }))
})

test('a manager cannot edit, deactivate or ban an admin', async () => {
  expect((await put({ id: 'u-admin', active: false })).status).toBe(403)
  expect((await put({ id: 'u-admin', phone: '1' })).status).toBe(403)
  expect(user('u-admin')?.active).toBe(true)
  expect(updateUserById).not.toHaveBeenCalled()
})

test('nobody switches themselves off or changes their own role', async () => {
  authResult = as('u-admin', 'admin')
  expect((await put({ id: 'u-admin', active: false })).status).toBe(403)
  expect((await put({ id: 'u-admin', role: 'sales_rep' })).status).toBe(403)
  authResult = as('u-mgr', 'sales_manager')
  expect((await put({ id: 'u-mgr', role: 'sales_manager', custom_role_id: 'cr-a' })).status).toBe(403)
  expect((await put({ id: 'u-mgr', role: 'sales_manager', phone: '9' })).status).toBe(200)
})

test('an admin can change another user’s role', async () => {
  authResult = as('u-admin', 'admin')
  expect((await put({ id: 'u-mgr', role: 'sales_rep' })).status).toBe(200)
  expect(user('u-mgr')?.role).toBe('sales_rep')
})

test('ids from another org are refused', async () => {
  expect((await put({ id: 'u-rep', custom_role_id: 'cr-b' })).status).toBe(400)
  expect((await put({ id: 'u-rep', team_id: 't-b' })).status).toBe(400)
  expect((await put({ id: 'u-rep', manager_user_id: 'u-far' })).status).toBe(400)
  expect((await put({ id: 'u-far', phone: '1' })).status).toBe(404)
  expect(user('u-rep')?.team_id).toBeUndefined()
})

test('POST: a regional manager cannot create an admin or use another org’s ids', async () => {
  authResult = as('u-rm', 'regional_manager')
  const base = { email: 'n@example.com', password: 'secret12', full_name: 'New' }
  expect((await POST(req('POST', { ...base, role: 'admin' }))).status).toBe(403)
  expect((await POST(req('POST', { ...base, team_id: 't-b' }))).status).toBe(400)
  expect(createUser).not.toHaveBeenCalled()
  expect((await POST(req('POST', { ...base, team_id: 't-a' }))).status).toBe(200)
})
