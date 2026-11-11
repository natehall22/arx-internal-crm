/** @jest-environment node */
/**
 * The two office-side signing routes: "Copy link" for a document still waiting (/api/signing-link) and "Generate PDF" for a
 * signed contract whose PDF was never stored (/api/contracts/[id]/regenerate-pdf). Same company only, field roles barred.
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
jest.mock('@/lib/org-brand', () => ({ getDocumentBrand: async () => ({ name: 'Acme' }) }))

import { GET as getLink } from '@/app/api/signing-link/[kind]/[id]/route'
import { newSigningTokenColumns } from '@/lib/signing-tokens'

const as = (org: string) => {
  authResult = { authUser: { id: 'u1', email: null }, profile: { id: 'u1', org_id: org, role: 'admin', is_super_admin: false } }
}
const link = (kind: string, id: string) =>
  getLink(new Request('https://x.test/api/signing-link') as never, { params: { kind, id } })

let newContract: ReturnType<typeof newSigningTokenColumns>
let newCo: ReturnType<typeof newSigningTokenColumns>
beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-tests'
  uploads.length = 0
  barred = false
  as('org-a')
  newContract = newSigningTokenColumns('contract')
  newCo = newSigningTokenColumns('change-order')
  db = createFakeDb({
    order_form_contracts: [
      { id: 'c-new', org_id: 'org-a', status: 'pending_customer', ...newContract.columns },
      { id: 'c-old', org_id: 'org-a', status: 'pending_customer', signing_token: '0b5d2485-9aba-4c1e-8f00-1234567890ab' },
      { id: 'c-done', org_id: 'org-a', status: 'completed', ...newSigningTokenColumns('contract').columns },
      { id: 'c-b', org_id: 'org-b', status: 'pending_customer', ...newSigningTokenColumns('contract').columns },
      { id: 'c-nopdf', org_id: 'org-a', status: 'completed', customer_signature_data: 'x', customer_signed_at: '2026-11-01T00:00:00Z', agreement_type: 'installation' },
      { id: 'c-pdf', org_id: 'org-a', status: 'completed', pdf_storage_path: 'org/org-a/contracts/has.pdf', pdf_url: 'org/org-a/contracts/has.pdf' },
      { id: 'c-pend', org_id: 'org-a', status: 'pending_customer' },
    ],
    job_change_orders: [{ id: 'co-new', org_id: 'org-a', status: 'pending_customer', ...newCo.columns }],
    projects: [],
  })
})

describe('GET /api/signing-link', () => {
  it('opens a new (hashed) contract link and a change-order link', async () => {
    const res = await link('contract', 'c-new')
    expect(res.status).toBe(200)
    expect((await res.json()).path).toBe(`/contracts/sign/${newContract.token}`)
    expect((await (await link('change-order', 'co-new')).json()).path).toBe(`/change-orders/sign/${newCo.token}`)
  })

  it('a link from before hashing is read straight off the row', async () => {
    expect((await (await link('contract', 'c-old')).json()).path).toBe('/contracts/sign/0b5d2485-9aba-4c1e-8f00-1234567890ab')
  })

  it('never opens a signed document, another company\'s document, or an unknown kind', async () => {
    expect((await link('contract', 'c-done')).status).toBe(404)
    expect((await link('contract', 'c-b')).status).toBe(404)
    expect((await link('invoice', 'c-new')).status).toBe(404)
    expect((await link('contract', 'missing')).status).toBe(404)
  })

  it('refuses the signed-out and field roles', async () => {
    authResult = null
    expect((await link('contract', 'c-new')).status).toBe(401)
    as('org-a'); barred = true
    expect((await link('contract', 'c-new')).status).toBe(403)
  })

  it('a row whose encrypted copy cannot be opened (no secret) has no link to give', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'a-different-key'
    expect((await link('contract', 'c-new')).status).toBe(404)
  })
})

