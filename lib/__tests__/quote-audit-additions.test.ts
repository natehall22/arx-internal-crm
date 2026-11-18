/** @jest-environment node */
const resolveLink = jest.fn()
jest.mock('@/lib/quotes/links', () => ({ resolvePublicQuoteLink: (...a: unknown[]) => resolveLink(...a) }))
jest.mock('@/lib/org-features', () => ({ loadOrgFeatures: async () => ({ quoteApproval: true }) }))
const loadCtx = jest.fn()
jest.mock('@/lib/quotes/load', () => ({ loadQuoteContext: (...a: unknown[]) => loadCtx(...a) }))
const post = jest.fn()
jest.mock('@/lib/threads/post-message', () => ({ postCustomerMessage: (...a: unknown[]) => post(...a) }))
const notify = jest.fn()
jest.mock('@/lib/portal/messages', () => ({ notifyCompanyOfPortalMessage: (...a: unknown[]) => notify(...a) }))
const take = jest.fn()
jest.mock('@/lib/portal/server', () => ({ takePortalAttempt: (...a: unknown[]) => take(...a) }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))

import { visibleNav, type NavContext } from '@/lib/nav-config'
import { POST } from '@/app/api/q/[token]/changes/route'

const flags = { isOpsOnly: false, canSeeOpsDashboard: false, canSeeJobBoard: false, canSeeInsideSales: false, projectsBarred: false, salesDocBarred: false, customerRecords: false, reports: false, isPayrollAdmin: false, earnsPay: false, payWeek: true }
const ctx = (o: Partial<NavContext> = {}): NavContext => ({ permsReady: true, role: 'owner', fullAccess: true, permissionNames: new Set(), flags, ...o })
const leaf = (c: NavContext) => visibleNav(c).sections.flatMap((s) => s.children).find((l) => l.href === '/proposals')

describe('Quotes menu entry', () => {
  it('roofing (no quoteApproval switch) gets no new menu entry', () => {
    expect(leaf(ctx())).toBeUndefined()
    expect(leaf(ctx({ features: { quoteApproval: false } }))).toBeUndefined()
  })
  it('a quote company sees it under the profile word', () => {
    const p = { nav: { order: [], hidden: [] }, terms: { jobs: 'Jobs', jobBoard: 'Job Board', proposal: 'Quote' } }
    expect(leaf(ctx({ features: { quoteApproval: true }, profile: p }))?.label).toBe('Quotes')
    expect(leaf(ctx({ features: { quoteApproval: true } }))?.label).toBe('Proposals')
  })
  it('stays behind the sales-document bar', () => {
    expect(leaf(ctx({ features: { quoteApproval: true }, flags: { ...flags, salesDocBarred: true } }))).toBeUndefined()
  })
})

describe('Ask for changes', () => {
  const req = (body: unknown) => new Request('http://x.test/api/q/t/changes', { method: 'POST', body: JSON.stringify(body) })
  const params = { params: { token: 't' } }
  beforeEach(() => {
    jest.clearAllMocks()
    resolveLink.mockResolvedValue({ id: 'l-' + Math.random(), org_id: 'o1', proposal_id: 'p1' })
    loadCtx.mockResolvedValue({ customerId: 'c1', proposal: { proposal_number: 'P-7', opportunity_id: 'opp1' } })
    post.mockResolvedValue({ ok: true, id: 'm1' })
    notify.mockResolvedValue(undefined)
    take.mockResolvedValue(true)
  })
  it('goes through the one customer-message path on the quote’s own deal and emails the company', async () => {
    const res = await POST(req({ message: 'Can you skip the mulch?' }), params)
    expect(res.status).toBe(200)
    expect(post.mock.calls[0][1]).toMatchObject({ orgId: 'o1', customerId: 'c1', opportunityId: 'opp1', body: 'Change request on quote P-7: Can you skip the mulch?' })
    expect(notify).toHaveBeenCalledTimes(1)
  })
  it('uses the database-backed limiter, per address and per quote, and refuses when it says no', async () => {
    await POST(req({ message: 'one' }), params)
    expect(take.mock.calls.map((c) => c[1])).toEqual([expect.stringMatching(/^q-changes:/), 'q-changes-link:p1'])
    take.mockResolvedValue(false)
    expect((await POST(req({ message: 'two' }), params)).status).toBe(429)
    expect(post).toHaveBeenCalledTimes(1)
  })
  it('refuses an empty message, a dead link, and a quote with no customer', async () => {
    expect((await POST(req({ message: '  ' }), params)).status).toBe(400)
    resolveLink.mockResolvedValue(null)
    expect((await POST(req({ message: 'hi' }), params)).status).toBe(404)
    resolveLink.mockResolvedValue({ id: 'l-x', org_id: 'o1', proposal_id: 'p1' })
    loadCtx.mockResolvedValue({ customerId: null, proposal: {} })
    expect((await POST(req({ message: 'hi' }), params)).status).toBe(409)
    expect(post).not.toHaveBeenCalled()
  })
})
