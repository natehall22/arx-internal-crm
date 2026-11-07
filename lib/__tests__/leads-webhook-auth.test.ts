/** @jest-environment node */
/** /api/webhooks/leads fails closed and never lets the body choose the org (security audit C5). */
import { NextRequest } from 'next/server'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const sendMail = jest.fn(async (_m: { html: string }) => ({}))
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => ({ sendMail }) } }))
jest.mock('@/lib/crm-email-from', () => ({ getCrmEmailFrom: () => 'crm@example.com' }))
let db: ReturnType<typeof createFakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { POST } from '@/app/api/webhooks/leads/route'

const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '22222222-2222-4222-8222-222222222222'
const ENV = { ...process.env }

const post = (body: Record<string, unknown>, opts: { token?: string; key?: string } = {}) =>
  POST(
    new NextRequest(`https://crm.example/api/webhooks/leads${opts.token ? `?token=${opts.token}` : ''}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(opts.key ? { 'x-api-key': opts.key } : {}) },
      body: JSON.stringify(body),
    })
  )

beforeEach(() => {
  process.env = { ...ENV }
  delete process.env.WEBHOOK_SECRET
  delete process.env.LEADS_WEBHOOK_SECRET
  delete process.env.DEPLOYMENT_ORG_ID
  sendMail.mockClear()
  db = createFakeDb({
    orgs: [{ id: ORG_A, settings: {} }, { id: ORG_B, settings: {} }],
    lead_sources: [
      { id: 'ls-b', org_id: ORG_B, name: 'Site B', webhook_token: 'tok-b', webhook_enabled: true, is_active: true },
    ],
  })
})
afterAll(() => {
  process.env = ENV
})

test('no secret and no token → 503, nothing written', async () => {
  expect((await post({ org_id: ORG_A, name: 'x' })).status).toBe(503)
  expect(db.tables.leads ?? []).toHaveLength(0)
})

test('shared key without DEPLOYMENT_ORG_ID is not accepted (it could target any org)', async () => {
  process.env.WEBHOOK_SECRET = 'sekret'
  expect((await post({ org_id: ORG_A, name: 'x' }, { key: 'sekret' })).status).toBe(503)
})

test('shared key writes only to the deployment org', async () => {
  process.env.WEBHOOK_SECRET = 'sekret'
  process.env.DEPLOYMENT_ORG_ID = ORG_A
  expect((await post({ name: 'x' }, { key: 'wrong' })).status).toBe(401)
  expect((await post({ org_id: ORG_B, name: 'x' }, { key: 'sekret' })).status).toBe(403)
  expect((await post({ name: 'x' }, { key: 'sekret' })).status).toBe(200)
  expect(db.tables.leads).toEqual([expect.objectContaining({ org_id: ORG_A })])
})

test("a token's org wins over the body, and email fields are escaped", async () => {
  const res = await post({ org_id: ORG_A, name: '<a href="https://evil">Click</a>', phone: '555' }, { token: 'tok-b' })
  expect(res.status).toBe(200)
  expect(db.tables.leads).toEqual([expect.objectContaining({ org_id: ORG_B })])
  const html = sendMail.mock.calls[0][0].html
  expect(html).not.toContain('<a href="https://evil">')
  expect(html).toContain('&lt;a href=&quot;https://evil&quot;&gt;')
})

test('unknown token → 401', async () => {
  expect((await post({ name: 'x' }, { token: 'nope' })).status).toBe(401)
})
