/** @jest-environment node */
/**
 * "Generate PDF" for a signed contract whose PDF was never stored (/api/contracts/[id]/regenerate-pdf). Same company only, field roles barred.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

let authResult: unknown = null
jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(async () => {
    if (!authResult) throw new Error('Unauthorized')
    return authResult
  }),
}))
let barred = false
jest.mock('@/lib/sales-doc-access', () => ({ resolveSalesDocAccessBarred: jest.fn(async () => barred) }))
let db: ReturnType<typeof createFakeDb>
const uploads: string[] = []
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (t: string) => (db.client as any).from(t),
    rpc: (n: string, a: Record<string, unknown>) => (db.client as any).rpc(n, a),
    storage: { from: () => ({ upload: async (p: string) => { uploads.push(p); return { error: null } } }) },
  }),
}))
jest.mock('@/lib/contracts/generatePdf', () => ({ generateContractPdf: jest.fn(async () => Buffer.from('%PDF')) }))
jest.mock('@/lib/org-brand', () => ({ getDocumentBrand: async () => ({ name: 'Acme' }) }))

import { POST as regenerate } from '@/app/api/contracts/[id]/regenerate-pdf/route'

const as = (org: string) => {
  authResult = { authUser: { id: 'u1', email: null }, profile: { id: 'u1', org_id: org, role: 'admin', is_super_admin: false } }
}
beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-tests'
  uploads.length = 0
  barred = false
  as('org-a')
  db = createFakeDb({
    order_form_contracts: [
      { id: 'c-new', org_id: 'org-a', status: 'pending_customer', signing_token: '0b5d2485-9aba-4c1e-8f00-1234567890aa' },
      { id: 'c-old', org_id: 'org-a', status: 'pending_customer', signing_token: '0b5d2485-9aba-4c1e-8f00-1234567890ab' },
      { id: 'c-done', org_id: 'org-a', status: 'completed', signing_token: '0b5d2485-9aba-4c1e-8f00-1234567890bb' },
      { id: 'c-b', org_id: 'org-b', status: 'pending_customer', signing_token: '0b5d2485-9aba-4c1e-8f00-1234567890bb' },
      { id: 'c-nopdf', org_id: 'org-a', status: 'completed', customer_signature_data: 'x', customer_signed_at: '2026-11-01T00:00:00Z', agreement_type: 'installation' },
      { id: 'c-pdf', org_id: 'org-a', status: 'completed', pdf_storage_path: 'org/org-a/contracts/has.pdf', pdf_url: 'org/org-a/contracts/has.pdf' },
      { id: 'c-pend', org_id: 'org-a', status: 'pending_customer' },
    ],
    projects: [],
  })
})

describe('POST /api/contracts/[id]/regenerate-pdf', () => {
  const run = (id: string) => regenerate(new Request('https://x.test', { method: 'POST' }) as never, { params: { id } })

  it('stores the missing PDF of a signed contract, once', async () => {
    const res = await run('c-nopdf')
    expect(res.status).toBe(200)
    expect(db.tables.order_form_contracts.find((c) => c.id === 'c-nopdf')?.pdf_url).toBe(uploads[0])
    await run('c-nopdf')
    expect(uploads).toHaveLength(1)
  })

  it('never replaces a PDF that exists', async () => {
    expect((await run('c-pdf')).status).toBe(200)
    expect(uploads).toHaveLength(0)
    expect(db.tables.order_form_contracts.find((c) => c.id === 'c-pdf')?.pdf_url).toBe('org/org-a/contracts/has.pdf')
  })

  it('refuses an unsigned contract, another company\'s contract, the signed-out and field roles', async () => {
    expect((await run('c-pend')).status).toBe(400)
    expect((await run('c-b')).status).toBe(404)
    authResult = null
    expect((await run('c-nopdf')).status).toBe(401)
    as('org-a'); barred = true
    expect((await run('c-nopdf')).status).toBe(403)
    expect(uploads).toHaveLength(0)
  })
})
