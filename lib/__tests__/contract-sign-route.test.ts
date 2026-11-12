/** @jest-environment node */
/**
 * POST /api/contracts/sign — what the server enforces whatever the page sent: signature shape, required initials,
 * ONE winner for a double tap, and a signature that is never lost when the PDF cannot be made.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

let db: ReturnType<typeof createFakeDb>
const uploads: string[] = []
let uploadFails = false
let downloadFails = false
/** Make the next write(s) to a table fail: { table, op, when(patch/row), times }. */
let failRules: Array<{ table: string; op: 'update' | 'insert'; when?: (v: any) => boolean; times: number }> = []
function failing(): any {
  const p: any = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? (res: (v: unknown) => void) => res({ data: null, error: { message: 'injected failure' }, count: null }) : () => p),
  })
  return p
}
function withFailures(t: string, b: any) {
  return new Proxy(b, {
    get: (target, k: string) => {
      const v = target[k]
      if (k !== 'update' && k !== 'insert') return typeof v === 'function' ? v.bind(target) : v
      return (arg: unknown) => {
        const rule = failRules.find((r) => r.table === t && r.op === k && r.times > 0 && (!r.when || r.when(arg)))
        if (rule) {
          rule.times--
          return failing()
        }
        return v.call(target, arg)
      }
    },
  })
}
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (t: string) => withFailures(t, (db.client as any).from(t)),
    rpc: (n: string, a: Record<string, unknown>) => (db.client as any).rpc(n, a),
    storage: {
      from: () => ({
        upload: async (path: string) => {
          if (uploadFails) return { error: { message: 'bucket down' } }
          if (!path.includes('/signing/')) uploads.push(path)
          return { error: null }
        },
        download: async () => (downloadFails ? { data: null, error: { message: 'down' } } : { data: new Blob(['%PDF-fake']), error: null }),
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

import { POST } from '@/app/api/contracts/sign/route'

const ORG = 'org-a'
const TOKEN = '0b5d2485-9aba-4c1e-8f00-1234567890ab'
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const FUTURE = '2999-01-01T00:00:00.000Z'

function seed(extra: Record<string, unknown> = {}) {
  db = createFakeDb({
    orgs: [{ id: ORG, settings: { features: { quickbooks: true } } }],
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
const claims = () => db.writes.filter((w) => w.table === 'order_form_contracts' && w.op === 'update' && w.rows.some((r) => r.status === 'completed' && r.customer_signature_data && !r.pdf_url && !r.signing_steps))

beforeEach(() => {
  failRules = []
  uploads.length = 0
  uploadFails = false
  downloadFails = false
  generate.mockClear()
  sendMail.mockClear()
  seed()
})

describe('server-side checks', () => {
  it.each([
    ['not an image', { signature: 'hello' }],
    ['a jpeg', { signature: 'data:image/jpeg;base64,/9j/4AAQ' }],
    ['not a PNG underneath', { signature: 'data:image/png;base64,AAAA' }],
    ['huge', { signature: `data:image/png;base64,iVBORw0KGgo${'A'.repeat(400_100)}` }],
  ])('refuses a signature that is %s', async (_n, over) => {
    const res = await post(good(over))
    expect(res.status).toBe(400)
    expect(db.tables.order_form_contracts[0].status).toBe('pending_customer')
    expect(db.writes).toEqual([])
  })

  it('refuses a blank, over-long or missing printed name', async () => {
    expect((await post(good({ printName: '   ' }))).status).toBe(400)
    expect((await post(good({ printName: 'x'.repeat(201) }))).status).toBe(400)
    expect(db.writes).toEqual([])
  })

  it('refuses an unknown preferred contact (the column would reject it)', async () => {
    expect((await post(good({ preferredContact: 'carrier-pigeon' }))).status).toBe(400)
    expect(db.writes).toEqual([])
  })

  it.each([
    ['contingency with no insurance initials', { agreement_type: 'contingency' }, { initialsInsurance: '' }],
    ['repair with no initials', { agreement_type: 'repair', payment_method: 'cash' }, { initialsInsurance: null, initialsChangeOrders: null }],
    ['repair paid by insurance with no insurance initials', { agreement_type: 'repair', payment_method: 'insurance' }, { initialsInsurance: null, initialsChangeOrders: 'AB' }],
    ['installation missing property-condition initials', { agreement_type: 'installation', payment_method: 'cash' }, { initialsInsurance: null, initialsChangeOrders: 'AB', initialsLandscaping: 'AB' }],
    ['installation paid by insurance with no insurance initials', { agreement_type: 'installation', payment_method: 'insurance' }, { initialsInsurance: null, initialsChangeOrders: 'AB', initialsPropertyCondition: 'AB', initialsLandscaping: 'AB' }],
  ])('refuses %s (a direct POST cannot skip the initials)', async (_n, contract, over) => {
    seed(contract)
    const res = await post(good(over))
    expect(res.status).toBe(400)
    expect(db.tables.order_form_contracts[0].status).toBe('pending_customer')
    expect(db.writes).toEqual([])
  })

  it('refuses expired and voided links', async () => {
    seed({ token_expires_at: '2020-01-01T00:00:00.000Z' })
    expect((await post(good())).status).toBe(400)
    seed({ status: 'voided' })
    expect((await post(good())).status).toBe(400)
    expect(db.writes).toEqual([])
  })
})

describe('signing', () => {
  it('signs, stores the PDF, and keeps who/what signed', async () => {
    const res = await post(good())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.pdfUrl).toContain(`/api/files/signed/contract/${TOKEN}`)
    const row = db.tables.order_form_contracts[0]
    expect(row).toMatchObject({
      status: 'completed', customer_print_name: 'Pat Homeowner', customer_ip: '203.0.113.9',
      customer_user_agent: 'TestBrowser/1.0', customer_initials_insurance: 'PH',
    })
    expect(row.pdf_url).toBe(uploads[0])
    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  it('a double tap signs ONCE: one claim, one PDF, one email; both get the signed result', async () => {
    const [a, b] = await Promise.all([post(good()), post(good())])
    expect([a.status, b.status]).toEqual([200, 200])
    const bodies = [await a.json(), await b.json()]
    expect(bodies.filter((x) => x.alreadySigned)).toHaveLength(1)
    expect(claims()).toHaveLength(1)
    expect(uploads).toHaveLength(1)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(db.tables.activities.filter((x) => String(x.body).includes('signed by'))).toHaveLength(1)
  })

  it('a later second submit gets the signed result, not an error, and signs nothing again', async () => {
    await post(good())
    const second = await post(good({ printName: 'Someone Else' }))
    expect(second.status).toBe(200)
    expect((await second.json()).alreadySigned).toBe(true)
    expect(db.tables.order_form_contracts[0].customer_print_name).toBe('Pat Homeowner')
    expect(uploads).toHaveLength(1)
  })

  it('a PDF that cannot be stored never costs the signature; the next call finishes it once', async () => {
    uploadFails = true
    const first = await post(good())
    expect(first.status).toBe(200)
    expect((await first.json()).pdfGenerationError).toMatch(/Storage upload failed/)
    expect(db.tables.order_form_contracts[0]).toMatchObject({ status: 'completed', customer_signature_data: PNG })
    expect(db.tables.order_form_contracts[0].pdf_url).toBeUndefined()

    // a retry right away leaves it to the request that saved the signature…
    uploadFails = false
    sendMail.mockClear()
    const tooSoon = await post(good())
    expect((await tooSoon.json())).toMatchObject({ alreadySigned: true, pdfUrl: null })
    expect(uploads).toHaveLength(0)

    // …later, the next call finishes it
    db.tables.order_form_contracts[0].customer_signed_at = '2026-11-10T00:00:00.000Z'
    db.tables.order_form_contracts[0].signing_finalize_lease_at = '2026-11-10T00:00:00.000Z'
    const retry = await post(good())
    expect(retry.status).toBe(200)
    const retryBody = await retry.json()
    expect(retryBody).toMatchObject({ alreadySigned: true, emailSent: true })
    expect(retryBody.pdfUrl).toContain(`/api/files/signed/contract/${TOKEN}`)
    expect(db.tables.order_form_contracts[0].pdf_url).toBe(uploads[0])
    expect(sendMail).toHaveBeenCalledTimes(1)

    // and a third call changes nothing
    await post(good())
    expect(uploads).toHaveLength(1)
    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  it('finishing a PDF fills the project link that was made without one', async () => {
    seed({ status: 'completed', customer_signature_data: PNG, customer_signed_at: '2026-11-10T00:00:00Z', customer_print_name: 'Pat' })
    db.tables.projects.push({ id: 'p1', org_id: ORG, opportunity_id: 'o1', contract_pdf_path: null })
    await post(good())
    expect(db.tables.projects[0].contract_pdf_path).toBe(uploads[0])
  })
})

describe('recovery: ONE path finishes a signed contract whose request died', () => {
  const OLD = '2026-11-10T00:00:00.000Z'
  const signedRow = (extra: Record<string, unknown> = {}) => ({
    status: 'completed', customer_signature_data: PNG, customer_signed_at: OLD, signing_finalize_lease_at: OLD,
    customer_print_name: 'Pat Homeowner', customer_ip: '203.0.113.9', ...extra,
  })

  it('finishes EVERYTHING missing once (void older, PDF, note, email), and never leaves completed', async () => {
    seed(signedRow())
    db.tables.order_form_contracts.push({ id: 'c0', org_id: ORG, status: 'pending_customer', opportunity_id: 'o1', agreement_type: 'contingency', token_expires_at: FUTURE })
    const res = await post(good())
    expect((await res.json()).alreadySigned).toBe(true)
    const row = db.tables.order_form_contracts[0]
    expect(row.status).toBe('completed')
    expect(row.pdf_url).toBe(uploads[0])
    expect(row.signing_finalized_at).toBeTruthy()
    expect(db.tables.order_form_contracts[1].status).toBe('voided')
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(db.tables.activities.filter((x) => String(x.body).includes('signed by'))).toHaveLength(1)

    // finished for good: another call changes nothing
    await post(good())
    expect(uploads).toHaveLength(1)
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(db.tables.activities.filter((x) => String(x.body).includes('signed by'))).toHaveLength(1)
    expect(db.tables.order_form_contracts[0].status).toBe('completed')
  })

  it('runs only the steps still missing', async () => {
    const at = '2026-11-10T00:00:01.000Z'
    seed(signedRow({ pdf_url: 'org/org-a/x.pdf', pdf_storage_path: 'org/org-a/x.pdf', signing_steps: { void_older: at, pdf: at, engine: at, project: at, signed_note: at, sale_notice: at } }))
    await post(good())
    expect(uploads).toHaveLength(0)
    expect(generate).not.toHaveBeenCalled()
    expect(db.tables.activities).toHaveLength(0)
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(db.tables.order_form_contracts[0]).toMatchObject({ status: 'completed' })
    expect(db.tables.order_form_contracts[0].signing_finalized_at).toBeTruthy()
  })

  it('leaves a request that is still working alone (fresh lease)', async () => {
    seed(signedRow({ signing_finalize_lease_at: new Date().toISOString() }))
    const res = await post(good())
    expect((await res.json()).alreadySigned).toBe(true)
    expect(uploads).toHaveLength(0)
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('two retries at once finish it once', async () => {
    seed(signedRow())
    await Promise.all([post(good()), post(good())])
    expect(uploads).toHaveLength(1)
    expect(sendMail).toHaveBeenCalledTimes(1)
  })
})

describe('recovery: failed steps stay retryable', () => {
  const OLD = '2026-11-10T00:00:00.000Z'
  const signedRow = (extra: Record<string, unknown> = {}) => ({
    status: 'completed', customer_signature_data: PNG, customer_signed_at: OLD, signing_finalize_lease_at: OLD,
    customer_print_name: 'Pat Homeowner', customer_ip: '203.0.113.9', ...extra,
  })
  const installation = () => {
    seed(signedRow({ agreement_type: 'installation', payment_method: 'cash', project_cost: 16000, deposit_amount: 0 }))
    db.tables.opportunities[0] = { id: 'o1', org_id: ORG, owner_user_id: 'u1', lead_id: null, job_source: 'retail' }
    db.tables.production_jobs = []
    db.tables.customers = []
    db.tables.integration_outbox = []
  }
  const jobs = () => db.tables.production_jobs

  it('(a) a void that fails is not marked done; the retry voids the older contract', async () => {
    seed(signedRow())
    db.tables.order_form_contracts.push({ id: 'c0', org_id: ORG, status: 'pending_customer', opportunity_id: 'o1', agreement_type: 'contingency', token_expires_at: FUTURE })
    failRules = [{ table: 'order_form_contracts', op: 'update', when: (v) => v?.status === 'voided', times: 1 }]
    await post(good())
    expect(db.tables.order_form_contracts[1].status).toBe('pending_customer')
    expect((db.tables.order_form_contracts[0] as any).signing_steps?.void_older).toBeUndefined()
    expect(db.tables.order_form_contracts[0].signing_finalized_at).toBeUndefined()

    db.tables.order_form_contracts[0].signing_finalize_lease_at = OLD // lease ran out
    await post(good())
    expect(db.tables.order_form_contracts[1].status).toBe('voided')
    expect((db.tables.order_form_contracts[0] as any).signing_steps.void_older).toBeTruthy()
    expect(db.tables.order_form_contracts[0].status).toBe('completed')
  })

  it('(b) a job that fails to create is not marked done; the retry creates exactly one job', async () => {
    installation()
    failRules = [{ table: 'production_jobs', op: 'insert', times: 1 }]
    await post(good())
    expect(jobs()).toHaveLength(0)
    expect((db.tables.order_form_contracts[0] as any).signing_steps?.project).toBeUndefined()
    expect(db.tables.order_form_contracts[0].signing_finalized_at).toBeUndefined()

    db.tables.order_form_contracts[0].signing_finalize_lease_at = OLD
    await post(good())
    expect(jobs()).toHaveLength(1)
    expect((db.tables.order_form_contracts[0] as any).signing_steps.project).toBeTruthy()

    db.tables.order_form_contracts[0].signing_finalize_lease_at = OLD
    await post(good())
    expect(jobs()).toHaveLength(1)
  })

  it('(c) two concurrent retries make one job, send one email and queue one customer.upserted', async () => {
    installation()
    await Promise.all([post(good()), post(good())])
    expect(jobs()).toHaveLength(1)
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(db.writes.filter((w) => w.table === 'integration_outbox' && w.rows.some((r) => r.event_type === 'customer.upserted'))).toHaveLength(1)
    expect(db.tables.order_form_contracts[0].status).toBe('completed')
  })
})

describe('quote approval contracts', () => {
  it('a typed signature is refused on an ordinary contract', async () => {
    const res = await post(good({ signature: 'typed:Pat Homeowner' }))
    expect(res.status).toBe(400)
    expect(db.writes).toEqual([])
  })

  it('a quote-approval contract signs with the typed name and no initials: no roofing PDF, no contract email, finished', async () => {
    seed({ agreement_type: 'installation', quote_approval_id: 'qa1', payment_method: 'other', project_cost: 16000 })
    const res = await post(good({ signature: 'typed:Pat Homeowner', initialsInsurance: null }))
    expect(res.status).toBe(200)
    const row = db.tables.order_form_contracts[0]
    expect(row).toMatchObject({ status: 'completed', customer_signature_data: 'typed:Pat Homeowner' })
    expect(generate).not.toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
    expect(row.signing_finalized_at).toBeTruthy()
  })
})


describe('signing engine on the contract route', () => {
  it('a failing evidence step never holds the sale hostage: the contract still finishes', async () => {
    downloadFails = true
    const res = await post(good())
    expect(res.status).toBe(200)
    const row = db.tables.order_form_contracts[0]
    expect(row.status).toBe('completed')
    expect(row.signing_finalized_at).toBeTruthy()
    expect(sendMail).toHaveBeenCalledTimes(1)
  })
  it('refuses a signature without consent when the company requires it', async () => {
    ;(db.tables as any).orgs = [{ id: ORG, settings: { signing: { consentStep: true } } }]
    const res = await post(good())
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('consent_required')
    expect(db.tables.order_form_contracts[0].status).not.toBe('completed')
    expect(sendMail).not.toHaveBeenCalled()
  })
  it('signs with the consent version stored', async () => {
    ;(db.tables as any).orgs = [{ id: ORG, settings: { signing: { consentStep: true } } }]
    const res = await post(good({ consent: { accepted: true, version: 'v1-2026-11' } }))
    expect(res.status).toBe(200)
    expect(db.tables.order_form_contracts[0]).toMatchObject({ status: 'completed', consent_version: 'v1-2026-11' })
  })
})
