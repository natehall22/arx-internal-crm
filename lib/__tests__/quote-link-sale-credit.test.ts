/** @jest-environment node */
/** Sending a quote link confirms the sale credit first (like the contract screen), so signing never credits the sender. */
let role = 'sales_rep'
jest.mock('@/lib/auth', () => ({ requireAuthApi: async () => ({ authUser: { id: 'u1' }, profile: { id: 'u1', org_id: 'org-1', role } }) }))
jest.mock('@/lib/online-payments/access', () => ({ crossSiteWrite: () => false }))
jest.mock('@/lib/org-features-server', () => ({ orgFeatureOffResponse: async () => null }))
jest.mock('@/lib/sales-doc-access', () => ({ resolveSalesDocAccessBarred: async () => false }))
jest.mock('@/lib/super-admin', () => ({ isSuperAdmin: () => false }))
jest.mock('@/lib/org-profile', () => ({ loadOrgProfile: async () => ({}), t: () => 'quote' }))
const saveDealSaleCredit = jest.fn(async () => ({ ok: true }))
const loadDealSaleCredit = jest.fn(async () => ({ credit: { closerUserId: 'closer-1', setterUserId: null, isSelfGenerated: false }, locked: false }))
jest.mock('@/lib/deal-sale-credit', () => ({
  ...jest.requireActual('@/lib/deal-sale-credit'),
  saveDealSaleCredit: (...a: unknown[]) => (saveDealSaleCredit as (...x: unknown[]) => unknown)(...a),
  loadDealSaleCredit: (...a: unknown[]) => (loadDealSaleCredit as (...x: unknown[]) => unknown)(...a),
}))
const createQuoteLink = jest.fn(async () => ({ id: 'l1', url: 'https://x.test/q/t', expiresAt: '2030-01-01T00:00:00Z' }))
jest.mock('@/lib/quotes/links', () => ({ createQuoteLink: (...a: unknown[]) => (createQuoteLink as (...x: unknown[]) => unknown)(...a), revokeQuoteLinks: jest.fn() }))
jest.mock('@/lib/quotes/send', () => ({ sendQuoteLinkEmail: async () => ({ ok: true }) }))
jest.mock('@/lib/quotes/approve', () => ({ finalizeApproval: jest.fn(), loadApproval: async () => null }))
const ctx = {
  proposal: { id: 'p1', org_id: 'org-1', opportunity_id: 'o1', status: 'draft', customer_name: 'Pat', customer_address: '1 Main', customer_email: 'p@x.test', title: 'T', discount_amount: 0, discount_percent: 0, deposit_mode: null, deposit_value: null },
  lines: [{ id: 'l1', name: 'Mow', line_total: 100, unit_price: 100, unit: 'each' }],
  tax: { kind: 'legacy', percent: 0 },
  settings: { depositMode: 'none', depositPercent: 0, depositFixedCents: 0, linkDays: 30, terms: '' },
}
jest.mock('@/lib/quotes/load', () => ({
  ...jest.requireActual('@/lib/quotes/load'),
  loadQuoteContext: async () => ctx,
}))
import { createFakeDb } from '@/lib/test-helpers/fake-db'
const db = createFakeDb({ proposals: [{ id: 'p1', org_id: 'org-1', status: 'draft' }], order_form_contracts: [], quote_links: [] })
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { POST } from '@/app/api/proposals/[id]/quote-link/route'

const call = async (body: unknown) => (await POST(new Request('http://x.test/api/proposals/p1/quote-link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: { id: 'p1' } }))!

beforeEach(() => { jest.clearAllMocks(); role = 'sales_rep' })

describe('quote link: sale credit', () => {
  it('refuses to send with no sale credit confirmed', async () => {
    expect((await call({ action: 'link' })).status).toBe(400)
    expect(createQuoteLink).not.toHaveBeenCalled()
  })
  it('refuses a send with no closer', async () => {
    expect((await call({ action: 'link', saleCredit: { setterUserId: 's1' } })).status).toBe(400)
    expect(createQuoteLink).not.toHaveBeenCalled()
  })
  it('saves the confirmed credit through the one writer before the link exists', async () => {
    const res = await call({ action: 'link', saleCredit: { closerUserId: 'closer-1', setterUserId: null, isSelfGenerated: false } })
    expect(res.status).toBe(200)
    expect(saveDealSaleCredit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ orgId: 'org-1', opportunityId: 'o1', next: { closerUserId: 'closer-1', setterUserId: null, isSelfGenerated: false } }))
    expect(saveDealSaleCredit.mock.invocationCallOrder[0]).toBeLessThan(createQuoteLink.mock.invocationCallOrder[0])
  })
  it('a rep may confirm the stored credit but not change it (never credit themselves)', async () => {
    const res = await call({ action: 'link', saleCredit: { closerUserId: 'u1' } })
    expect(res.status).toBe(403)
    expect(saveDealSaleCredit).not.toHaveBeenCalled()
    expect(createQuoteLink).not.toHaveBeenCalled()
  })
  it('an owner may change it', async () => {
    role = 'owner'
    expect((await call({ action: 'link', saleCredit: { closerUserId: 'u1' } })).status).toBe(200)
    expect(saveDealSaleCredit).toHaveBeenCalled()
  })
})
