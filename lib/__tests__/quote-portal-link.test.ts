/** @jest-environment node */
jest.mock('@/lib/company-links', () => ({ orgAppUrl: async () => 'https://crm.example.test' }))
jest.mock('@/lib/company-host', () => ({ fenceAllowsOrg: () => true }))
jest.mock('@/lib/company-host-server', () => ({ getRequestHostFence: async () => null }))
const takeAttempt = jest.fn()
jest.mock('@/lib/portal/server', () => ({ takePortalAttempt: (...a: unknown[]) => takeAttempt(...a) }))
const apiCtx = { admin: null as unknown, session: { orgId: 'org-1', customerId: 'c1' } }
jest.mock('@/lib/portal/api', () => ({ requirePortalApi: async () => apiCtx, portalJson: (b: unknown, status = 200) => new Response(JSON.stringify(b), { status }) }))
jest.mock('@/lib/org-features', () => ({ loadOrgFeatures: async () => ({ quoteApproval: true }) }))
const loadApproval = jest.fn()
jest.mock('@/lib/quotes/approve', () => ({ loadApproval: (...a: unknown[]) => loadApproval(...a) }))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { portalQuoteLink, createQuoteLink } from '@/lib/quotes/links'
import { POST } from '@/app/api/portal/quotes/[id]/open/route'

const ORG = 'org-1'
const FUTURE = new Date(Date.now() + 10 * 86_400_000).toISOString()
const emailed = { id: 'ql1', org_id: ORG, proposal_id: 'p1', token_hash: 'h1', created_at: '2027-01-01T00:00:00Z', expires_at: FUTURE, revoked_at: null, first_opened_at: '2027-01-02T00:00:00Z', last_opened_at: null, sent_to: 'pat@x.test' }

function db() {
  const d = createFakeDb({
    proposals: [{ id: 'p1', org_id: ORG, status: 'sent', opportunity_id: 'o1' }],
    opportunities: [{ id: 'o1', org_id: ORG, customer_id: 'c1' }],
    quote_links: [{ ...emailed }],
  })
  apiCtx.admin = d.client
  return d
}
const call = () => POST(new Request('http://x.test/api/portal/quotes/p1/open', { method: 'POST' }), { params: { id: 'p1' } })

beforeEach(() => {
  process.env.SIGNING_TOKEN_SECRET = 'test-secret'
  jest.clearAllMocks()
  takeAttempt.mockResolvedValue(true)
  loadApproval.mockResolvedValue(null)
})

describe('portal "open quote"', () => {
  it('makes ONE portal link, reuses it on the next tap, keeps the quote expiry and leaves the emailed link alone', async () => {
    const d = db()
    const a = await (await call()).json()
    const b = await (await call()).json()
    expect(a.url).toMatch(/^\/q\/[A-Za-z0-9_-]{20,}$/)
    expect(b.url).toBe(a.url)
    const rows = d.tables.quote_links
    expect(rows).toHaveLength(2)
    const portal = rows.find((r) => r.sent_to === 'portal')!
    expect(portal.expires_at).toBe(FUTURE)
    expect(portal.portal_token_enc).toBeTruthy()
    const mail = rows.find((r) => r.id === 'ql1')!
    expect(mail.revoked_at).toBeNull() // the emailed link still works
    expect(mail.first_opened_at).toBe('2027-01-02T00:00:00Z') // "opened" history untouched
  })
  it('rate limits per customer', async () => {
    db()
    takeAttempt.mockResolvedValue(false)
    expect((await call()).status).toBe(429)
    expect(takeAttempt.mock.calls[0][1]).toContain('c1')
  })
  it('needs a live emailed link (the quote must be out and unexpired)', async () => {
    const d = db()
    d.tables.quote_links[0].expires_at = '2020-01-01T00:00:00Z'
    expect((await call()).status).toBe(409)
  })
  it('says so when no token can be sealed, rather than minting a link nobody can reuse', async () => {
    const d = db()
    const keys = ['SIGNING_TOKEN_SECRET', 'CUSTOMER_MESSAGE_LINK_SECRET', 'SUPABASE_SERVICE_ROLE_KEY']
    const saved = keys.map((k) => process.env[k])
    keys.forEach((k) => delete process.env[k])
    try {
      expect((await call()).status).toBe(503)
      expect(d.tables.quote_links).toHaveLength(1)
    } finally {
      keys.forEach((k, i) => { if (saved[i] != null) process.env[k] = saved[i] })
    }
  })
  it('a resend (createQuoteLink) retires the portal link too; the portal then mints a new one', async () => {
    const d = db()
    const first = await portalQuoteLink(d.client, ORG, 'p1', FUTURE)
    await createQuoteLink(d.client, ORG, 'p1', 'u1', 30)
    expect(d.tables.quote_links.filter((r) => !r.revoked_at)).toHaveLength(1)
    const second = await portalQuoteLink(d.client, ORG, 'p1', FUTURE)
    expect(second!.url).not.toBe(first!.url)
  })
})
