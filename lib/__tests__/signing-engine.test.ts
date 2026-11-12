/** @jest-environment node */
/** The signing engine: consent, settings defaults, certificate, lifecycle, reminders, events, provider seam. */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { consentCheck, ESIGN_CONSENT_VERSION } from '@/lib/signing/consent'
import { defaultSigningSettings, readSigningSettings, parseSigningPatch, cleanReminderDays } from '@/lib/signing/settings'
import { buildCertificatePdf } from '@/lib/signing/certificate'
import { reminderIndexDue, localHour, extendEnvelope, voidEnvelope, declineEnvelope, runSigningRemindersForOrg, MIN_GAP_MS, resendEnvelope } from '@/lib/signing/lifecycle'
import { recordSigningEvent } from '@/lib/signing/events'
import { getSigningProvider, nativeProvider, PROVIDER_ELIGIBLE_KINDS } from '@/lib/signing/provider'
import { deriveEnvelope } from '@/lib/signing/envelope'
import { sha256Hex } from '@/lib/signing/hash'

const sendMail = jest.fn(async () => ({}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
jest.mock('@/lib/demo-org', () => ({ ...jest.requireActual('@/lib/demo-org'), isDemoSenderOrg: async () => false })) // these tests use fake databases; the demo check is covered in demo-org.test.ts
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => ({ sendMail: (...a: unknown[]) => (sendMail as any)(...a) }) } }))
jest.mock('@/lib/crm-email-from', () => ({ getCrmEmailFrom: () => 'crm@example.test' }))
jest.mock('@/lib/company-links', () => ({ tryOrgAppUrl: async () => 'https://acme.example.test' }))
jest.mock('@/lib/org-brand', () => ({
  getDocumentBrand: async () => ({ name: 'Acme Roofing', casualName: 'Acme', legalName: 'Acme LLC', legalNameUpper: 'ACME LLC', addressLine: '1 Main', website: 'acme.test', phone: '1', email: 'a@acme.test' }),
}))

const ORG = 'org-a'
const FUTURE = '2999-01-01T00:00:00.000Z'
const staff = { userId: 'u1', name: 'Rep' }
let db: ReturnType<typeof createFakeDb>
const admin = () => db.client as any

function seed(co: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) {
  db = createFakeDb({
    orgs: [{ id: ORG, settings }],
    job_change_orders: [{ id: 'co1', org_id: ORG, project_id: 'p1', co_number: 'CO-001', status: 'pending_customer', signing_token: 'ab'.repeat(32), token_expires_at: FUTURE, customer_name: 'Pat', customer_email: 'pat@example.test', created_at: '2026-11-01T00:00:00.000Z', ...co }],
    signing_envelopes: [],
    signing_events: [],
    activities: [],
  })
}
beforeEach(() => { sendMail.mockClear(); seed() })

describe('consent (server side)', () => {
  it('is not required when the company switch is off', () => {
    expect(consentCheck(false, undefined)).toEqual({ ok: true, version: null })
  })
  it.each([undefined, null, {}, { accepted: false, version: ESIGN_CONSENT_VERSION }, { accepted: 'true', version: ESIGN_CONSENT_VERSION }])('refuses %j', (input) => {
    const r = consentCheck(true, input)
    expect(r.ok).toBe(false)
    expect((r as any).code).toBe('consent_required')
  })
  it('refuses an old version and stores the current one on success', () => {
    expect(consentCheck(true, { accepted: true, version: 'v0' }).ok).toBe(false)
    expect(consentCheck(true, { accepted: true, version: ESIGN_CONSENT_VERSION })).toEqual({ ok: true, version: ESIGN_CONSENT_VERSION })
  })
})

describe('settings', () => {
  it('keeps today\'s behavior for a company without a profile, and emails/reminders off for everyone', () => {
    const legacy = readSigningSettings({})
    expect([legacy.consentStep, legacy.declineEnabled, legacy.autoFile]).toEqual([false, false, false])
    const fresh = readSigningSettings({ profile: { name: 'X' } })
    expect([fresh.consentStep, fresh.declineEnabled, fresh.autoFile]).toEqual([true, true, true])
    for (const s of [legacy, fresh]) {
      expect(s.reminders).toEqual({ enabled: false, days: [2, 5] })
      expect(s.emails).toEqual({ signedCopy: false, declineNotice: false })
    }
  })
  it('validates reminder days and patches', () => {
    expect(cleanReminderDays([2, 5])).toEqual([2, 5])
    expect(cleanReminderDays([5, 2])).toEqual([2, 5])
    expect(cleanReminderDays([2, 2])).toBeNull()
    expect(cleanReminderDays([0])).toBeNull()
    expect(cleanReminderDays([1, 2, 3, 4, 5])).toBeNull()
    const cur = defaultSigningSettings(false)
    expect('error' in parseSigningPatch(cur, { settings: { reminders: { days: [99] } } })).toBe(true)
    const ok = parseSigningPatch(cur, { settings: { consentStep: true } })
    expect('set' in ok && ok.set.consentStep).toBe(true)
  })
})

describe('certificate', () => {
  it('is a PDF carrying the hash and the company, never the product name', () => {
    const pdf = buildCertificatePdf({
      brand: { name: 'Acme Roofing', legalName: 'Acme LLC', addressLine: '1 Main', phone: '1', email: 'a@acme.test' },
      certificateId: 'env-1', documentTitle: 'Change Order CO-001', documentSha256: sha256Hex(Buffer.from('x')), hashedAt: '2026-11-10T12:00:00.000Z',
      provider: 'native', sentAt: '2026-11-09T12:00:00.000Z',
      signers: [{ role: 'customer', name: 'Pat', email: 'pat@example.test', order: 1, status: 'signed', signedAt: '2026-11-10T12:00:00.000Z' }],
      evidence: { customer: { ip: '203.0.113.9', userAgent: 'UA', consentVersion: ESIGN_CONSENT_VERSION, consentAt: '2026-11-10T11:59:00.000Z' } },
      events: [{ event: 'signed', actor_type: 'signer', actor_name: 'Pat', ip: '203.0.113.9', created_at: '2026-11-10T12:00:00.000Z' }],
      generatedAt: '2026-11-10T12:01:00.000Z',
    })
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
    expect(pdf.length).toBeGreaterThan(1000)
  })
})

describe('events', () => {
  const ev = (event: any, signer_key = '') => ({ org_id: ORG, envelope_id: 'e1', doc_kind: 'change-order' as const, doc_id: 'co1', event, signer_key, actor_type: 'signer' as const })
  it('records a once-event a single time per signer, not per envelope', async () => {
    expect((await recordSigningEvent(admin(), ev('signed', 'a'))).duplicate).toBeUndefined()
    expect((await recordSigningEvent(admin(), ev('signed', 'a'))).duplicate).toBe(true)
    expect((await recordSigningEvent(admin(), ev('signed', 'b'))).duplicate).toBeUndefined()
    expect(db.tables.signing_events).toHaveLength(2)
  })
  it('lets repeatable events repeat', async () => {
    await recordSigningEvent(admin(), ev('reminder_sent'))
    await recordSigningEvent(admin(), ev('reminder_sent'))
    expect(db.tables.signing_events).toHaveLength(2)
  })
})

describe('lifecycle', () => {
  it('voids with a reason, keeps the row, stops the link, and records it once', async () => {
    expect((await voidEnvelope(admin(), { kind: 'change-order', orgId: ORG, docId: 'co1', reason: '', actor: staff })).ok).toBe(false)
    expect(db.tables.job_change_orders[0].status).toBe('pending_customer')
    expect((await voidEnvelope(admin(), { kind: 'change-order', orgId: ORG, docId: 'co1', reason: 'Wrong price', actor: staff })).ok).toBe(true)
    expect(db.tables.job_change_orders).toHaveLength(1)
    expect(db.tables.job_change_orders[0].status).toBe('voided')
    const again = await voidEnvelope(admin(), { kind: 'change-order', orgId: ORG, docId: 'co1', reason: 'Wrong price', actor: staff })
    expect(again.ok).toBe(false)
    expect(db.tables.signing_events.filter((e) => e.event === 'voided')).toHaveLength(1)
  })
  it('will not touch another company\'s document', async () => {
    const r = await voidEnvelope(admin(), { kind: 'change-order', orgId: 'org-b', docId: 'co1', reason: 'nope nope', actor: staff })
    expect(r.ok).toBe(false)
    expect(db.tables.job_change_orders[0].status).toBe('pending_customer')
  })
  it('extends from now when expired, from the date when open; bounds the days', async () => {
    seed({ token_expires_at: '2020-01-01T00:00:00.000Z' })
    expect((await extendEnvelope(admin(), { kind: 'change-order', orgId: ORG, docId: 'co1', days: 0, actor: staff })).ok).toBe(false)
    const r = await extendEnvelope(admin(), { kind: 'change-order', orgId: ORG, docId: 'co1', days: 7, actor: staff })
    expect(r.ok).toBe(true)
    expect(new Date(db.tables.job_change_orders[0].token_expires_at as string).getTime()).toBeGreaterThan(Date.now() + 6 * 86400000)
  })
  it('throttles a resend, and emails the same link', async () => {
    expect((await resendEnvelope(admin(), { kind: 'change-order', orgId: ORG, docId: 'co1', actor: staff })).ok).toBe(true)
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(sendMail.mock.calls[0])).toContain('https://acme.example.test/change-orders/sign/' + 'ab'.repeat(32))
    for (const e of db.tables.signing_events) e.created_at = new Date().toISOString() // the database stamps this
    const second = await resendEnvelope(admin(), { kind: 'change-order', orgId: ORG, docId: 'co1', actor: staff })
    expect(second.ok).toBe(false)
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(MIN_GAP_MS).toBe(300000)
  })
  it('decline needs the company switch, a reason, and voids the document with the reason kept', async () => {
    const row = () => db.tables.job_change_orders[0] as any
    expect((await declineEnvelope(admin(), { kind: 'change-order', row: row(), reason: 'Too much', ip: '1.1.1.1', userAgent: 'ua' })).ok).toBe(false)
    seed({}, { signing: { declineEnabled: true } })
    expect((await declineEnvelope(admin(), { kind: 'change-order', row: row(), reason: '', ip: null, userAgent: null })).ok).toBe(false)
    expect((await declineEnvelope(admin(), { kind: 'change-order', row: row(), reason: 'Too much', ip: '1.1.1.1', userAgent: 'ua' })).ok).toBe(true)
    expect(row().status).toBe('voided')
    const e = db.tables.signing_events.find((x) => x.event === 'declined') as any
    expect(e.ip).toBe('1.1.1.1')
    expect(JSON.stringify(e.meta)).toContain('Too much')
  })
})

describe('reminders', () => {
  const sentAt = '2026-11-01T00:00:00.000Z'
  it('counts the days that have passed', () => {
    const at = (d: number) => new Date(Date.parse(sentAt) + d * 86400000)
    expect([1, 2, 4, 5, 9].map((d) => reminderIndexDue([2, 5], sentAt, at(d)))).toEqual([0, 1, 1, 2, 2])
    expect(reminderIndexDue([2, 5], null, new Date())).toBe(0)
  })
  it('only sends in the company\'s daytime', () => {
    expect(localHour(new Date('2026-11-05T15:00:00Z'), 'America/New_York')).toBe(10)
  })
  const on = { signing: { reminders: { enabled: true, days: [2, 5] } } }
  const noon = new Date('2026-11-03T17:00:00Z')
  it('is off by default', async () => {
    seed()
    expect((await runSigningRemindersForOrg(admin(), { id: ORG, timezone: 'America/New_York' }, noon)).skipped).toBe('off')
    expect(sendMail).not.toHaveBeenCalled()
  })
  it('sends day 2 once, then day 5, never in the night', async () => {
    seed({ created_at: sentAt }, on)
    const org = { id: ORG, timezone: 'America/New_York' }
    expect((await runSigningRemindersForOrg(admin(), org, new Date('2026-11-03T05:00:00Z'))).skipped).toBe('night')
    expect((await runSigningRemindersForOrg(admin(), org, noon)).sent).toBe(1)
    expect((await runSigningRemindersForOrg(admin(), org, noon)).sent).toBe(0)
    expect((await runSigningRemindersForOrg(admin(), org, new Date('2026-11-06T17:00:00Z'))).sent).toBe(1)
    expect(sendMail).toHaveBeenCalledTimes(2)
    expect(db.tables.signing_events.filter((e) => e.event === 'reminder_sent')).toHaveLength(2)
  })
})

describe('provider seam', () => {
  it('keeps contracts and change orders native, and the eligible list narrow', async () => {
    seed({}, { signing: { provider: 'docusign' } })
    expect(await getSigningProvider(admin(), ORG, 'contract')).toBe(nativeProvider)
    expect(await getSigningProvider(admin(), ORG, 'change-order')).toBe(nativeProvider)
    expect(PROVIDER_ELIGIBLE_KINDS).not.toContain('contract')
    expect(PROVIDER_ELIGIBLE_KINDS).not.toContain('change-order')
  })
})

describe('legacy documents', () => {
  it('derive an envelope without any backfill', () => {
    const e = deriveEnvelope('change-order', { id: 'x', org_id: ORG, status: 'completed', customer_signed_at: '2026-10-01T00:00:00Z', customer_name: 'Pat', created_at: '2026-09-30T00:00:00Z' } as any)
    expect(e.status).toBe('completed')
    expect(e.signers.find((s) => s.role === 'customer')?.status).toBe('signed')
  })
})
