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

import { POST } from '@/app/api/change-orders/sign/route'

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

beforeEach(() => { uploads.length = 0; sync.mockClear(); sendMail.mockClear(); seed() })

it('signs and keeps the IP and the browser, like a contract', async () => {
  const res = await post(good())
  expect(res.status).toBe(200)
  expect(db.tables.job_change_orders[0]).toMatchObject({ status: 'completed', customer_ip: '198.51.100.7', customer_user_agent: 'PhoneBrowser/2', customer_print_name: 'Pat Homeowner' })
  expect(sync).toHaveBeenCalledTimes(1)
})

it('a double tap signs once: one claim, one money sync, one PDF, one email', async () => {
  const [a, b] = await Promise.all([post(good()), post(good())])
  expect([a.status, b.status]).toEqual([200, 200])
  expect([(await a.json()).alreadySigned, (await b.json()).alreadySigned].filter(Boolean)).toHaveLength(1)
  expect(claims()).toHaveLength(1)
  expect(sync).toHaveBeenCalledTimes(1)
  expect(uploads).toHaveLength(1)
  expect(sendMail).toHaveBeenCalledTimes(1)
})

it('a link with no expiry on file is treated as expired', async () => {
  seed({ token_expires_at: null })
  const res = await post(good())
  expect(res.status).toBe(400)
  expect(db.tables.job_change_orders[0].status).toBe('pending_customer')
  expect(sync).not.toHaveBeenCalled()
})

it('refuses an expired link', async () => {
  seed({ token_expires_at: '2020-01-01T00:00:00Z' })
  expect((await post(good())).status).toBe(400)
})

it('refuses to sign when the job is cancelled (by job, and by project when there is no job id)', async () => {
  seed({}, { id: 'j1', org_id: ORG, project_id: 'p1', status: 'cancelled' })
  const res = await post(good())
  expect(res.status).toBe(409)
  expect(db.tables.job_change_orders[0].status).toBe('pending_customer')
  expect(sync).not.toHaveBeenCalled()

  seed({ job_id: null }, { id: 'j1', org_id: ORG, project_id: 'p1', status: 'cancelled' })
  expect((await post(good())).status).toBe(409)
})

it('a job that is not cancelled, or a job in another company, does not block', async () => {
  seed({}, { id: 'j9', org_id: 'org-b', project_id: 'p1', status: 'cancelled' })
  expect((await post(good())).status).toBe(200)
})

it('refuses a bad signature or name before touching the row', async () => {
  expect((await post(good({ signature: 'scribble' }))).status).toBe(400)
  expect((await post(good({ printName: ' ' }))).status).toBe(400)
  expect(db.writes).toEqual([])
})

it('a change order that is neither pending nor signed is not signable', async () => {
  seed({ status: 'voided' })
  expect((await post(good())).status).toBe(400)
  expect(db.writes).toEqual([])
})

it('an already-signed change order answers with the signed result and changes nothing', async () => {
  await post(good())
  sync.mockClear()
  const res = await post(good({ printName: 'Other' }))
  expect(res.status).toBe(200)
  expect((await res.json()).alreadySigned).toBe(true)
  expect(db.tables.job_change_orders[0].customer_print_name).toBe('Pat Homeowner')
  expect(sync).not.toHaveBeenCalled()
})

describe('signing engine on the change-order route', () => {
  const consentOn = () => { (db.tables as any).orgs = [{ id: ORG, settings: { signing: { consentStep: true } } }] }
  const evidence = () => ({ ...(db.tables as any) })

  it('refuses a signature without consent when the company requires it, and writes nothing', async () => {
    consentOn()
    const before = db.writes.length
    const res = await post(good())
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('consent_required')
    expect(db.tables.job_change_orders[0].status).toBe('pending_customer')
    expect(db.writes.length).toBe(before)
    expect(sync).not.toHaveBeenCalled()
  })

  it('stores the consent version with the signature when given', async () => {
    consentOn()
    const res = await post(good({ consent: { accepted: true, version: 'v1-2026-11' } }))
    expect(res.status).toBe(200)
    expect(db.tables.job_change_orders[0]).toMatchObject({ status: 'completed', consent_version: 'v1-2026-11' })
  })

  it('with no company switch, signs exactly as before (no consent needed, none stored)', async () => {
    const res = await post(good())
    expect(res.status).toBe(200)
    expect(db.tables.job_change_orders[0].consent_version ?? null).toBeNull()
  })

  it('a double tap leaves one hash, one certificate and one set of events (when the migration is in)', async () => {
    (db.tables as any).signing_envelopes = []; (db.tables as any).signing_events = []
    await Promise.all([post(good()), post(good())])
    const envs = evidence().signing_envelopes as any[]
    expect(envs).toHaveLength(1)
    expect(envs[0].pdf_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(envs[0].certificate_path).toContain('/signing/')
    const ev = (evidence().signing_events as any[]).map((e) => e.event)
    expect(ev.filter((e) => e === 'signed')).toHaveLength(1)
    expect(ev.filter((e) => e === 'completed')).toHaveLength(1)
    expect(ev.filter((e) => e === 'certificate_issued')).toHaveLength(1)
  })
})
