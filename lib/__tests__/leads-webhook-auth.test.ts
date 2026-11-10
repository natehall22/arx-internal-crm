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
    users: [
      { id: 'a-admin', org_id: ORG_A, role: 'admin', active: true, email: 'owner@a.test', created_at: '2026-01-01T00:00:00Z' },
      { id: 'b-admin-new', org_id: ORG_B, role: 'admin', active: true, email: 'new@b.test', created_at: '2026-06-01T00:00:00Z' },
      { id: 'b-admin-old', org_id: ORG_B, role: 'admin', active: true, email: 'first@b.test', created_at: '2026-02-01T00:00:00Z' },
      { id: 'b-admin-gone', org_id: ORG_B, role: 'admin', active: false, email: 'gone@b.test', created_at: '2025-01-01T00:00:00Z' },
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

describe('owner + inbound-lead email stay inside the lead\'s company', () => {
  test('no configured owner → the company\'s longest-standing ACTIVE admin owns it and alone gets the email', async () => {
    expect((await post({ name: 'x', phone: '555' }, { token: 'tok-b' })).status).toBe(200)
    expect(db.tables.leads).toEqual([expect.objectContaining({ org_id: ORG_B, owner_user_id: 'b-admin-old' })])
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(sendMail.mock.calls[0][0]).toEqual(expect.objectContaining({ to: 'first@b.test' }))
  })

  test('a configured owner from ANOTHER company is ignored (no cross-company assignment or email)', async () => {
    db.tables.lead_sources[0].auto_assign_user_id = 'a-admin'
    db.tables.orgs[1].settings = { web_leads_owner_id: 'a-admin' }
    expect((await post({ name: 'x' }, { token: 'tok-b' })).status).toBe(200)
    expect(db.tables.leads[0].owner_user_id).toBe('b-admin-old')
    expect(sendMail.mock.calls.map((c) => (c[0] as unknown as { to: string }).to)).toEqual(['first@b.test'])
    expect((db.tables.notifications ?? []).every((n) => n.recipient_user_id !== 'a-admin')).toBe(true)
  })

  test('a configured owner in the same company wins', async () => {
    db.tables.lead_sources[0].auto_assign_user_id = 'b-admin-new'
    expect((await post({ name: 'x' }, { token: 'tok-b' })).status).toBe(200)
    expect(db.tables.leads[0].owner_user_id).toBe('b-admin-new')
    expect((sendMail.mock.calls[0][0] as unknown as { to: string }).to).toBe('new@b.test')
  })

  test('company with no active admin → lead saved, nobody emailed (never a fallback inbox)', async () => {
    db.tables.users = db.tables.users.filter((u) => u.org_id !== ORG_B)
    expect((await post({ name: 'x' }, { token: 'tok-b' })).status).toBe(200)
    expect(db.tables.leads).toHaveLength(1)
    expect(sendMail).not.toHaveBeenCalled()
  })
})

test('CORS: any company\'s https site may post (token-authorised, no credentials); http non-local origins are not reflected', async () => {
  const { OPTIONS } = await import('@/app/api/webhooks/leads/route')
  const pre = (origin: string) =>
    OPTIONS(new NextRequest('https://crm.example/api/webhooks/leads?token=tok-b', { method: 'OPTIONS', headers: { origin } }))
  expect((await pre('https://www.second-company.com')).headers.get('access-control-allow-origin')).toBe('https://www.second-company.com')
  expect((await pre('http://evil.test')).headers.get('access-control-allow-origin')).not.toBe('http://evil.test')
  expect((await pre('https://x.test')).headers.get('access-control-allow-credentials')).toBeNull()
  expect((await pre('https://x.test')).headers.get('vary')).toBe('Origin')
})
