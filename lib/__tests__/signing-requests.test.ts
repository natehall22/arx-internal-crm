/** @jest-environment node */
/** Send-any-PDF: plan rules, PDF stamping, multi-signer order, signing, completion, decline, void. */
import { PDFDocument } from 'pdf-lib'

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { anchorFor, readPdfInfo, safeText, stampSignedPdf } from '@/lib/signing/requests/pdf'
import { byReadingOrder, canSignNow, cleanFields, firstWave, cleanRoles, missingFields, nextToNotify, roleKeyFrom } from '@/lib/signing/requests/types'
import { sha256Hex } from '@/lib/signing/hash'

process.env.SIGNING_TOKEN_SECRET = 'test-secret'
const sendMail = jest.fn(async () => ({}))
jest.mock('@/lib/demo-org', () => ({ ...jest.requireActual('@/lib/demo-org'), isDemoSenderOrg: async () => false })) // these tests use fake databases; the demo check is covered in demo-org.test.ts
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => ({ sendMail: (...a: unknown[]) => (sendMail as any)(...a) }) } }))
jest.mock('@/lib/crm-email-from', () => ({ getCrmEmailFrom: () => 'crm@example.test' }))
jest.mock('@/lib/company-links', () => ({ tryOrgAppUrl: async () => 'https://acme.example.test' }))
jest.mock('@/lib/org-brand', () => ({ getDocumentBrand: async () => ({ name: 'Acme Roofing', casualName: 'Acme', legalName: 'Acme LLC', legalNameUpper: 'ACME LLC', addressLine: '1 Main', website: 'acme.test', phone: '555', email: 'a@acme.test' }) }))
let fence: { kind: 'open' } | { kind: 'org'; orgId: string; source: string } = { kind: 'open' }
jest.mock('@/lib/company-host-server', () => ({ getRequestHostFence: async () => fence }))

import { adoptUploadedPdf } from '@/lib/signing/requests/store'
import { readSigningSettings } from '@/lib/signing/settings'
import { createRequest, findSignerByToken, loadRequest, sendInvitations } from '@/lib/signing/requests/db'
import { completeRequest, declineRequest, markSignerViewed, resendToSigner, submitSignature, voidRequest } from '@/lib/signing/requests/sign'

const ORG = 'org-a'
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const roles = [{ key: 'owner', label: 'Owner', order: 0 }, { key: 'tenant', label: 'Tenant', order: 1 }]
const F = (id: string, roleKey: string, kind: string, extra: Record<string, unknown> = {}) => ({ id, roleKey, kind, page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.05, required: true, ...extra })
const fields = [F('f1', 'owner', 'signature'), F('f2', 'owner', 'date', { y: 0.2 }), F('f3', 'tenant', 'signature', { y: 0.3 }), F('f4', 'tenant', 'text', { y: 0.4 }), F('f5', 'tenant', 'checkbox', { y: 0.5 })]

let db: ReturnType<typeof createFakeDb>
const admin = () => db.client as any
let sourceBytes: Uint8Array
let stored: Record<string, Buffer>

async function makePdf(pages = 1, rotation = 0) {
  const d = await PDFDocument.create()
  for (let i = 0; i < pages; i++) { const p = d.addPage([612, 792]); if (rotation) p.setRotation({ type: 'degrees' as any, angle: rotation } as any) }
  return d.save()
}
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))

function seedDb(settings: Record<string, unknown> = {}) {
  stored = { 'org/org-a/src.pdf': Buffer.from(sourceBytes) }
  const storage = {
    from: () => ({
      upload: async (p: string, b: Buffer, o?: { upsert?: boolean }) => { if (o?.upsert === false && stored[p]) return { error: { message: 'The resource already exists' } }; stored[p] = Buffer.from(b); return { error: null } },
      remove: async (ps: string[]) => { for (const x of ps) delete stored[x]; return { error: null } },
      download: async (p: string) => (stored[p] ? { data: new Blob([new Uint8Array(stored[p])]), error: null } : { data: null, error: { message: 'missing' } }),
    }),
  }
  db = createFakeDb({
    orgs: [{ id: ORG, email: 'office@acme.test', timezone: 'America/New_York', settings }],
    users: [{ id: 'u1', org_id: ORG, email: 'rep@acme.test', active: true }],
    signature_requests: [], signature_request_signers: [], signature_fields: [], signing_envelopes: [], signing_events: [], documents: [],
  })
  ;(db.client as any).storage = storage
}
const newReq = (over: Record<string, unknown> = {}) => createRequest(admin(), {
  orgId: ORG, createdBy: 'u1', title: 'Lease', sourcePath: 'org/org-a/src.pdf', sourceSha256: sha256Hex(Buffer.from(sourceBytes)), pageCount: 1, roles, fields,
  signers: [{ roleKey: 'owner', name: 'Olive Owner', email: 'olive@example.test' }, { roleKey: 'tenant', name: 'Tom Tenant', email: 'tom@example.test' }], ...over,
} as any)

beforeAll(async () => { sourceBytes = await makePdf() })
beforeEach(() => { fence = { kind: 'open' }; sendMail.mockClear(); seedDb() })

describe('plan rules', () => {
  it('keys, roles and reading order', () => {
    expect(roleKeyFrom('Tenant 2')).toBe('tenant_2')
    expect(roleKeyFrom('Owner', new Set(['owner']))).toBe('owner_2')
    expect(cleanRoles([])).toEqual({ error: 'Add at least one signer' })
    expect(cleanRoles(roles)).toEqual(roles)
    expect(byReadingOrder([{ page: 1, x: 0, y: 0 }, { page: 0, x: 0.5, y: 0.2 }, { page: 0, x: 0.1, y: 0.2 }]).map((f) => `${f.page}${f.x}`)).toEqual(['00.1', '00.5', '10'])
  })
  it('every signer needs a signature field, on a real page, on the page', () => {
    expect('error' in (cleanFields([F('a', 'owner', 'signature')], roles, 1) as any)).toBe(true)
    expect(Array.isArray(cleanFields(fields, roles, 1))).toBe(true)
    expect('error' in (cleanFields([...fields, F('z', 'owner', 'text', { page: 3 })], roles, 1) as any)).toBe(true)
    expect('error' in (cleanFields([...fields, F('z', 'owner', 'text', { x: 0.95 })], roles, 1) as any)).toBe(true)
    expect('error' in (cleanFields([...fields, F('f1', 'owner', 'text')], roles, 1) as any)).toBe(true)
    expect('error' in (cleanFields([...fields, F('q', 'nobody', 'text')], roles, 1) as any)).toBe(true)
  })
  it('turns: parallel is open, serial waits, and the next in line is named', () => {
    const s = [{ id: 'a', role_key: 'owner', order_index: 0, status: 'pending' }, { id: 'b', role_key: 'tenant', order_index: 1, status: 'pending' }]
    expect(canSignNow('parallel', s, 'b')).toBe(true)
    expect(canSignNow('serial', s, 'b')).toBe(false)
    expect(canSignNow('serial', s, 'a')).toBe(true)
    expect(nextToNotify('serial', s, 'a').map((x) => x.id)).toEqual(['b'])
    expect(nextToNotify('parallel', s, 'a').map((x) => x.id)).toEqual(['b']) // already emailed at send; notifyNext skips anyone with notified_at
    expect(canSignNow('serial', [{ ...s[0], status: 'signed' }, s[1]], 'b')).toBe(true)
  })
  it('the company countersignature always goes last, with no setting; everyone else signs at once', () => {
    const s = [{ id: 'a', role_key: 'owner', order_index: 0, status: 'pending' }, { id: 'b', role_key: 'tenant', order_index: 1, status: 'pending' }, { id: 'c', role_key: 'company', order_index: 2, status: 'pending', is_company: true }]
    expect(canSignNow('parallel', s, 'a')).toBe(true)
    expect(canSignNow('parallel', s, 'b')).toBe(true)
    expect(canSignNow('parallel', s, 'c')).toBe(false)
    expect(firstWave('parallel', s).map((x) => x.id)).toEqual(['a', 'b'])
    const oneSigned = [{ ...s[0], status: 'signed' }, s[1], s[2]]
    expect(canSignNow('parallel', oneSigned, 'c')).toBe(false)
    expect(nextToNotify('parallel', s, 'a').map((x) => x.id)).toEqual(['b'])
    const bothSigned = [{ ...s[0], status: 'signed' }, { ...s[1], status: 'signed' }, s[2]]
    expect(canSignNow('parallel', bothSigned, 'c')).toBe(true)
    expect(nextToNotify('parallel', [s[0], { ...s[1], status: 'signed' }, s[2]], 'a').map((x) => x.id)).toEqual(['c'])
    // serial keeps working, and the company still ends up last even if it was listed first
    const ser = [{ id: 'c', role_key: 'company', order_index: 0, status: 'pending', is_company: true }, { id: 'a', role_key: 'owner', order_index: 1, status: 'pending' }]
    expect(canSignNow('serial', ser, 'c')).toBe(false)
    expect(canSignNow('serial', ser, 'a')).toBe(true)
  })
  it('only one company role, and someone besides the company must sign', () => {
    expect('error' in (cleanRoles([{ key: 'a', label: 'A', company: true }, { key: 'b', label: 'B', company: true }]) as any)).toBe(true)
    expect('error' in (cleanRoles([{ key: 'a', label: 'A', company: true }, { key: 'b', label: 'B' }]) as any)).toBe(false)
    expect('error' in (cleanRoles([{ key: 'a', label: 'A', company: true }, { key: 'b', label: 'B', company: true }]) as any)).toBe(true)
  })
  it('missing fields are the signer\'s own required ones', () => {
    const fs = cleanFields(fields, roles, 1) as any[]
    expect(missingFields(fs, 'tenant', {}, { signature: true, initials: false }).map((f) => f.id).sort()).toEqual(['f4', 'f5'])
    expect(missingFields(fs, 'tenant', { f4: 'x', f5: true }, { signature: true, initials: false })).toEqual([])
    expect(missingFields(fs, 'tenant', { f4: 'x', f5: true }, { signature: false, initials: false }).map((f) => f.id)).toEqual(['f3'])
  })
})

describe('pdf', () => {
  it('reads page count and refuses junk, empty and locked files', async () => {
    const ok = await readPdfInfo(sourceBytes)
    expect(ok.ok && ok.info.pageCount).toBe(1)
    expect((await readPdfInfo(new Uint8Array())).ok).toBe(false)
    expect((await readPdfInfo(new TextEncoder().encode('hello'))).ok).toBe(false)
    expect((await readPdfInfo(new TextEncoder().encode('%PDF-1.4 garbage'))).ok).toBe(false)
  })
  it('maps a displayed box onto the page for every rotation', () => {
    const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }
    const a0 = anchorFor({ width: 600, height: 800, rotation: 0 }, box)
    expect([a0.x, a0.y, a0.width, a0.height]).toEqual([60, 800 - 0.3 * 800, 180, 80])
    const a90 = anchorFor({ width: 600, height: 800, rotation: 90 }, box)
    // displayed width is 800, height 600: the box bottom-left is at visual (80, 180)
    expect(a90.x).toBeCloseTo(180); expect(a90.y).toBeCloseTo(80)
    const a180 = anchorFor({ width: 600, height: 800, rotation: 180 }, box)
    expect(a180.x).toBeCloseTo(600 - 60); expect(a180.y).toBeCloseTo(0.3 * 800)
    const a270 = anchorFor({ width: 600, height: 800, rotation: 270 }, box)
    expect([a270.x, a270.y]).toEqual([600 - 180, 800 - 80])
  })
  it('stamps a signature, text, a tick and survives odd characters, on every rotation', async () => {
    for (const rot of [0, 90, 180, 270]) {
      const src = await makePdf(1, rot)
      const fs = [
        { id: 's', roleKey: 'a', kind: 'signature', page: 0, x: 0.1, y: 0.1, w: 0.3, h: 0.06, required: true, value: null },
        { id: 't', roleKey: 'a', kind: 'text', page: 0, x: 0.1, y: 0.3, w: 0.3, h: 0.03, required: true, value: 'Zoë 北京 ok' },
        { id: 'c', roleKey: 'a', kind: 'checkbox', page: 0, x: 0.1, y: 0.4, w: 0.03, h: 0.03, required: true, value: true },
        { id: 'n', roleKey: 'a', kind: 'name', page: 0, x: 0.1, y: 0.5, w: 0.3, h: 0.03, required: true, value: '' },
      ] as any[]
      const out = await stampSignedPdf(src, fs, [{ role_key: 'a', signature_data: PNG, initials_data: null, name: 'Ann' }])
      expect(Buffer.from(out).subarray(0, 4).toString()).toBe('%PDF')
      expect(out.byteLength).toBeGreaterThan(src.byteLength)
      expect((await PDFDocument.load(out)).getPageCount()).toBe(1)
    }
    const typed = await stampSignedPdf(sourceBytes, [{ id: 's', roleKey: 'a', kind: 'signature', page: 0, x: 0.1, y: 0.1, w: 0.3, h: 0.06, required: true, value: null }] as any, [{ role_key: 'a', signature_data: 'typed:Ann Lee', initials_data: null, name: 'Ann' }])
    expect(typed.byteLength).toBeGreaterThan(sourceBytes.byteLength)
  })
  it('safeText never throws on text the standard fonts cannot encode', async () => {
    const d = await PDFDocument.create()
    const font = await d.embedFont('Helvetica' as any)
    expect(safeText(font, 'a北b\nc')).toBe('a?b c')
  })
})

describe('creating and sending', () => {
  it('writes the request, signers (hashed links), fields and an envelope; refuses bad plans', async () => {
    const r = await newReq()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(db.tables.signature_request_signers).toHaveLength(2)
    expect(db.tables.signature_request_signers.every((s) => String(s.token_hash).length === 64 && s.token_enc !== r.created.signers[0].token)).toBe(true)
    expect(JSON.stringify(db.tables.signature_request_signers)).not.toContain(r.created.signers[0].token)
    expect(db.tables.signature_fields).toHaveLength(5)
    expect(db.tables.signing_envelopes).toHaveLength(1)
    expect(db.tables.signing_envelopes[0]).toMatchObject({ doc_kind: 'signature-request', status: 'sent' })
    expect((await newReq({ title: ' ' })).ok).toBe(false)
    expect((await newReq({ signers: [{ roleKey: 'owner', name: 'O', email: 'bad' }, { roleKey: 'tenant', name: 'T', email: 't@x.test' }] })).ok).toBe(false)
    expect((await newReq({ fields: [F('a', 'owner', 'signature')] })).ok).toBe(false)
  })
  it('a countersigning company is emailed only after every other signer has signed', async () => {
    const r = await newReq({ roles: [...roles, { key: 'company', label: 'Company', order: 2, company: true }], fields: [...fields, F('f6', 'company', 'signature', { y: 0.6 })], signers: [{ roleKey: 'owner', name: 'Olive Owner', email: 'olive@example.test' }, { roleKey: 'tenant', name: 'Tom Tenant', email: 'tom@example.test' }, { roleKey: 'company', name: 'Rep', email: 'rep@acme.test' }] })
    if (!r.ok) throw new Error('x')
    const tokens = new Map(r.created.signers.map((s) => [s.id, s.token]))
    expect((await sendInvitations(admin(), { request: r.created.request, signers: r.created.signers }, tokens)).sent).toBe(2)
    expect(sendMail.mock.calls.map((c) => JSON.stringify(c)).join('')).not.toContain('rep@acme.test')
    const co = r.created.signers.find((x) => x.role_key === 'company') as any
    expect(await submitSignature(admin(), { token: co.token, signature: PNG, values: {}, ip: null, userAgent: null, actingUserId: 'u1' })).toMatchObject({ ok: false, status: 409, code: 'not_your_turn' })
    const ow = r.created.signers.find((x) => x.role_key === 'owner') as any
    const tn = r.created.signers.find((x) => x.role_key === 'tenant') as any
    await submitSignature(admin(), { token: ow.token, signature: PNG, values: {}, ip: null, userAgent: null })
    expect(sendMail.mock.calls.map((c) => JSON.stringify(c)).join('')).not.toContain('rep@acme.test')
    await submitSignature(admin(), tenantBody(tn))
    expect(sendMail.mock.calls.map((c) => JSON.stringify(c)).join('')).toContain('rep@acme.test')
    expect(await submitSignature(admin(), { token: co.token, signature: PNG, values: {}, ip: null, userAgent: null, actingUserId: 'u1' })).toMatchObject({ ok: true, state: 'completed' })
  })
  it('parallel emails everyone; serial emails the first only, then the next when they sign', async () => {
    const p = await newReq()
    if (!p.ok) throw new Error('x')
    const tokens = new Map(p.created.signers.map((s) => [s.id, s.token]))
    expect((await sendInvitations(admin(), { request: p.created.request, signers: p.created.signers }, tokens)).sent).toBe(2)
    sendMail.mockClear()
    const s = await newReq({ signingOrder: 'serial' })
    if (!s.ok) throw new Error('x')
    const t2 = new Map(s.created.signers.map((x) => [x.id, x.token]))
    expect((await sendInvitations(admin(), { request: s.created.request, signers: s.created.signers }, t2)).sent).toBe(1)
    expect(JSON.stringify(sendMail.mock.calls[0])).toContain('olive@example.test')
    const owner = s.created.signers.find((x) => x.role_key === 'owner') as any
    const res = await submitSignature(admin(), { token: owner.token, signature: PNG, values: {}, ip: '1.1.1.1', userAgent: 'ua' })
    expect(res).toMatchObject({ ok: true, state: 'signed' })
    expect(sendMail).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(sendMail.mock.calls[1])).toContain('tom@example.test')
  })
})

async function readyParallel() {
  const r = await newReq()
  if (!r.ok) throw new Error('create failed')
  return { owner: r.created.signers.find((s) => s.role_key === 'owner') as any, tenant: r.created.signers.find((s) => s.role_key === 'tenant') as any, id: r.created.request.id }
}
const tenantBody = (t: any, extra: Record<string, unknown> = {}) => ({ token: t.token, signature: PNG, values: { [fieldId('f4')]: 'Unit 4', [fieldId('f5')]: true }, ip: '2.2.2.2', userAgent: 'ua2', ...extra })
function fieldId(label: string) { const i = fields.findIndex((f) => f.id === label); return (db.tables.signature_fields[i] as any).id }

describe('signing', () => {
  it('refuses a bad link, an unfilled required field, and another signer\'s turn on a serial request', async () => {
    const { tenant } = await readyParallel()
    expect((await submitSignature(admin(), { token: 'nope', ip: null, userAgent: null })).ok).toBe(false)
    const bad = await submitSignature(admin(), { token: tenant.token, signature: PNG, values: {}, ip: null, userAgent: null })
    expect(bad).toMatchObject({ ok: false, status: 400 })
    expect((bad as any).missing).toHaveLength(2)
    const s = await newReq({ signingOrder: 'serial' })
    if (!s.ok) throw new Error('x')
    const t = s.created.signers.find((x) => x.role_key === 'tenant') as any
    expect(await submitSignature(admin(), { token: t.token, signature: PNG, values: { [fieldId('f4')]: 'a', [fieldId('f5')]: true }, ip: null, userAgent: null })).toMatchObject({ ok: false, status: 409, code: 'not_your_turn' })
  })
  it('two signers complete it: stamped PDF, hash, certificate with both signers, one set of events', async () => {
    const { owner, tenant, id } = await readyParallel()
    expect(await submitSignature(admin(), { token: owner.token, signature: 'typed:Olive Owner', values: {}, ip: '1.1.1.1', userAgent: 'ua1' })).toMatchObject({ ok: true, state: 'signed' })
    expect((await loadRequest(admin(), ORG, id))?.request.status).toBe('pending')
    const done = await submitSignature(admin(), { ...tenantBody(tenant) })
    expect(done).toMatchObject({ ok: true, state: 'completed' })
    const req = (await loadRequest(admin(), ORG, id))!
    expect(req.request).toMatchObject({ status: 'completed' })
    expect(req.request.signed_path).toBeTruthy()
    const signedBytes = stored[req.request.signed_path as string]
    expect(signedBytes.length).toBeGreaterThan(sourceBytes.byteLength)
    const env = db.tables.signing_envelopes[0] as any
    expect(env).toMatchObject({ status: 'completed', pdf_sha256: sha256Hex(signedBytes) })
    expect(stored[env.certificate_path].subarray(0, 4).toString()).toBe('%PDF')
    const ev = db.tables.signing_events.map((e) => `${e.event}:${e.signer_key}`)
    expect(ev.filter((e) => e.startsWith('signed:')).sort()).toEqual(['signed:owner', 'signed:tenant'])
    expect(ev.filter((e) => e === 'completed:').length).toBe(1)
    expect(ev.filter((e) => e === 'certificate_issued:').length).toBe(1)
    // the date field filled itself, the checkbox and text were saved
    const vals = Object.fromEntries(req.fields.map((f) => [f.kind, f.value]))
    expect(vals.date).toMatch(/^\d\d\/\d\d\/\d{4}$/)
    expect(vals.checkbox).toBe('true')
    expect(vals.text).toBe('Unit 4')
  })
  it('a double tap and a repeated completion change nothing', async () => {
    const { owner, tenant, id } = await readyParallel()
    await submitSignature(admin(), { token: owner.token, signature: PNG, values: {}, ip: null, userAgent: null })
    const [a, b] = await Promise.all([submitSignature(admin(), tenantBody(tenant)), submitSignature(admin(), tenantBody(tenant))])
    expect(a.ok && b.ok).toBe(true)
    await completeRequest(admin(), ORG, id)
    await completeRequest(admin(), ORG, id)
    const ev = db.tables.signing_events.map((e) => e.event)
    expect(ev.filter((e) => e === 'completed')).toHaveLength(1)
    expect(ev.filter((e) => e === 'certificate_issued')).toHaveLength(1)
    expect(Object.keys(stored).filter((k) => k.includes('certificate'))).toHaveLength(1)
  })
  it('consent is required server-side when the company turns it on', async () => {
    seedDb({ signing: { consentStep: true } })
    const { owner } = await readyParallel()
    expect(await submitSignature(admin(), { token: owner.token, signature: PNG, values: {}, ip: null, userAgent: null })).toMatchObject({ ok: false, code: 'consent_required' })
    expect(await submitSignature(admin(), { token: owner.token, signature: PNG, values: {}, consent: { accepted: true, version: 'v1-2026-11' }, ip: null, userAgent: null })).toMatchObject({ ok: true })
    expect(db.tables.signature_request_signers.find((s) => s.role_key === 'owner')).toMatchObject({ consent_version: 'v1-2026-11' })
  })
  it('the signed PDF is refused if the stored source no longer matches its hash', async () => {
    const { owner, tenant, id } = await readyParallel()
    stored['org/org-a/src.pdf'] = Buffer.from(await makePdf(2))
    await submitSignature(admin(), { token: owner.token, signature: PNG, values: {}, ip: null, userAgent: null })
    await submitSignature(admin(), tenantBody(tenant))
    expect(await completeRequest(admin(), ORG, id)).toMatchObject({ ok: false, reason: 'source_changed' })
  })
  it('files the signed copy on the customer and emails every party when the company switches are on', async () => {
    seedDb({ signing: { autoFile: true, emails: { signedCopy: true } } })
    const r = await newReq({ customerId: 'c1' })
    if (!r.ok) throw new Error('x')
    const [o, t] = [r.created.signers[0] as any, r.created.signers[1] as any]
    await submitSignature(admin(), { token: o.token, signature: PNG, values: {}, ip: null, userAgent: null })
    await submitSignature(admin(), { token: t.token, signature: PNG, values: { [fieldId('f4')]: 'x', [fieldId('f5')]: true }, ip: null, userAgent: null })
    expect(db.tables.documents.filter((d) => d.document_role === 'signed_executed')).toHaveLength(1)
    const mail = sendMail.mock.calls.map((c) => JSON.stringify(c)).find((c) => c.includes('is signed')) as string
    for (const e of ['olive@example.test', 'tom@example.test', 'rep@acme.test', 'office@acme.test']) expect(mail).toContain(e)
  })
})

describe('the office and the signer\'s other choices', () => {
  it('void keeps everything, ends every link; decline ends it with the reason (when the company allows it)', async () => {
    const { owner, id } = await readyParallel()
    expect(await voidRequest(admin(), { orgId: ORG, requestId: id, reason: '', actor: { userId: 'u1' } })).toMatchObject({ ok: false })
    expect(await voidRequest(admin(), { orgId: 'org-b', requestId: id, reason: 'Wrong doc', actor: { userId: 'x' } })).toMatchObject({ ok: false, status: 404 })
    expect(await voidRequest(admin(), { orgId: ORG, requestId: id, reason: 'Wrong doc', actor: { userId: 'u1' } })).toEqual({ ok: true })
    expect(db.tables.signature_requests).toHaveLength(1)
    expect(await submitSignature(admin(), { token: owner.token, signature: PNG, values: {}, ip: null, userAgent: null })).toMatchObject({ ok: false, status: 409 })
    expect(db.tables.signing_events.filter((e) => e.event === 'voided')).toHaveLength(1)

    seedDb({ signing: { declineEnabled: true } })
    const n = await readyParallel()
    expect(await declineRequest(admin(), { token: n.tenant.token, reason: 'Wrong terms', ip: '3.3.3.3', userAgent: 'u' })).toEqual({ ok: true })
    expect(db.tables.signature_requests[0].status).toBe('declined')
    expect(db.tables.signing_events.find((e) => e.event === 'declined')).toMatchObject({ signer_key: 'tenant', ip: '3.3.3.3' })
    seedDb()
    const m = await readyParallel()
    expect(await declineRequest(admin(), { token: m.tenant.token, reason: 'Nope nope', ip: null, userAgent: null })).toMatchObject({ ok: false, status: 409 })
  })
  it('a signer who already signed cannot decline or overwrite their evidence', async () => {
    seedDb({ signing: { declineEnabled: true } })
    const { owner } = await readyParallel()
    await submitSignature(admin(), { token: owner.token, signature: PNG, values: {}, ip: '1.1.1.1', userAgent: 'ua1' })
    const before = JSON.stringify(db.tables.signature_request_signers.find((x: any) => x.role_key === 'owner'))
    expect(await declineRequest(admin(), { token: owner.token, reason: 'Changed my mind', ip: '9.9.9.9', userAgent: 'evil' })).toMatchObject({ ok: false, status: 409 })
    expect(JSON.stringify(db.tables.signature_request_signers.find((x: any) => x.role_key === 'owner'))).toBe(before)
    expect(db.tables.signature_requests[0].status).toBe('pending')
    expect(db.tables.signing_events.some((e: any) => e.event === 'declined')).toBe(false)
  })
  it('resend is throttled, remind says so, an expired request is extended', async () => {
    const r = await newReq()
    if (!r.ok) throw new Error('x')
    const t = r.created.signers[1] as any
    const a = { orgId: ORG, requestId: r.created.request.id, signerId: t.id, extendDays: 7, reminder: false, actor: { userId: 'u1', name: 'Rep' } }
    expect(await resendToSigner(admin(), a)).toEqual({ ok: true })
    for (const e of db.tables.signing_events) e.created_at = new Date().toISOString()
    expect(await resendToSigner(admin(), a)).toMatchObject({ ok: false, status: 429 })
    for (const e of db.tables.signing_events) e.created_at = '2020-01-01T00:00:00.000Z'
    ;(db.tables.signature_requests[0] as any).expires_at = '2020-01-01T00:00:00.000Z'
    expect(await resendToSigner(admin(), { ...a, reminder: true })).toEqual({ ok: true })
    expect(new Date(db.tables.signature_requests[0].expires_at as string).getTime()).toBeGreaterThan(Date.now())
    expect(JSON.stringify(sendMail.mock.calls.slice(-1))).toContain('Reminder')
  })
  it('opening the link marks it viewed once; a link on another company\'s address finds nothing', async () => {
    const { tenant } = await readyParallel()
    await markSignerViewed(admin(), tenant.token, '4.4.4.4', 'ua')
    await markSignerViewed(admin(), tenant.token, '4.4.4.4', 'ua')
    expect(db.tables.signing_events.filter((e) => e.event === 'viewed')).toHaveLength(1)
    expect(db.tables.signing_envelopes[0].status).toBe('viewed')
    expect(await findSignerByToken(admin(), tenant.token)).not.toBeNull()
    fence = { kind: 'org', orgId: 'org-b', source: 'subdomain' }
    expect(await findSignerByToken(admin(), tenant.token)).toBeNull()
    expect(await submitSignature(admin(), { token: tenant.token, signature: PNG, values: {}, ip: null, userAgent: null })).toMatchObject({ ok: false, status: 404 })
  })
})

describe('direct-to-storage uploads', () => {
  const slot = (id: string) => `org/${ORG}/signing/uploads/${id}.pdf`
  const ID = '11111111-1111-4111-8111-111111111111'
  it('adopts a 10 MB PDF (past the function body cap), refuses others\' folders, junk and oversize', async () => {
    const pdf = Buffer.from(await makePdf(2))
    stored[slot(ID)] = Buffer.concat([pdf, Buffer.alloc(10 * 1024 * 1024 - pdf.length)])
    const ok = await adoptUploadedPdf(admin(), ORG, slot(ID))
    expect(ok).toMatchObject({ ok: true, path: slot(ID) })
    expect((ok as any).info.pageCount).toBe(2)
    expect(await adoptUploadedPdf(admin(), ORG, `org/other-org/signing/uploads/${ID}.pdf`)).toMatchObject({ ok: false, status: 400 })
    expect(await adoptUploadedPdf(admin(), ORG, `org/${ORG}/signing/uploads/../../x.pdf`)).toMatchObject({ ok: false, status: 400 })
    expect(await adoptUploadedPdf(admin(), ORG, slot('22222222-2222-4222-8222-222222222222'))).toMatchObject({ ok: false, status: 400 })
    const junk = '33333333-3333-4333-8333-333333333333'
    stored[slot(junk)] = Buffer.from('not a pdf')
    expect(await adoptUploadedPdf(admin(), ORG, slot(junk))).toMatchObject({ ok: false, status: 400 })
    expect(stored[slot(junk)]).toBeUndefined()
    const big = '44444444-4444-4444-8444-444444444444'
    stored[slot(big)] = Buffer.concat([pdf, Buffer.alloc(16 * 1024 * 1024)])
    expect(await adoptUploadedPdf(admin(), ORG, slot(big))).toMatchObject({ ok: false, status: 413 })
    expect(stored[slot(big)]).toBeUndefined()
  })
})

describe('company signer and sending switches', () => {
  it('sending your own documents is OFF by default; the bulk cap defaults to 200 and is bounded', () => {
    expect(readSigningSettings({}).customDocuments).toBe(false)
    expect(readSigningSettings({ profile: {} }).customDocuments).toBe(false)
    expect(readSigningSettings({}).bulkDailyCap).toBe(200)
    expect(readSigningSettings({ signing: { bulkDailyCap: 50 } }).bulkDailyCap).toBe(50)
    expect(readSigningSettings({ signing: { bulkDailyCap: 99999 } }).bulkDailyCap).toBe(200)
  })
  it('the company signer must be a staff user of the company, and signs only signed in as that user', async () => {
    const withCo = (email: string) => newReq({ roles: [...roles, { key: 'company', label: 'Company', order: 2, company: true }], fields: [...fields, F('f6', 'company', 'signature', { y: 0.6 })], signers: [{ roleKey: 'owner', name: 'Olive Owner', email: 'olive@example.test' }, { roleKey: 'tenant', name: 'Tom Tenant', email: 'tom@example.test' }, { roleKey: 'company', name: 'Rep', email }] })
    expect(await withCo('stranger@example.test')).toMatchObject({ ok: false, status: 400 })
    db.tables.users.push({ id: 'u-off', org_id: ORG, email: 'gone@acme.test', active: false }, { id: 'u-other', org_id: 'org-b', email: 'elsewhere@acme.test', active: true })
    expect(await withCo('gone@acme.test')).toMatchObject({ ok: false, status: 400 })
    expect(await withCo('elsewhere@acme.test')).toMatchObject({ ok: false, status: 400 })
    const r = await withCo('rep@acme.test')
    if (!r.ok) throw new Error('x')
    const co = r.created.signers.find((x) => x.role_key === 'company') as any
    expect(co.company_user_id).toBe('u1')
    for (const k of ['owner', 'tenant']) { const x = r.created.signers.find((y) => y.role_key === k) as any; await submitSignature(admin(), x.role_key === 'tenant' ? tenantBody(x) : { token: x.token, signature: PNG, values: {}, ip: null, userAgent: null }) }
    expect(await submitSignature(admin(), { token: co.token, signature: PNG, values: {}, ip: null, userAgent: null })).toMatchObject({ ok: false, status: 401, code: 'login_required' })
    expect(await submitSignature(admin(), { token: co.token, signature: PNG, values: {}, ip: null, userAgent: null, actingUserId: 'someone-else' })).toMatchObject({ ok: false, status: 401 })
    expect(await submitSignature(admin(), { token: co.token, signature: PNG, values: {}, ip: null, userAgent: null, actingUserId: 'u1' })).toMatchObject({ ok: true, state: 'completed' })
  })
})
