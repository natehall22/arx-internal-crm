/** @jest-environment node */
/** Review fixes on the signing engine: who may act, selection release on void/decline, fail-closed consent, no writes on read. */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

let perms: { fullAccess: boolean; permissionNames: Set<string> } = { fullAccess: false, permissionNames: new Set() }
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
jest.mock('@/lib/demo-org', () => ({ ...jest.requireActual('@/lib/demo-org'), isDemoSenderOrg: async () => false })) // these tests use fake databases; the demo check is covered in demo-org.test.ts
jest.mock('@/lib/effective-permissions', () => ({
  ...jest.requireActual('@/lib/effective-permissions'),
  resolveEffectivePermissionNames: async () => perms,
}))
const sendMail = jest.fn(async () => ({}))
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => ({ sendMail: (...a: unknown[]) => (sendMail as any)(...a) }) } }))
jest.mock('@/lib/crm-email-from', () => ({ getCrmEmailFrom: () => 'crm@example.test' }))
jest.mock('@/lib/company-links', () => ({ tryOrgAppUrl: async () => 'https://acme.example.test' }))
let brandPhone = ''
let brandEmail = ''
jest.mock('@/lib/org-brand', () => ({
  getDocumentBrand: async () => ({ name: 'Acme', casualName: 'Acme', legalName: 'Acme LLC', legalNameUpper: 'ACME LLC', addressLine: '1 Main', website: 'acme.test', phone: brandPhone, email: brandEmail }),
}))

import { canActOnSigning } from '@/lib/signing/access'
import { loadSigningSettings } from '@/lib/signing/settings-server'
import { voidEnvelope, declineEnvelope, resendEnvelope } from '@/lib/signing/lifecycle'
import { peekEnvelope } from '@/lib/signing/envelope'

const ORG = 'org-a'
const FUTURE = '2999-01-01T00:00:00.000Z'
let db: ReturnType<typeof createFakeDb>
const admin = () => db.client as any
const staff = { userId: 'u1', name: 'Rep' }

function seed(settings: Record<string, unknown> = {}) {
  db = createFakeDb({
    orgs: [{ id: ORG, settings }],
    job_change_orders: [{ id: 'co1', org_id: ORG, project_id: 'p1', co_number: 'CO-001', status: 'pending_customer', signing_token: 'ab'.repeat(32), signing_token_hash: 'h', signing_token_enc: 'e', token_expires_at: FUTURE, customer_name: 'Pat', customer_email: 'pat@example.test', created_at: '2026-11-01T00:00:00.000Z', created_by: 'sender' }],
    job_selections: [{ id: 's1', org_id: ORG, job_id: 'j1', status: 'chosen', change_order_id: 'co1' }, { id: 's2', org_id: ORG, job_id: 'j1', status: 'chosen', change_order_id: 'other' }],
    signing_envelopes: [], signing_events: [], activities: [],
  })
}
beforeEach(() => { sendMail.mockClear(); brandPhone = '555-0100'; brandEmail = 'a@acme.test'; perms = { fullAccess: false, permissionNames: new Set() }; seed() })

describe('who may act', () => {
  const user = (id: string) => ({ id, role: 'closer' })
  it('the sender may do everything on their own document', async () => {
    for (const a of ['resend', 'remind', 'extend', 'void', 'certificate']) expect(await canActOnSigning(admin(), user('sender'), { created_by: 'sender' }, a)).toBe(true)
  })
  it('another rep with no grants may do nothing', async () => {
    for (const a of ['resend', 'remind', 'extend', 'void', 'certificate']) expect(await canActOnSigning(admin(), user('other'), { created_by: 'sender' }, a)).toBe(false)
  })
  it('contracts:send covers resend/remind/extend but NOT void', async () => {
    perms = { fullAccess: false, permissionNames: new Set(['contracts:send']) }
    for (const a of ['resend', 'remind', 'extend', 'certificate']) expect(await canActOnSigning(admin(), user('other'), { created_by: 'sender' }, a)).toBe(true)
    expect(await canActOnSigning(admin(), user('other'), { created_by: 'sender' }, 'void')).toBe(false)
  })
  it('a manager (teams:manage) or admin (full access) may void', async () => {
    perms = { fullAccess: false, permissionNames: new Set(['teams:manage']) }
    expect(await canActOnSigning(admin(), user('m'), { created_by: 'sender' }, 'void')).toBe(true)
    perms = { fullAccess: true, permissionNames: new Set() }
    expect(await canActOnSigning(admin(), user('a'), { created_by: 'sender' }, 'void')).toBe(true)
  })
  it('a document with no sender on file is not "owned" by an anonymous user', async () => {
    expect(await canActOnSigning(admin(), user('x'), { created_by: null }, 'void')).toBe(false)
  })
})

describe('a selection\'s change order that ends', () => {
  const check = () => {
    expect(db.tables.job_change_orders[0]).toMatchObject({ status: 'voided', signing_token: null, signing_token_hash: null, signing_token_enc: null })
    expect(db.tables.job_selections.find((s) => s.id === 's1')).toMatchObject({ status: 'chosen', change_order_id: null })
    expect(db.tables.job_selections.find((s) => s.id === 's2')?.change_order_id).toBe('other')
    expect(db.tables.activities.some((a) => String(a.body).includes('needs attention'))).toBe(true)
  }
  it('void: link dead, selection released and flagged, other selections untouched', async () => {
    expect((await voidEnvelope(admin(), { kind: 'change-order', orgId: ORG, docId: 'co1', reason: 'Customer changed mind', actor: staff })).ok).toBe(true)
    check()
  })
  it('decline: the same', async () => {
    seed({ signing: { declineEnabled: true } })
    expect((await declineEnvelope(admin(), { kind: 'change-order', row: db.tables.job_change_orders[0] as any, reason: 'Too much', ip: null, userAgent: null })).ok).toBe(true)
    check()
  })
  it('a plain change order (no selection) keeps its token columns', async () => {
    db.tables.job_selections.length = 0
    await voidEnvelope(admin(), { kind: 'change-order', orgId: ORG, docId: 'co1', reason: 'Wrong price', actor: staff })
    expect(db.tables.job_change_orders[0].signing_token_hash).toBe('h')
  })
})

describe('settings read', () => {
  it('fails closed on a read error: consent counts as required, the rest off', async () => {
    const broken = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }) }) } as any
    const s = await loadSigningSettings(broken, ORG)
    expect(s.consentStep).toBe(true)
    expect([s.declineEnabled, s.autoFile, s.reminders.enabled, s.emails.signedCopy]).toEqual([false, false, false, false])
  })
})

describe('invitation email', () => {
  const lastText = () => JSON.stringify(sendMail.mock.calls[0])
  it('omits the contact line when the company has neither phone nor email', async () => {
    brandPhone = ''; brandEmail = ''
    expect((await resendEnvelope(admin(), { kind: 'change-order', orgId: ORG, docId: 'co1', actor: staff })).ok).toBe(true)
    expect(lastText()).not.toMatch(/Questions\?|undefined|null/)
  })
  it('uses only what it has', async () => {
    brandPhone = ''; brandEmail = 'a@acme.test'
    await resendEnvelope(admin(), { kind: 'change-order', orgId: ORG, docId: 'co1', actor: staff })
    expect(lastText()).toContain('Questions? Email a@acme.test.')
  })
})

describe('reading status writes nothing', () => {
  it('peekEnvelope builds the envelope from the row without creating one', async () => {
    const env = await peekEnvelope(admin(), 'change-order', db.tables.job_change_orders[0] as any)
    expect(env).not.toBe('not_ready')
    expect((env as any).status).toBe('sent')
    expect(db.tables.signing_envelopes).toHaveLength(0)
    expect(db.writes.filter((w) => w.table.startsWith('signing_'))).toEqual([])
  })
})
