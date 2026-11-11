/** @jest-environment node */
/**
 * Customer portal: sign-in (emailed one-time link, no existence oracle, rate limits), sessions (one customer of one company,
 * the right address only), and ISOLATION — customer A2 can never reach A1 (same company) or B1 (another company) through
 * the loaders or any portal route. Runs against the in-memory database with SQL functions mirrored in JS (the real SQL is
 * plain: supabase/migrations/202611120060_customer_portal.sql).
 */
import { createHash } from 'crypto'

import { createFakeDb } from '@/lib/test-helpers/fake-db'

process.env.SMTP_HOST = 'smtp.test'
process.env.PORTAL_REQUEST_MIN_MS = '0'
const A = 'org-a'
const B = 'org-b'
const iso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString()
const day = (d: number) => iso(d).slice(0, 10)

let mockHostOrg: string | null = A
let mockCookie: string | undefined
let mockFeatureOff = new Set<string>()
const mails: Array<{ to: string; subject: string; text: string; html: string }> = []
let db: ReturnType<typeof createFakeDb>

jest.mock('next/headers', () => ({
  cookies: () => ({ get: (n: string) => (n === 'portal_session' && mockCookie ? { name: n, value: mockCookie } : undefined) }),
  headers: () => new Headers(),
}))
jest.mock('@/lib/company-host-server', () => ({
  getRequestHostFence: async () => (mockHostOrg ? { kind: 'org', orgId: mockHostOrg, source: 'host' } : { kind: 'open' }),
}))
jest.mock('@/lib/org-features-server', () => ({ isOrgFeatureOn: async (_org: string, f: string) => !mockFeatureOff.has(f) }))
jest.mock('@/lib/company-links', () => ({ orgAppUrl: async (org: string) => `https://${org}.crm.test`, tryOrgAppUrl: async (org: string) => `https://${org}.crm.test` }))
const storage = { from: () => ({ createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://storage.test/${p}` }, error: null }) }) }
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ ...(db.client as object), storage }) }))
jest.mock('@/lib/setter-email', () => ({
  getCrmEmailFrom: () => 'Co <info@co.test>',
  getMailTransport: () => ({ sendMail: async (m: { to: string; subject: string; text: string; html: string }) => { mails.push(m) } }),
}))
jest.mock('@/lib/org-brand', () => ({ getDocumentBrand: async () => ({ name: 'Green Lawn LLC', casualName: 'Green Lawn', phone: '555-0100', email: 'office@green.test' }) }))
jest.mock('@/lib/company-recipient', () => ({ resolveCompanyInboxEmail: async () => 'office@green.test' }))
jest.mock('@/lib/cron-orgs', () => ({ loadOrgTimeZone: async () => 'America/New_York' }))
jest.mock('@/lib/org-trades', () => ({ loadOrgTrades: async () => [], tradeLabel: (s: string) => s }))

import { findPortalFile, findPortalInvoice, loadPortalHome } from '@/lib/portal/data'
import {
  consumeLoginLink, endPortalSession, getPortalSession, portalOrgForRequest, requestLoginLink, startPortalSession, PORTAL_LIMITS, type PortalSession,
} from '@/lib/portal/server'
import { hashPortalToken, isWellFormedPortalToken, newPortalToken, parsePortalIdentifier } from '@/lib/portal/tokens'
import { POST as requestLinkPOST } from '@/app/api/portal/request-link/route'
import { POST as enterPOST } from '@/app/api/portal/enter/route'
import { POST as messagesPOST } from '@/app/api/portal/messages/route'
import { POST as payPOST } from '@/app/api/portal/invoices/[id]/pay/route'
import { POST as cardPOST } from '@/app/api/portal/card/route'
import { GET as filesGET } from '@/app/api/portal/files/[kind]/[id]/route'

const SECRET_MARKERS = ['INTERNAL-NOTE', 'GATE-CODE-9911', 'CREW-COST', 'OTHER-CUSTOMER-SECRET']

function seed() {
  const customers = [
    { id: 'a1', org_id: A, name: 'Alice One', email: 'alice@x.test', phone: '(850) 111-2222' },
    { id: 'a2', org_id: A, name: 'Bob Two', email: 'Bob@x.test', phone: '850-333-4444' },
    { id: 'a3', org_id: A, name: 'Noemail Three', email: null, phone: '850-555-6666' },
    { id: 'b1', org_id: B, name: 'Bea B-One', email: 'bob@x.test', phone: '850-333-4444' },
  ]
  const inv = (id: string, org: string, cust: string | null, job: string | null, number: string, total = 10000) => ({
    id, org_id: org, customer_id: cust, job_id: job, invoice_number: number, status: 'sent', total_cents: total, internal_note: 'INTERNAL-NOTE', issued_at: iso(-3), due_at: iso(10), created_at: iso(-3),
  })
  return {
    orgs: [
      { id: A, settings: { features: { onlinePayments: false } }, email: 'office@green.test' },
      { id: B, settings: {}, email: 'office@b.test' },
    ],
    customers,
    production_jobs: [
      { id: 'job-a1', org_id: A, customer_id: 'a1' },
      { id: 'job-a2', org_id: A, customer_id: 'a2' },
      { id: 'job-b1', org_id: B, customer_id: 'b1' },
    ],
    opportunities: [
      { id: 'opp-a1', org_id: A, customer_id: 'a1' },
      { id: 'opp-a2', org_id: A, customer_id: 'a2' },
      { id: 'opp-b1', org_id: B, customer_id: 'b1' },
    ],
    properties: [
      { id: 'prop-a1', org_id: A, customer_id: 'a1', label: null, address_text: '1 Alice Rd', access_notes: 'GATE-CODE-9911' },
      { id: 'prop-a2', org_id: A, customer_id: 'a2', label: null, address_text: '2 Bob St', access_notes: 'GATE-CODE-9911' },
    ],
    service_plans: [
      { id: 'plan-a1', org_id: A, customer_id: 'a1', name: 'Alice Mowing', status: 'active', property_id: 'prop-a1', seasons: [], price: 50, billing_basis: 'per_visit', steps: [], description: 'INTERNAL-NOTE' },
      { id: 'plan-a2', org_id: A, customer_id: 'a2', name: 'Bob Mowing', status: 'active', property_id: 'prop-a2', seasons: [{ from: '04-01', to: '10-31', frequency: 'weekly' }], price: 40, billing_basis: 'per_visit', steps: [], description: 'INTERNAL-NOTE' },
    ],
    work_orders: [
      { id: 'wo-a1', org_id: A, service_plan_id: 'plan-a1', scheduled_date: day(2), status: 'scheduled', trade: 'lawn', work_order_type: 'service_visit', property_id: 'prop-a1', service_price: 'CREW-COST' },
      { id: 'wo-a2', org_id: A, service_plan_id: 'plan-a2', scheduled_date: day(3), status: 'scheduled', trade: 'lawn', work_order_type: 'service_visit', property_id: 'prop-a2', service_price: 'CREW-COST' },
      { id: 'wo-a2-done', org_id: A, service_plan_id: 'plan-a2', scheduled_date: day(-3), status: 'completed', trade: 'lawn', work_order_type: 'service_visit', property_id: 'prop-a2' },
      { id: 'wo-a2-skip', org_id: A, service_plan_id: 'plan-a2', scheduled_date: day(5), status: 'skipped', trade: 'lawn', work_order_type: 'service_visit', property_id: 'prop-a2' },
    ],
    job_invoices: [
      inv('inv-a1', A, 'a1', null, 'INV-1'),
      inv('inv-a2', A, 'a2', null, 'INV-2'),
      inv('inv-a2-job', A, null, 'job-a2', 'INV-3', 5000),
      { ...inv('inv-a2-draft', A, 'a2', null, 'INV-4'), status: 'draft' },
      inv('inv-b1', B, 'b1', null, 'INV-B1'),
    ],
    invoice_payments: [{ id: 'ip1', invoice_id: 'inv-a2-job', applied_cents: 5000 }],
    order_form_contracts: [
      { id: 'c-a1', org_id: A, opportunity_id: 'opp-a1', project_address: '1 Alice Rd', project_cost: 9999, status: 'pending_customer', signing_token: 'a1a1a1a1-0000-4000-8000-000000000001', token_expires_at: iso(3), created_at: iso(-1) },
      { id: 'c-a2', org_id: A, opportunity_id: 'opp-a2', project_address: '2 Bob St', project_cost: 4200, status: 'pending_customer', signing_token: 'a2a2a2a2-0000-4000-8000-000000000002', token_expires_at: iso(3), created_at: iso(-1) },
      { id: 'c-b1', org_id: B, opportunity_id: 'opp-b1', project_address: '9 Bea Ln', project_cost: 1, status: 'pending_customer', signing_token: 'b1b1b1b1-0000-4000-8000-000000000003', token_expires_at: iso(3), created_at: iso(-1) },
    ],
    documents: [
      { id: 'doc-a1', org_id: A, customer_id: 'a1', job_id: null, title: 'OTHER-CUSTOMER-SECRET', filename: 'a1.pdf', storage_path: 'A/a1.pdf', shared_with_customer: true, status: 'active', deleted_at: null, created_at: iso(-2) },
      { id: 'doc-a2', org_id: A, customer_id: 'a2', job_id: null, title: 'Bob agreement', filename: 'a2.pdf', storage_path: 'A/a2.pdf', shared_with_customer: true, status: 'active', deleted_at: null, created_at: iso(-2) },
      { id: 'doc-a2-private', org_id: A, customer_id: 'a2', job_id: null, title: 'INTERNAL-NOTE', filename: 'p.pdf', storage_path: 'A/p.pdf', shared_with_customer: false, status: 'active', deleted_at: null, created_at: iso(-2) },
      { id: 'doc-a2-job', org_id: A, customer_id: null, job_id: 'job-a2', title: 'Job paper', filename: 'j.pdf', storage_path: 'A/j.pdf', shared_with_customer: true, status: 'active', deleted_at: null, created_at: iso(-1) },
      { id: 'doc-b1', org_id: B, customer_id: 'b1', job_id: null, title: 'OTHER-CUSTOMER-SECRET', filename: 'b1.pdf', storage_path: 'B/b1.pdf', shared_with_customer: true, status: 'active', deleted_at: null, created_at: iso(-2) },
    ],
    photos: [
      { id: 'ph-a2', org_id: A, job_id: null, work_order_id: 'wo-a2-done', caption: 'After mow', filename: 'x.jpg', storage_path: 'A/x.jpg', shared_with_customer: true, deleted_at: null, created_at: iso(-3) },
      { id: 'ph-a2-private', org_id: A, job_id: null, work_order_id: 'wo-a2-done', caption: 'INTERNAL-NOTE', filename: 'y.jpg', storage_path: 'A/y.jpg', shared_with_customer: false, deleted_at: null, created_at: iso(-3) },
      { id: 'ph-a1', org_id: A, job_id: null, work_order_id: 'wo-a1', caption: 'OTHER-CUSTOMER-SECRET', filename: 'z.jpg', storage_path: 'A/z.jpg', shared_with_customer: true, deleted_at: null, created_at: iso(-3) },
    ],
    portal_messages: [
      { id: 'm-a1', org_id: A, customer_id: 'a1', direction: 'from_customer', body: 'OTHER-CUSTOMER-SECRET', created_at: iso(-1) },
      { id: 'm-a2', org_id: A, customer_id: 'a2', direction: 'from_company', body: 'See you Tuesday', created_at: iso(-1) },
    ],
    payment_links: [],
  }
}

const rpc = {
  portal_find_customers: (args: Record<string, unknown>, t: Record<string, Array<Record<string, unknown>>>) =>
    t.customers
      .filter((c) => c.org_id === args.p_org)
      .filter((c) => (args.p_email && String(c.email ?? '').trim().toLowerCase() === args.p_email) || (args.p_phone10 && String(c.phone ?? '').replace(/\D/g, '').slice(-10) === args.p_phone10))
      .map((c) => ({ id: c.id, name: c.name, email: c.email })),
  portal_consume_login_token: (args: Record<string, unknown>, t: Record<string, Array<Record<string, unknown>>>) => {
    const row = (t.portal_login_tokens ?? []).find((r) => r.token_hash === args.p_hash && !r.used_at && Date.parse(String(r.expires_at)) > Date.now())
    if (!row) return []
    row.used_at = new Date().toISOString()
    return [{ org_id: row.org_id, customer_id: row.customer_id }]
  },
  portal_take_attempt: (args: Record<string, unknown>, t: Record<string, Array<Record<string, unknown>>>) => {
    const rows = (t.portal_rate_limits ??= [])
    let r = rows.find((x) => x.key === args.p_key) as { key: unknown; attempts: number } | undefined
    if (!r) rows.push((r = { key: args.p_key, attempts: 0 }))
    r.attempts += 1
    return r.attempts <= Number(args.p_limit)
  },
}

beforeEach(() => {
  mockHostOrg = A
  mockCookie = undefined
  mockFeatureOff = new Set()
  mails.length = 0
  db = createFakeDb(seed() as never, { rpc: rpc as never })
})

const admin = () => db.client
const sessionFor = async (org: string, cust: string): Promise<PortalSession> => {
  const s = await startPortalSession(admin(), org, cust)
  mockCookie = s.token
  const got = await getPortalSession(admin())
  if (!got) throw new Error('no session')
  return got
}
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://${A}.crm.test${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
const form = (url: string, fields: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return new Request(`https://${A}.crm.test${url}`, { method: 'POST', body: fd })
}

describe('tokens + identifiers', () => {
  test('hash is stable, tokens are url-safe and 43 chars, junk refused', () => {
    const t = newPortalToken()
    expect(t).toHaveLength(43)
    expect(isWellFormedPortalToken(t)).toBe(true)
    expect(isWellFormedPortalToken('short')).toBe(false)
    expect(isWellFormedPortalToken('a'.repeat(40) + '!')).toBe(false)
    expect(hashPortalToken(t)).toBe(createHash('sha256').update(t).digest('hex'))
  })
  test('email or phone, nothing else', () => {
    expect(parsePortalIdentifier(' Bob@X.test ')).toEqual({ kind: 'email', email: 'bob@x.test' })
    expect(parsePortalIdentifier('(850) 333-4444')).toEqual({ kind: 'phone', phone10: '8503334444' })
    expect(parsePortalIdentifier('+1 850 333 4444')).toEqual({ kind: 'phone', phone10: '8503334444' })
    for (const bad of ['', 'bob', '123', 'a@b', null, 5, 'x'.repeat(300)]) expect(parsePortalIdentifier(bad)).toBeNull()
  })
})

describe('asking for a link', () => {
  test('a match gets ONE email at the address on file; only the hash is stored', async () => {
    await requestLoginLink(admin(), A, 'bob@x.test', '1.1.1.1')
    expect(mails).toHaveLength(1)
    expect(mails[0].to).toBe('Bob@x.test')
    const url = /https:\/\/org-a\.crm\.test\/portal\/enter\?t=([A-Za-z0-9_-]{43})/.exec(mails[0].text)
    expect(url).toBeTruthy()
    const stored = db.tables.portal_login_tokens
    expect(stored).toHaveLength(1)
    expect(JSON.stringify(stored)).not.toContain(url![1])
    expect(stored[0].token_hash).toBe(hashPortalToken(url![1]))
    expect(stored[0].customer_id).toBe('a2')
    expect(mails[0].html).toContain('Green Lawn')
    expect(mails[0].html).not.toMatch(/ARX/)
  })
  test('typing a phone number emails the address on file, never the typist', async () => {
    await requestLoginLink(admin(), A, '850-333-4444', '1.1.1.1')
    expect(mails.map((m) => m.to)).toEqual(['Bob@x.test'])
  })
  test('the same email in ANOTHER company matches nothing here (company B has a bob@ too)', async () => {
    await requestLoginLink(admin(), A, 'bob@x.test', '1.1.1.1')
    expect(db.tables.portal_login_tokens.every((t) => t.org_id === A && t.customer_id === 'a2')).toBe(true)
  })
  test('no match, no email on file, junk, feature off: nothing sent, nothing thrown', async () => {
    await requestLoginLink(admin(), A, 'nobody@x.test', '1.1.1.1')
    await requestLoginLink(admin(), A, '850-555-6666', '1.1.1.1') // a3 has no email
    await requestLoginLink(admin(), A, 'not an address', '1.1.1.1')
    mockFeatureOff = new Set(['customerPortal'])
    await requestLoginLink(admin(), A, 'bob@x.test', '1.1.1.1')
    expect(mails).toHaveLength(0)
    expect(db.tables.portal_login_tokens ?? []).toHaveLength(0)
    const kinds = db.tables.portal_login_events.map((e) => e.kind)
    expect(kinds).toContain('link_no_match')
  })
  test('rate limit: the 4th request for one identifier in the window sends nothing, and the log says so', async () => {
    for (let i = 0; i < PORTAL_LIMITS.requestPerIdentifier.limit + 2; i++) await requestLoginLink(admin(), A, 'alice@x.test', `9.9.9.${i}`)
    expect(mails).toHaveLength(PORTAL_LIMITS.requestPerIdentifier.limit)
    expect(db.tables.portal_login_events.some((e) => e.kind === 'link_blocked')).toBe(true)
  })
  test('a match and a stranger take the same time (a fixed floor, not the mail server)', async () => {
    process.env.PORTAL_REQUEST_MIN_MS = '250'
    try {
      const t = async (v: string) => { const a = Date.now(); await requestLoginLink(admin(), A, v, '2.2.2.2'); return Date.now() - a }
      const [match, stranger] = [await t('alice@x.test'), await t('ghost@x.test')]
      expect(match).toBeGreaterThanOrEqual(240)
      expect(stranger).toBeGreaterThanOrEqual(240)
    } finally {
      process.env.PORTAL_REQUEST_MIN_MS = '0'
    }
  })
  test('the audit log never holds a raw address or a token', async () => {
    await requestLoginLink(admin(), A, 'bob@x.test', '203.0.113.7')
    const log = JSON.stringify(db.tables.portal_login_events)
    expect(log).not.toContain('bob@x.test')
    expect(log).not.toContain('203.0.113.7')
    expect(log).not.toMatch(/[A-Za-z0-9_-]{43}/)
  })
  test('the route answers the same for a match and a stranger, and refuses cross-site posts and unknown addresses', async () => {
    const a = await requestLinkPOST(post('/api/portal/request-link', { identifier: 'bob@x.test' }))
    const b = await requestLinkPOST(post('/api/portal/request-link', { identifier: 'ghost@x.test' }))
    expect([a.status, await a.json()]).toEqual([b.status, await b.json()])
    expect((await requestLinkPOST(post('/api/portal/request-link', { identifier: 'bob@x.test' }, { origin: 'https://evil.test' }))).status).toBe(403)
    mockHostOrg = null
    expect((await requestLinkPOST(post('/api/portal/request-link', { identifier: 'bob@x.test' }))).status).toBe(404)
  })
})

describe('the link: once, on its own company address', () => {
  async function linkFor(org: string, cust: string) {
    const t = newPortalToken()
    ;(db.tables.portal_login_tokens ??= []).push({ id: `t-${t.slice(0, 4)}`, org_id: org, customer_id: cust, token_hash: hashPortalToken(t), expires_at: iso(0.01), used_at: null })
    return t
  }
  test('works once; a second use fails', async () => {
    const t = await linkFor(A, 'a2')
    expect(await consumeLoginLink(admin(), t, A)).toEqual({ orgId: A, customerId: 'a2' })
    expect(await consumeLoginLink(admin(), t, A)).toBeNull()
  })
  test('expired and malformed links fail', async () => {
    const t = await linkFor(A, 'a2')
    db.tables.portal_login_tokens[0].expires_at = iso(-1)
    expect(await consumeLoginLink(admin(), t, A)).toBeNull()
    expect(await consumeLoginLink(admin(), 'nope', A)).toBeNull()
  })
  test("another company's link on this address fails AND is not burned", async () => {
    const t = await linkFor(B, 'b1')
    expect(await consumeLoginLink(admin(), t, A)).toBeNull()
    expect(db.tables.portal_login_tokens[0].used_at).toBeNull()
    expect(await consumeLoginLink(admin(), t, B)).toEqual({ orgId: B, customerId: 'b1' })
  })
  test('POST enter: starts a host-only httpOnly session cookie (no Domain); a bad link goes back to sign-in', async () => {
    const t = await linkFor(A, 'a2')
    const ok = await enterPOST(form('/api/portal/enter', { t }))
    expect(ok.status).toBe(303)
    expect(ok.headers.get('location')).toBe('/portal')
    const cookie = ok.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/portal_session=[A-Za-z0-9_-]{43}/)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=lax/i)
    expect(cookie).not.toMatch(/Domain=/i)
    expect(db.tables.portal_login_events.some((e) => e.kind === 'login' && e.customer_id === 'a2')).toBe(true)
    const again = await enterPOST(form('/api/portal/enter', { t }))
    expect(again.headers.get('location')).toBe('/portal?problem=link')
    expect(again.headers.get('set-cookie')).toBeNull()
    expect(db.tables.portal_login_events.some((e) => e.kind === 'login_failed')).toBe(true)
  })
})

describe('sessions', () => {
  test('scoped to one customer of one company; the cookie holds only the random token', async () => {
    const s = await sessionFor(A, 'a2')
    expect(s).toMatchObject({ orgId: A, customerId: 'a2', full: true })
    expect(JSON.stringify(db.tables.portal_sessions)).not.toContain(mockCookie as string)
  })
  test('refused on another company address, expired, revoked, feature off, customer gone, junk cookie', async () => {
    const s = await sessionFor(A, 'a2')
    mockHostOrg = B
    expect(await getPortalSession(admin())).toBeNull()
    mockHostOrg = null // not a company address at all (legacy / apex): the fence is open, but the portal has no company
    expect(await portalOrgForRequest()).toBeNull()
    mockHostOrg = A
    expect(await getPortalSession(admin())).not.toBeNull()
    mockFeatureOff = new Set(['customerPortal'])
    expect(await getPortalSession(admin())).toBeNull()
    mockFeatureOff = new Set()
    db.tables.portal_sessions[0].expires_at = iso(-1)
    expect(await getPortalSession(admin())).toBeNull()
    db.tables.portal_sessions[0].expires_at = iso(5)
    db.tables.customers = db.tables.customers.filter((c) => c.id !== 'a2')
    expect(await getPortalSession(admin())).toBeNull()
    db.tables.customers.push({ id: 'a2', org_id: A, name: 'Bob Two' })
    await endPortalSession(admin(), s)
    expect(await getPortalSession(admin())).toBeNull()
    expect(db.tables.portal_login_events.some((e) => e.kind === 'logout')).toBe(true)
    mockCookie = 'not-a-token'
    expect(await getPortalSession(admin())).toBeNull()
  })
  test('a session of company A with a forged cookie value for B’s customer does not exist: sessions are only ever made by startPortalSession', async () => {
    await sessionFor(A, 'a2')
    mockCookie = hashPortalToken('guess')
    expect(await getPortalSession(admin())).toBeNull()
  })
})

describe('isolation: customer a2 sees only a2', () => {
  test('home holds a2’s things and nothing of a1, b1, or anything internal', async () => {
    const s = await sessionFor(A, 'a2')
    const home = (await loadPortalHome(admin(), s))!
    expect(home.customerName).toBe('Bob Two')
    expect(home.visits.upcoming.map((v) => v.id)).toEqual(['wo-a2'])
    expect(home.visits.recent.map((v) => v.id)).toEqual(['wo-a2-done'])
    expect(home.invoices.map((i) => i.id).sort()).toEqual(['inv-a2', 'inv-a2-job'])
    expect(home.invoices.find((i) => i.id === 'inv-a2-job')).toMatchObject({ balanceCents: 0, status: 'paid' })
    expect(home.contracts.map((c) => c.id)).toEqual(['c-a2'])
    expect(home.documents.map((d) => d.id).sort()).toEqual(['doc-a2', 'doc-a2-job', 'ph-a2'])
    expect(home.plans.map((p) => p.id)).toEqual(['plan-a2'])
    expect(home.messages.map((m) => m.id)).toEqual(['m-a2'])
    const all = JSON.stringify(home)
    for (const marker of SECRET_MARKERS) expect(all).not.toContain(marker)
    for (const id of ['a1', 'b1', 'inv-a1', 'inv-b1', 'c-a1', 'c-b1', 'doc-a1', 'doc-b1', 'ph-a1', 'plan-a1', 'wo-a1', 'm-a1', 'Alice', 'Bea']) expect(all).not.toContain(id)
  })
  test('company B’s customer b1 sees only b1', async () => {
    mockHostOrg = B
    const s = await sessionFor(B, 'b1')
    const home = (await loadPortalHome(admin(), s))!
    expect(home.invoices.map((i) => i.id)).toEqual(['inv-b1'])
    expect(home.documents.map((d) => d.id)).toEqual(['doc-b1'])
    expect(JSON.stringify(home)).not.toMatch(/inv-a|doc-a|Bob|Alice/)
  })
  test('invoice and file lookups refuse every id that is not the portal customer’s', async () => {
    const s = await sessionFor(A, 'a2')
    for (const id of ['inv-a1', 'inv-b1', 'inv-a2-draft', 'nope', '../x']) expect(await findPortalInvoice(admin(), s, id)).toBeNull()
    expect(await findPortalInvoice(admin(), s, 'inv-a2')).toMatchObject({ id: 'inv-a2' })
    expect(await findPortalInvoice(admin(), s, 'inv-a2-job')).toMatchObject({ job_id: 'job-a2' })
    for (const [k, id] of [['document', 'doc-a1'], ['document', 'doc-b1'], ['document', 'doc-a2-private'], ['photo', 'ph-a1'], ['photo', 'ph-a2-private'], ['document', 'ph-a2'], ['photo', 'doc-a2']] as const) {
      expect(await findPortalFile(admin(), s, k, id)).toBeNull()
    }
    expect(await findPortalFile(admin(), s, 'document', 'doc-a2')).toEqual({ storagePath: 'A/a2.pdf', filename: 'a2.pdf' })
    expect(await findPortalFile(admin(), s, 'document', 'doc-a2-job')).toMatchObject({ storagePath: 'A/j.pdf' })
    expect(await findPortalFile(admin(), s, 'photo', 'ph-a2')).toMatchObject({ storagePath: 'A/x.jpg' })
  })
  test('routes: pay / files for another customer’s id are 404; signed out is 401; cross-site is 403', async () => {
    const s = await sessionFor(A, 'a2')
    void s
    const p1 = await payPOST(post('/api/portal/invoices/inv-a1/pay', {}), { params: { id: 'inv-a1' } })
    expect(p1.status).toBe(404)
    const p2 = await payPOST(post('/api/portal/invoices/inv-b1/pay', {}), { params: { id: 'inv-b1' } })
    expect(p2.status).toBe(404)
    for (const [kind, id] of [['document', 'doc-a1'], ['document', 'doc-b1'], ['photo', 'ph-a1']]) {
      const r = await filesGET(new Request(`https://${A}.crm.test/api/portal/files/${kind}/${id}`), { params: { kind, id } })
      expect(r.status).toBe(404)
    }
    const ok = await filesGET(new Request(`https://${A}.crm.test/api/portal/files/document/doc-a2`), { params: { kind: 'document', id: 'doc-a2' } })
    expect(ok.status).toBe(302)
    expect(ok.headers.get('location')).toContain('A/a2.pdf')
    expect((await payPOST(post('/api/portal/invoices/inv-a2/pay', {}, { origin: 'https://evil.test' }), { params: { id: 'inv-a2' } })).status).toBe(403)
    mockCookie = undefined
    expect((await payPOST(post('/api/portal/invoices/inv-a2/pay', {}), { params: { id: 'inv-a2' } })).status).toBe(401)
    expect((await messagesPOST(post('/api/portal/messages', { body: 'hi' }))).status).toBe(401)
  })
  test('a message is saved for the portal customer only (a body naming another customer is ignored) and the company is emailed', async () => {
    await sessionFor(A, 'a2')
    const r = await messagesPOST(post('/api/portal/messages', { body: '  Can you come Friday?  ', customer_id: 'a1', org_id: B, direction: 'from_company' }))
    expect(r.status).toBe(200)
    const row = db.tables.portal_messages.find((m) => m.body === 'Can you come Friday?')!
    expect(row).toMatchObject({ org_id: A, customer_id: 'a2', direction: 'from_customer' })
    expect(mails.some((m) => m.to === 'office@green.test' && m.subject.includes('Bob Two'))).toBe(true)
    expect((await messagesPOST(post('/api/portal/messages', { body: '   ' }))).status).toBe(400)
    expect((await messagesPOST(post('/api/portal/messages', { body: 'x'.repeat(2001) }))).status).toBe(400)
  })
  test('messages are rate limited', async () => {
    await sessionFor(A, 'a2')
    let last = 200
    for (let i = 0; i < PORTAL_LIMITS.messagesPerCustomer.limit + 1; i++) last = (await messagesPOST(post('/api/portal/messages', { body: `hi ${i}` }))).status
    expect(last).toBe(429)
  })
})

describe('forwardable links are never a key to the portal', () => {
  test('no route turns a pay, signing or report link into a session; only the emailed sign-in link does', () => {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const root = path.join(process.cwd(), 'app/api/portal')
    expect(fs.existsSync(path.join(root, 'open'))).toBe(false)
    expect(fs.existsSync(path.join(process.cwd(), 'lib/portal/from-links.ts'))).toBe(false)
    const starters: string[] = []
    const walkDir = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name)
        if (e.isDirectory()) walkDir(f)
        else if (/startPortalSession/.test(fs.readFileSync(f, 'utf8'))) starters.push(path.relative(root, f))
      }
    }
    walkDir(root)
    expect(starters).toEqual(['enter/route.ts'])
  })
  test('the same routes refuse everything when the company turned the portal off', async () => {
    mockFeatureOff = new Set(['customerPortal'])
    const t = newPortalToken()
    db.tables.portal_login_tokens = [{ id: 'x', org_id: A, customer_id: 'a2', token_hash: hashPortalToken(t), expires_at: iso(1), used_at: null }]
    const e = await enterPOST(form('/api/portal/enter', { t }))
    expect(e.headers.get('set-cookie')).toBeNull()
  })
})
