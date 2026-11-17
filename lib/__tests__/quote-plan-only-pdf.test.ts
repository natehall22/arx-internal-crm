/** @jest-environment node */
jest.mock('@/lib/company-host', () => ({ fenceAllowsOrg: () => true }))
jest.mock('@/lib/company-host-server', () => ({ getRequestHostFence: async () => null }))
const loadApproval = jest.fn()
jest.mock('@/lib/quotes/approve', () => ({ loadApproval: (...a: unknown[]) => loadApproval(...a) }))
import { createFakeDb } from '@/lib/test-helpers/fake-db'
const db = createFakeDb({ quote_approvals: [{ id: 'a1', org_id: 'org-1', pdf_path: 'org/org-1/quotes/a1.pdf' }] })
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
const resolve = jest.fn()
jest.mock('@/lib/quotes/links', () => ({ resolvePublicQuoteLink: (...a: unknown[]) => resolve(...a) }))
const sign = jest.fn()
jest.mock('@/lib/files/files-object', () => ({ ...jest.requireActual('@/lib/files/files-object'), signFilesObject: (...a: unknown[]) => sign(...a) }))

import { GET } from '@/app/api/q/[token]/pdf/route'
import { approvalPdfPath } from '@/lib/quotes/approval-pdf-path'

beforeEach(() => {
  jest.clearAllMocks()
  resolve.mockResolvedValue({ id: 'l1', org_id: 'org-1', proposal_id: 'p1' })
  loadApproval.mockResolvedValue({ id: 'a1', contract_id: null })
  sign.mockResolvedValue('https://files.example.test/signed')
})
const get = () => GET(new Request('http://x.test/api/q/t/pdf'), { params: { token: 't' } })

describe('plan-only approval PDF', () => {
  it('reads pdf_path when there is no contract, and the contract pdf otherwise', async () => {
    expect(await approvalPdfPath(db.client, 'org-1', { id: 'a1', contract_id: null })).toBe('org/org-1/quotes/a1.pdf')
    expect(await approvalPdfPath(db.client, 'org-2', { id: 'a1', contract_id: null })).toBeNull() // org scoped
  })
  it('the customer link redirects to a short-lived signed address', async () => {
    const res = await get()
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://files.example.test/signed')
    expect(sign.mock.calls[0][1]).toBe('org/org-1/quotes/a1.pdf')
  })
  it('a dead link or an approval with no PDF is a 404', async () => {
    resolve.mockResolvedValue(null)
    expect((await get()).status).toBe(404)
    resolve.mockResolvedValue({ id: 'l1', org_id: 'org-1', proposal_id: 'p1' })
    loadApproval.mockResolvedValue({ id: 'zzz', contract_id: null })
    expect((await get()).status).toBe(404)
  })
})
