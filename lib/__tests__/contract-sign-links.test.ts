/** @jest-environment node */
/**
 * POST /api/contracts/sign — what the server enforces whatever the page sent: signature shape, required initials,
 * ONE winner for a double tap, and a signature that is never lost when the PDF cannot be made.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

let db: ReturnType<typeof createFakeDb>
const uploads: string[] = []
let uploadFails = false
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (t: string) => (db.client as any).from(t),
    rpc: (n: string, a: Record<string, unknown>) => (db.client as any).rpc(n, a),
    storage: {
      from: () => ({
        download: async () => ({ data: new Blob(['%PDF-fake']), error: null }),
        upload: async (path: string) => {
          if (uploadFails) return { error: { message: 'bucket down' } }
          if (!path.includes('/signing/')) uploads.push(path)
          return { error: null }
        },
      }),
    },
  }),
}))
const generate = jest.fn(async () => Buffer.from('%PDF-fake'))
jest.mock('@/lib/contracts/generatePdf', () => ({ generateContractPdf: (...a: unknown[]) => (generate as any)(...a) }))
jest.mock('@/lib/org-brand', () => ({
  getDocumentBrand: async () => ({ name: 'Acme Roofing', casualName: 'Acme', legalName: 'Acme LLC', legalNameUpper: 'ACME LLC', addressLine: '1 Main', website: 'acme.test', phone: '1', email: 'a@acme.test' }),
}))
const sendMail = jest.fn(async () => ({}))
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => ({ sendMail: (...a: unknown[]) => (sendMail as any)(...a) }) } }))
jest.mock('@/lib/crm-email-from', () => ({ getCrmEmailFrom: () => 'crm@example.test' }))
jest.mock('@/lib/company-links', () => ({ tryOrgAppUrl: async () => 'https://acme.example.test' }))
jest.mock('@/lib/admin-sale-email', () => ({ buildOrderFormContractSaleDescription: () => '', notifyOrgAdminsOfSale: jest.fn() }))

let fence: { kind: 'open' } | { kind: 'org'; orgId: string; source: string } | { kind: 'closed'; reason: string } = { kind: 'open' }
jest.mock('@/lib/company-host-server', () => ({ getRequestHostFence: async () => fence }))

import { POST } from '@/app/api/contracts/sign/route'
import { hashSigningToken } from '@/lib/signing-tokens'

const ORG = 'org-a'
const TOKEN = '0b5d2485-9aba-4c1e-8f00-1234567890ab'
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const FUTURE = '2999-01-01T00:00:00.000Z'

function seed(extra: Record<string, unknown> = {}) {
  db = createFakeDb({
    order_form_contracts: [
      {
        id: 'c1', org_id: ORG, agreement_type: 'contingency', status: 'pending_customer', signing_token: TOKEN,
        token_expires_at: FUTURE, customer_name: 'Pat', customer_email: 'pat@example.test', project_address: '1 Main', payment_method: 'cash',
        opportunity_id: 'o1', created_by: 'u1', ...extra,
      },
    ],
    opportunities: [{ id: 'o1', org_id: ORG }],
    projects: [],
    activities: [],
  })
}
const post = (b: Record<string, unknown>, headers: Record<string, string> = {}) =>
  POST(
    new Request('https://acme.example.test/api/contracts/sign', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'user-agent': 'TestBrowser/1.0', ...headers },
      body: JSON.stringify(b),
    }) as never
  )
const good = (over: Record<string, unknown> = {}) => ({
  token: TOKEN, printName: 'Pat Homeowner', signature: PNG, preferredContact: 'email', initialsInsurance: 'PH', ...over,
})
const claims = () => db.writes.filter((w) => w.table === 'order_form_contracts' && w.op === 'update' && w.rows.some((r) => r.status === 'completed' && r.customer_signature_data && !r.pdf_url))

beforeEach(() => {
  fence = { kind: 'open' }
  uploads.length = 0
  uploadFails = false
  generate.mockClear()
  sendMail.mockClear()
  seed()
})

describe('links', () => {
  const HASHED = '5c1e7b0e-2f4a-4c55-9d3e-0a1b2c3d4e5f'

  it('signs through a NEW (hashed) token — the row holds no plaintext token', async () => {
    seed({ signing_token: null, signing_token_hash: hashSigningToken(HASHED) })
    const res = await post(good({ token: HASHED }))
    expect(res.status).toBe(200)
    expect(db.tables.order_form_contracts[0].status).toBe('completed')
    expect((await res.json()).pdfUrl).toContain(`/api/files/signed/contract/${HASHED}`)
  })

  it('a link sent before hashing (plaintext token on the row) still signs', async () => {
    const res = await post(good())
    expect(res.status).toBe(200)
  })

  it('the stored hash is not a token: posting it finds nothing', async () => {
    seed({ signing_token: null, signing_token_hash: hashSigningToken(HASHED) })
    const res = await post(good({ token: hashSigningToken(HASHED) }))
    expect(res.status).toBe(404)
  })

  it('opened on another company\'s address, the link is not found and nothing is written', async () => {
    fence = { kind: 'org', orgId: 'org-b', source: 'host' }
    const res = await post(good())
    expect(res.status).toBe(404)
    expect(db.writes).toEqual([])
    expect(db.tables.order_form_contracts[0].status).toBe('pending_customer')
  })

  it('opened on the company\'s own address it signs; a closed (apex) address refuses', async () => {
    fence = { kind: 'org', orgId: ORG, source: 'host' }
    expect((await post(good())).status).toBe(200)
    seed()
    fence = { kind: 'closed', reason: 'apex' }
    expect((await post(good())).status).toBe(404)
  })
})
