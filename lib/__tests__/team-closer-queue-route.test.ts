/** @jest-environment node */
/** /api/admin/team-closer-queue — team admins only, own org only (security audit C4). */
import { NextRequest } from 'next/server'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

let authResult: unknown = null
jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(async () => {
    if (!authResult) throw new Error('Unauthorized')
    return authResult
  }),
}))
let db: ReturnType<typeof createFakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { POST, PUT, DELETE } from '@/app/api/admin/team-closer-queue/route'

const as = (role: string, org = 'org-a') => ({ authUser: { id: 'me' }, profile: { id: 'me', org_id: org, role } })
const json = (method: string, body: unknown) =>
  new NextRequest('https://crm.example/api/admin/team-closer-queue', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  authResult = as('admin')
  db = createFakeDb({
    teams: [{ id: 't-a', org_id: 'org-a' }, { id: 't-b', org_id: 'org-b' }],
    users: [{ id: 'c-a', org_id: 'org-a' }, { id: 'c-b', org_id: 'org-b' }],
    team_closer_queue: [
      { id: 'q-a', org_id: 'org-a', team_id: 't-a', user_id: 'c-a', priority: 0, active: true },
      { id: 'q-b', org_id: 'org-b', team_id: 't-b', user_id: 'c-b', priority: 0, active: true },
    ],
  })
})

test('a setter cannot change or delete queue entries', async () => {
  authResult = as('setter')
  expect((await PUT(json('PUT', { id: 'q-a', active: false }))).status).toBe(403)
  expect((await DELETE(new NextRequest('https://crm.example/api/admin/team-closer-queue?id=q-a', { method: 'DELETE' }))).status).toBe(403)
  expect(db.tables.team_closer_queue.find((r) => r.id === 'q-a')?.active).toBe(true)
})

test('no session → 401', async () => {
  authResult = null
  expect((await PUT(json('PUT', { id: 'q-a', active: false }))).status).toBe(401)
})

test("an admin cannot touch another org's entry", async () => {
  await PUT(json('PUT', { id: 'q-b', active: false }))
  await DELETE(new NextRequest('https://crm.example/api/admin/team-closer-queue?id=q-b', { method: 'DELETE' }))
  expect(db.tables.team_closer_queue.find((r) => r.id === 'q-b')).toEqual(expect.objectContaining({ active: true }))
})

test('own-org updates still work for a sales manager', async () => {
  authResult = as('sales_manager')
  expect((await PUT(json('PUT', { id: 'q-a', active: false }))).status).toBe(200)
  expect(db.tables.team_closer_queue.find((r) => r.id === 'q-a')?.active).toBe(false)
})

test('POST rejects a team or user from another org', async () => {
  expect((await POST(json('POST', { team_id: 't-b', user_id: 'c-a' }))).status).toBe(404)
  expect((await POST(json('POST', { team_id: 't-a', user_id: 'c-b' }))).status).toBe(404)
  expect((await POST(json('POST', { team_id: 't-a', user_id: 'c-a' }))).status).toBe(200)
})
