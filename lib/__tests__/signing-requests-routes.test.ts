/** @jest-environment node */
/** Office routes for send-any-PDF: who may read, the bulk daily cap, the opt-out list, and the switch. */
import { NextRequest } from 'next/server'

import { createFakeDb } from '@/lib/test-helpers/fake-db'

let perms: { fullAccess: boolean; permissionNames: Set<string> } = { fullAccess: false, permissionNames: new Set() }
jest.mock('@/lib/effective-permissions', () => ({ ...jest.requireActual('@/lib/effective-permissions'), resolveEffectivePermissionNames: async () => perms }))
let db: ReturnType<typeof createFakeDb>
let userId = 'u-sender'
jest.mock('@/lib/signing/staff-gate', () => ({
  PRIVATE: {},
  staffSigningGate: async () => ({ admin: db.client, profile: { org_id: 'org-a', role: 'closer', custom_role_id: null }, userId }),
}))
const sendMail = jest.fn(async () => ({}))
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => ({ sendMail: (...a: unknown[]) => (sendMail as any)(...a) }) } }))
jest.mock('@/lib/crm-email-from', () => ({ getCrmEmailFrom: () => 'crm@example.test' }))
jest.mock('@/lib/company-links', () => ({ tryOrgAppUrl: async () => 'https://acme.example.test' }))
jest.mock('@/lib/org-brand', () => ({ getDocumentBrand: async () => ({ name: 'Acme', casualName: 'Acme', legalName: 'Acme LLC', legalNameUpper: 'ACME LLC', addressLine: '1 Main', website: 'a.test', phone: '555', email: 'a@acme.test' }) }))
jest.mock('@/lib/company-host-server', () => ({ getRequestHostFence: async () => ({ kind: 'open' }) }))
process.env.SIGNING_TOKEN_SECRET = 'test-secret'

import { GET as listRaw } from '@/app/api/signing/requests/route'
import { GET as detailRaw } from '@/app/api/signing/requests/[id]/route'
import { GET as fileRaw } from '@/app/api/signing/requests/[id]/file/route'
import { POST as bulkRaw } from '@/app/api/signing/templates/[id]/bulk/route'

type H = (r: NextRequest, c?: any) => Promise<Response>
const list = listRaw as unknown as H
const detail = detailRaw as unknown as H
const file = fileRaw as unknown as H
const bulk = bulkRaw as unknown as H
const FUTURE = '2999-01-01T00:00:00.000Z'
const req = (url = 'http://x/y', body?: unknown) => new NextRequest(url, body ? { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : undefined)
function seed(settings: Record<string, unknown>, extra: Record<string, any[]> = {}) {
  db = createFakeDb({
    orgs: [{ id: 'org-a', settings: { signing: settings } }],
    signature_requests: [
      { id: 'r1', org_id: 'org-a', title: 'Mine', status: 'pending', created_by: 'u-sender', created_at: '2026-11-01T00:00:00Z', expires_at: FUTURE, source_path: 'org/org-a/x.pdf', page_count: 1, signing_order: 'parallel' },
      { id: 'r2', org_id: 'org-a', title: 'Theirs', status: 'pending', created_by: 'u-other', created_at: '2026-11-02T00:00:00Z', expires_at: FUTURE, source_path: 'org/org-a/y.pdf', page_count: 1, signing_order: 'parallel' },
    ],
    signature_request_signers: [], signature_fields: [], signing_envelopes: [], signing_events: [],
    signature_templates: [{ id: 't1', org_id: 'org-a', name: 'Lease', source_path: 'org/org-a/t.pdf', source_sha256: 'a'.repeat(64), page_count: 1, archived_at: null, roles: [{ key: 'tenant', label: 'Tenant', order: 0 }], fields: [{ id: 'f1', roleKey: 'tenant', kind: 'signature', page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.05, required: true }] }],
    customer_message_suppressions: [],
    ...extra,
  })
  ;(db.client as any).storage = { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://store.test/x' }, error: null }) }) }
}
beforeEach(() => { perms = { fullAccess: false, permissionNames: new Set() }; userId = 'u-sender'; sendMail.mockClear(); seed({ customDocuments: true }) })

describe('who may read sent documents', () => {
  it('no grants at all: nothing', async () => {
    expect((await list(req())).status).toBe(403)
  })
  it('a sender (contracts:send) sees only their own; contracts:view sees the company\'s', async () => {
    perms = { fullAccess: false, permissionNames: new Set(['contracts:send']) }
    expect(((await (await list(req())).json()).requests as any[]).map((r) => r.id)).toEqual(['r1'])
    perms = { fullAccess: false, permissionNames: new Set(['contracts:view']) }
    expect(((await (await list(req())).json()).requests as any[]).length).toBe(2)
  })
  it('detail and file: the sender or contracts:view, otherwise forbidden', async () => {
    const p = (id: string) => ({ params: { id } })
    expect((await detail(req(), p('r2'))).status).toBe(403)
    expect((await file(req('http://x/y?which=source'), p('r2'))).status).toBe(403)
    expect((await file(req('http://x/y?which=source'), p('r1'))).status).toBe(302)
    perms = { fullAccess: false, permissionNames: new Set(['contracts:view']) }
    expect((await file(req('http://x/y?which=source'), p('r2'))).status).toBe(302)
  })
})

describe('bulk send', () => {
  const body = (emails: string[]) => ({ recipients: emails.map((e) => ({ name: 'P', email: e })) })
  const go = (emails: string[]) => bulk(req('http://x/y', body(emails)), { params: { id: 't1' } })
  beforeEach(() => { perms = { fullAccess: false, permissionNames: new Set(['contracts:send']) } })
  it('is refused while the company switch is off', async () => {
    seed({})
    expect((await go(['a@x.test'])).status).toBe(403)
  })
  it('stops at the company daily cap (counted over the last 24 hours)', async () => {
    seed({ customDocuments: true, bulkDailyCap: 2 })
    const recent = new Date().toISOString()
    db.tables.signature_requests.push({ id: 'b1', org_id: 'org-a', title: 'x', status: 'pending', batch_id: 'batch', created_at: recent })
    expect((await go(['a@x.test', 'b@x.test'])).status).toBe(429)
    expect((await go(['a@x.test'])).status).toBe(201)
  })
  it('skips an address that opted out or bounced', async () => {
    seed({ customDocuments: true })
    db.tables.customer_message_suppressions.push({ org_id: 'org-a', channel: 'email', address: 'stop@x.test', reason: 'unsubscribed' })
    const res = await go(['stop@x.test', 'ok@x.test'])
    const d = await res.json()
    expect(d.results.map((r: any) => r.ok)).toEqual([false, true])
    expect(JSON.stringify(sendMail.mock.calls)).not.toContain('stop@x.test')
  })
})
