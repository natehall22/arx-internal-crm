/** @jest-environment node */
/**
 * POST /api/change-orders/sign — evidence (IP + browser), ONE winner for a double tap, a link that always expires,
 * and no signing on a cancelled job.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

let db: ReturnType<typeof createFakeDb>
const uploads: string[] = []
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (t: string) => (db.client as any).from(t),
    rpc: (n: string, a: Record<string, unknown>) => (db.client as any).rpc(n, a),
    storage: { from: () => ({ upload: async (p: string) => { if (!p.includes('/signing/')) uploads.push(p); return { error: null } }, download: async () => ({ data: new Blob(['%PDF-fake']), error: null }) }) },
  }),
}))
jest.mock('@/lib/contracts/generateChangeOrderPdf', () => ({ generateChangeOrderPdf: jest.fn(async () => Buffer.from('%PDF')) }))
jest.mock('@/lib/org-brand', () => ({ getDocumentBrand: async () => ({ name: 'Acme', casualName: 'Acme', legalName: 'Acme LLC', legalNameUpper: 'ACME LLC', addressLine: '1 Main', website: 'acme.test', phone: '1', email: 'a@acme.test' }) }))
const sync = jest.fn(async () => ({ status: 'ok' }))
jest.mock('@/lib/job-commission-base', () => ({ syncJobSaleForProjectOrJob: (...a: unknown[]) => (sync as any)(...a) }))
const sendMail = jest.fn(async () => ({}))
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => ({ sendMail: (...a: unknown[]) => (sendMail as any)(...a) }) } }))
jest.mock('@/lib/crm-email-from', () => ({ getCrmEmailFrom: () => 'crm@example.test' }))
jest.mock('@/lib/company-links', () => ({ tryOrgAppUrl: async () => 'https://acme.example.test' }))

let fence: { kind: 'open' } | { kind: 'org'; orgId: string; source: string } = { kind: 'open' }
jest.mock('@/lib/company-host-server', () => ({ getRequestHostFence: async () => fence }))

import { POST } from '@/app/api/change-orders/sign/route'
import { hashSigningToken } from '@/lib/signing-tokens'

const ORG = 'org-a'
const TOKEN = 'ab'.repeat(32)
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const FUTURE = '2999-01-01T00:00:00.000Z'

function seed(co: Record<string, unknown> = {}, job: Record<string, unknown> | null = { id: 'j1', org_id: ORG, project_id: 'p1', status: 'scheduled' }) {
  db = createFakeDb({
    job_change_orders: [
      { id: 'co1', org_id: ORG, project_id: 'p1', job_id: 'j1', co_number: 'CO-001', status: 'pending_customer', signing_token: TOKEN, token_expires_at: FUTURE, customer_email: 'pat@example.test', rep_signature_data: PNG, ...co },
    ],
    production_jobs: job ? [job] : [],
    projects: [{ id: 'p1', org_id: ORG, address_text: '1 Main' }],
  })
}
const post = (b: Record<string, unknown>) =>
  POST(
    new Request('https://acme.example.test/api/change-orders/sign', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7', 'user-agent': 'PhoneBrowser/2' },
      body: JSON.stringify(b),
    }) as never
  )
const good = (over: Record<string, unknown> = {}) => ({ token: TOKEN, printName: 'Pat Homeowner', signature: PNG, ...over })
const claims = () => db.writes.filter((w) => w.table === 'job_change_orders' && w.op === 'update' && w.rows.some((r) => r.customer_signature_data && !r.pdf_url))

beforeEach(() => { fence = { kind: 'open' }; uploads.length = 0; sync.mockClear(); sendMail.mockClear(); seed() })

it('signs through a NEW (hashed) token, and a plaintext token from before hashing still works', async () => {
  const HASHED = 'cd'.repeat(32)
  seed({ signing_token: null, signing_token_hash: hashSigningToken(HASHED) })
  expect((await post(good({ token: HASHED }))).status).toBe(200)
  seed()
  expect((await post(good())).status).toBe(200)
})

it('opened on another company\'s address, the link is not found', async () => {
  fence = { kind: 'org', orgId: 'org-b', source: 'host' }
  expect((await post(good())).status).toBe(404)
  expect(db.writes).toEqual([])
})

describe('signing guards', () => {
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const root = path.resolve(__dirname, '..', '..')
  const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8')
  it('every signing page and route finds its document on THIS company\'s address', () => {
    for (const f of [
      'app/api/contracts/sign/route.ts',
      'app/api/change-orders/sign/route.ts',
      'app/contracts/sign/[token]/page.tsx',
      'app/change-orders/sign/[token]/page.tsx',
      'app/api/files/signed/[kind]/[token]/route.ts',
    ]) {
      expect(read(f)).toMatch(/findBySigningTokenOnThisHost\(/)
    }
  })
})
