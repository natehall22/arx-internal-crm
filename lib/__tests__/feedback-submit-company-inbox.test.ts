/** @jest-environment node */
/** In-app feedback goes to the sender's own company inbox; signed-in only. */
import { NextRequest } from 'next/server'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const sendMail = jest.fn(async (_m: { to: string; html: string }) => ({}))
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => ({ sendMail }) } }))
jest.mock('@/lib/crm-email-from', () => ({ getCrmEmailFrom: () => 'crm@example.com' }))
let db: ReturnType<typeof createFakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
let session: unknown = null
jest.mock('@/lib/auth', () => ({
  requireAuthApi: async () => {
    if (!session) throw new Error('Unauthorized')
    return session
  },
}))

import { POST } from '@/app/api/feedback/submit/route'

const A = 'ffffffff-0000-4000-8000-000000000001'
const B = 'ffffffff-0000-4000-8000-000000000002'
const C = 'ffffffff-0000-4000-8000-000000000003'
const as = (org: string, email = 'rep@x.test') =>
  (session = { authUser: { id: 'u', email }, profile: { id: 'u', org_id: org, full_name: 'Rep One', email } })
const post = (body: Record<string, unknown> = { type: 'bug', description: 'broken', severity: 'low', rep_email: 'spoof@evil.test' }) =>
  POST(new NextRequest('https://crm.example/api/feedback/submit', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  session = null
  sendMail.mockClear()
  db = createFakeDb({
    orgs: [{ id: A, email: 'info@company-a.test' }, { id: B, email: null }, { id: C, email: null }],
    users: [{ id: 'b1', org_id: B, role: 'admin', active: true, email: 'owner@b.test', created_at: '2026-01-01T00:00:00Z' }],
  })
})

test('not signed in → 401, nothing sent', async () => {
  expect((await post()).status).toBe(401)
  expect(sendMail).not.toHaveBeenCalled()
})

test("goes to the sender's company inbox (orgs.email); reporter comes from the session, not the body", async () => {
  as(A)
  expect((await post()).status).toBe(200)
  expect(sendMail.mock.calls[0][0].to).toBe('info@company-a.test')
  expect(sendMail.mock.calls[0][0].html).toContain('rep@x.test')
  expect(sendMail.mock.calls[0][0].html).not.toContain('spoof@evil.test')
})

test('no company inbox → its longest-standing active admin; neither → 503, never another inbox', async () => {
  as(B)
  await post()
  expect(sendMail.mock.calls[0][0].to).toBe('owner@b.test')
  sendMail.mockClear()
  as(C)
  expect((await post()).status).toBe(503)
  expect(sendMail).not.toHaveBeenCalled()
})
