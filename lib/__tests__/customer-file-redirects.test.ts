/** @jest-environment node */
const mockProfileId = { id: 'roofing' }
const mockRedirect = jest.fn((url: string) => { throw new Error(`REDIRECT:${url}`) })
jest.mock('next/navigation', () => ({ redirect: (u: string) => mockRedirect(u) }))
jest.mock('@/lib/auth', () => ({ requireAuth: async () => ({ profile: { role: 'admin', org_id: 'o1' } }) }))
jest.mock('@/lib/org-profile', () => ({ loadOrgProfile: async () => mockProfileId }))
jest.mock('@/lib/customer-file/customer-access', () => ({ resolveCustomerAccess: jest.fn() }))
jest.mock('@/lib/threads/api', () => ({ canOpenDeal: () => true }))
jest.mock('@/lib/threads/get-thread', () => ({ dealRefsFor: async (_a: unknown, _o: string, ids: string[]) => new Map(ids.map((i) => [i, {}])) }))
jest.mock('@/lib/threads/viewer', () => ({ resolveThreadViewer: async () => ({}) }))
let mockDeal: { id: string; customer_id: string } | null = null
let mockCount = 0
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const q: any = { select: () => q, eq: () => q, not: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: mockDeal }), then: (r: any) => r({ count: mockCount }) }
    return { from: () => q }
  },
}))
import { fileRedirectsEnabledFor, redirectLeadToFile } from '@/lib/customer-file/redirects'

describe('customer file redirect switch', () => {
  it('is off unless turned on', () => {
    for (const v of [undefined, '', 'off', 'false', '0', '  OFF ']) expect(fileRedirectsEnabledFor('admin', v)).toBe(false)
  })
  it('all / true turn it on for everyone', () => {
    for (const v of ['all', 'ALL', 'true', '1']) expect(fileRedirectsEnabledFor('setter', v)).toBe(true)
  })
  it('a role list turns it on for those roles only', () => {
    expect(fileRedirectsEnabledFor('operations', 'operations, admin')).toBe(true)
    expect(fileRedirectsEnabledFor('Admin', 'operations,admin')).toBe(true)
    expect(fileRedirectsEnabledFor('setter', 'operations,admin')).toBe(false)
  })
})

describe('redirectLeadToFile', () => {
  const run = async () => { try { await redirectLeadToFile('L1'); return null } catch (e) { return (e as Error).message } }
  beforeEach(() => { delete process.env.CUSTOMER_FILE_REDIRECTS; mockDeal = null; mockCount = 0; mockRedirect.mockClear() })
  it('roofing with the switch unset: no redirect (unchanged)', async () => {
    mockProfileId.id = 'roofing'; mockDeal = { id: 'D1', customer_id: 'C1' }
    expect(await run()).toBeNull()
    expect(mockRedirect).not.toHaveBeenCalled()
  })
  it('roofing with the switch on: unchanged (deal Sales tab / Prospect File)', async () => {
    process.env.CUSTOMER_FILE_REDIRECTS = 'all'; mockProfileId.id = 'roofing'; mockDeal = { id: 'D1', customer_id: 'C1' }
    expect(await run()).toBe('REDIRECT:/c/C1/d/D1/sales')
    mockDeal = null
    expect(await run()).toBe('REDIRECT:/c/lead/L1')
  })
  it('lawn ignores the switch: deal -> Sales tab, no deal -> Prospect File', async () => {
    mockProfileId.id = 'lawn_landscape'; mockDeal = { id: 'D1', customer_id: 'C1' }
    expect(await run()).toBe('REDIRECT:/c/C1/d/D1/sales')
    mockDeal = null
    expect(await run()).toBe('REDIRECT:/c/lead/L1')
  })
})
