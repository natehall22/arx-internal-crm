/** @jest-environment node */
/**
 * Proposal snapshots: an unchanged regenerate stores nothing, a changed price stores a new row, another company can't read or
 * write, field roles barred from the proposal can't see snapshots, and a failed save never breaks the PDF download.
 */
const requireAuthApi = jest.fn()
jest.mock('@/lib/auth', () => ({ requireAuthApi: (...a: unknown[]) => requireAuthApi(...a) }))
let mockAdmin: unknown
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => mockAdmin }))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { canonicalJson, hashSnapshot, MAX_SNAPSHOT_BYTES, resolveSnapshotAccess, saveProposalSnapshot, stripInlineImages, validateSnapshotInput, type ProposalPdfSnapshot } from '@/lib/proposal-snapshots'
import { postProposalSnapshot } from '@/lib/proposal-snapshot-client'
import { POST, GET } from '@/app/api/proposals/[id]/snapshots/route'

const P1 = '11111111-1111-4111-8111-111111111111'
const snap = (total = 16325, extra: Record<string, unknown> = {}): ProposalPdfSnapshot => ({
  v: 1,
  theme: 'print',
  data: { proposal: { id: P1, proposal_number: 'P-1', total, customer_name: 'Pat Doe' }, lineItems: [{ name: 'Roof', total }], photos: { property: '/api/files/object?p=cover.jpg' }, ...extra },
})
const seed = () => ({
  proposals: [{ id: P1, org_id: 'org-1', created_by: 'u1', opportunity_id: 'opp-1' }, { id: 'p-other', org_id: 'org-2', created_by: 'x', opportunity_id: null }],
  users: [{ id: 'u1', org_id: 'org-1', full_name: 'Sam' }],
  proposal_snapshots: [] as Array<Record<string, unknown>>,
})
const db = (s = seed(), rpc: Record<string, (a: Record<string, unknown>) => unknown> = {}) =>
  createFakeDb(s, { idFactory: () => '22222222-2222-4222-8222-222222222222', unique: { proposal_snapshots: [['proposal_id', 'content_hash']] }, rpc: rpc as never })
const save = (d: ReturnType<typeof db>, snapshot: ProposalPdfSnapshot, over: Record<string, unknown> = {}) =>
  saveProposalSnapshot(d.client as never, { orgId: 'org-1', userId: 'u1', proposalId: P1, reason: 'pdf', snapshot, ...over } as never)

describe('saveProposalSnapshot', () => {
  it('stores nothing new when the same PDF is regenerated (key order does not matter)', async () => {
    const d = db()
    const a = await save(d, snap())
    const reordered: ProposalPdfSnapshot = { theme: 'print', v: 1, data: { photos: { property: '/api/files/object?p=cover.jpg' }, lineItems: [{ total: 16325, name: 'Roof' }], proposal: { customer_name: 'Pat Doe', total: 16325, proposal_number: 'P-1', id: P1 } } }
    const b = await save(d, reordered, { reason: 'sent' })
    expect(a).toMatchObject({ ok: true, stored: true })
    expect(b).toMatchObject({ ok: true, stored: false, why: 'duplicate' })
    expect(d.tables.proposal_snapshots).toHaveLength(1)
  })

  it('stores a new row when the price changes', async () => {
    const d = db()
    await save(d, snap(16325))
    const r = await save(d, snap(17000))
    expect(r).toMatchObject({ ok: true, stored: true })
    expect(d.tables.proposal_snapshots).toHaveLength(2)
    expect(d.tables.proposal_snapshots[0]!.org_id).toBe('org-1')
  })

  it("won't write another company's proposal", async () => {
    const d = db()
    const r = await saveProposalSnapshot(d.client as never, { orgId: 'org-1', userId: 'u1', proposalId: 'p-other', reason: 'pdf', snapshot: snap() })
    expect(r).toMatchObject({ ok: false, status: 404 })
    expect(d.tables.proposal_snapshots).toHaveLength(0)
  })

  it('refuses a snapshot over 512 KB and never keeps image bytes', async () => {
    const d = db()
    const big = await save(d, snap(1, { notes: 'x'.repeat(MAX_SNAPSHOT_BYTES + 10) }))
    expect(big).toMatchObject({ ok: false, status: 413 })
    const r = await save(d, snap(1, { photos: { property: 'data:image/png;base64,AAAA' }, company: { name: 'Co', logo_url: 'data:image/png;base64,BBBB' } }))
    expect(r).toMatchObject({ ok: true, stored: true })
    expect(JSON.stringify(d.tables.proposal_snapshots[0]!.snapshot)).not.toMatch(/data:image/)
    expect(stripInlineImages({ a: ['data:x', 'ok'] })).toEqual({ a: ['ok'] })
  })

  it('skips quietly (once-logged) when the table is missing', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const missing = { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '42P01', message: 'relation "public.proposal_snapshots" does not exist' } }) }) }), select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: P1 }, error: null }) }) }) }) }) }
    const r1 = await saveProposalSnapshot(missing as never, { orgId: 'org-1', userId: 'u1', proposalId: P1, reason: 'pdf', snapshot: snap() })
    const r2 = await saveProposalSnapshot(missing as never, { orgId: 'org-1', userId: 'u1', proposalId: P1, reason: 'pdf', snapshot: snap() })
    expect(r1).toMatchObject({ ok: true, stored: false, why: 'table_missing' })
    expect(r2).toMatchObject({ ok: true, stored: false, why: 'table_missing' })
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('proposal_snapshots'))).toHaveLength(1)
    warn.mockRestore()
  })

  it('hashes canonical JSON', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe('{"a":[2,{"d":1}],"b":1}')
    expect(hashSnapshot({ a: 1, b: 2 })).toBe(hashSnapshot({ b: 2, a: 1 }))
  })

  it('validates the posted shape against the proposal in the URL', () => {
    expect(validateSnapshotInput(snap(), P1)).toHaveProperty('snapshot')
    expect(validateSnapshotInput(snap(), 'other')).toHaveProperty('error')
    expect(validateSnapshotInput({ v: 1, theme: 'x', data: {} }, P1)).toHaveProperty('error')
  })
})

describe('access (same rule as reading the proposal)', () => {
  const prof = (over: Record<string, unknown> = {}) => ({ org_id: 'org-1', role: 'admin', custom_role_id: null, is_super_admin: false, ...over })
  it('another company gets 404', async () => {
    const d = db()
    expect(await resolveSnapshotAccess(d.client as never, prof({ org_id: 'org-2' }), 'u9', P1)).toEqual({ ok: false, status: 404 })
  })
  it('field roles barred from the proposal get 403', async () => {
    const d = db()
    expect(await resolveSnapshotAccess(d.client as never, prof({ role: 'setter' }), 'u9', P1)).toEqual({ ok: false, status: 403 })
  })
  it("a closer is 404 on a deal that is not theirs, ok on their own", async () => {
    const other = db(seed(), { my_opportunity_ids: () => [] })
    expect(await resolveSnapshotAccess(other.client as never, prof({ role: 'rep' }), 'u9', P1)).toEqual({ ok: false, status: 404 })
    const own = db(seed(), { my_opportunity_ids: () => ['opp-1'] })
    expect(await resolveSnapshotAccess(own.client as never, prof({ role: 'rep' }), 'u9', P1)).toEqual({ ok: true })
  })
})

describe('route', () => {
  const req = (body: unknown, method = 'POST', url = `http://x.test/api/proposals/${P1}/snapshots`) => new Request(url, { method, body: method === 'GET' ? undefined : JSON.stringify(body) })
  const as = (profile: Record<string, unknown>) => requireAuthApi.mockResolvedValue({ authUser: { id: 'u1', email: null }, profile: { org_id: 'org-1', role: 'admin', ...profile } })
  beforeEach(() => { requireAuthApi.mockReset() })

  it('401 without a session', async () => {
    requireAuthApi.mockRejectedValue(new Error('Unauthorized'))
    mockAdmin = db().client
    expect((await POST(req({}), { params: { id: P1 } })).status).toBe(401)
  })
  it('writes, then an identical POST stores nothing; GET lists and rejects field roles', async () => {
    const d = db()
    mockAdmin = d.client
    as({})
    expect(await (await POST(req({ reason: 'pdf', snapshot: snap() }), { params: { id: P1 } })).json()).toEqual({ stored: true })
    expect(await (await POST(req({ reason: 'sent', snapshot: snap() }), { params: { id: P1 } })).json()).toEqual({ stored: false })
    expect(d.tables.proposal_snapshots).toHaveLength(1)
    const id = String(d.tables.proposal_snapshots[0]!.id)
    const one = await GET(req(null, 'GET', `http://x.test/api/proposals/${P1}/snapshots?id=${id}`), { params: { id: P1 } })
    expect((await one.json()).snapshot.data.proposal.total).toBe(16325)
    as({ role: 'setter' })
    expect((await GET(req(null, 'GET'), { params: { id: P1 } })).status).toBe(403)
    expect((await POST(req({ reason: 'pdf', snapshot: snap() }), { params: { id: P1 } })).status).toBe(403)
  })
  it("another company can't read or write", async () => {
    const d = db()
    mockAdmin = d.client
    as({ org_id: 'org-2' })
    expect((await POST(req({ reason: 'pdf', snapshot: snap() }), { params: { id: P1 } })).status).toBe(404)
    expect((await GET(req(null, 'GET'), { params: { id: P1 } })).status).toBe(404)
    expect(d.tables.proposal_snapshots).toHaveLength(0)
  })
  it('rejects a snapshot for a different proposal and an oversized body', async () => {
    mockAdmin = db().client
    as({})
    expect((await POST(req({ reason: 'pdf', snapshot: snap(1, { proposal: { id: 'zzz' } }) }), { params: { id: P1 } })).status).toBe(400)
    expect((await POST(req({ reason: 'pdf', snapshot: snap(1, { n: 'x'.repeat(MAX_SNAPSHOT_BYTES + 10) }) }), { params: { id: P1 } })).status).toBe(413)
  })
})

describe('the PDF download when the save fails', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}))
  afterEach(() => jest.restoreAllMocks())
  it('never throws, whatever fails', async () => {
    await expect(postProposalSnapshot(P1, 'pdf', snap(), (async () => { throw new Error('offline') }) as never)).resolves.toBe(false)
    await expect(postProposalSnapshot(P1, 'pdf', snap(), (async () => ({ ok: false, status: 500 })) as never)).resolves.toBe(false)
    await expect(postProposalSnapshot(P1, 'sent', snap(), (async () => ({ ok: true })) as never)).resolves.toBe(true)
  })
})
