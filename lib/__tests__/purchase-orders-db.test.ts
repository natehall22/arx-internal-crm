/** @jest-environment node */
jest.mock('@/lib/org-brand', () => ({ ...jest.requireActual('@/lib/org-brand'), getOrgBrand: async () => ({ name: 'Green Co', phone: '8505550100' }) }))
jest.mock('@/lib/company-links', () => ({ tryOrgAppUrl: async () => 'https://green.example.test' }))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { buildPoPreview, executePoSend, loadPoContext, recordPoBill, receivePo, savePoDraft, voidPoBill, acknowledgeByToken, hashToken, loadVendorLinkView } from '@/lib/purchase-orders-db'
import { parsePoDraft } from '@/lib/purchase-orders'

const ORG = '00000000-0000-4000-8000-000000000001'
const OTHER = '00000000-0000-4000-8000-000000000002'
const JOB = '10000000-0000-4000-8000-000000000001'
const VENDOR = '20000000-0000-4000-8000-000000000001'
const USER = '30000000-0000-4000-8000-000000000001'

let seq = 0
const uuid = () => `40000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`

function world(extra: Record<string, Record<string, unknown>[]> = {}) {
  return createFakeDb(
    {
      production_jobs: [{ id: JOB, org_id: ORG, job_number: '26-0100', status: 'in_progress', address_text: '1 Oak St', scheduled_date: null, customer: null }],
      vendors: [{ id: VENDOR, org_id: ORG, name: 'Gravel Guys', vendor_type: 'sub', order_email: 'orders@gravel.test', order_cc_emails: [], connection_type: 'email', active: true, deleted_at: null }],
      supplier_orders: [],
      purchase_order_lines: [],
      purchase_order_bills: [],
      supplier_order_sends: [],
      supplier_order_send_lines: [],
      job_cost_lines: [],
      ...extra,
    },
    { idFactory: uuid, relations: { job_cost_lines: { vendor: { table: 'vendors', fk: 'vendor_id' } } } }
  )
}

const draftBody = (over: Record<string, unknown> = {}) => ({
  vendorId: VENDOR,
  date: '2026-12-01',
  lines: [{ description: 'Gravel load', quantity: 2, unit: 'ea', unitCost: '100.00', costType: 'material' }],
  ...over,
})
const target = { orgId: ORG, jobId: JOB, workOrderId: null, reference: '26-0100', customerName: 'Pat', address: '1 Oak St', scheduledDate: null, cancelled: false }

async function makeDraft(db: ReturnType<typeof world>, body = draftBody()) {
  const parsed = parsePoDraft(body)
  if (!parsed.ok) throw new Error(parsed.error)
  const r = await savePoDraft(db.client as never, target, USER, parsed.value, null)
  if (!r.ok) throw new Error(r.message)
  return r.id
}

function memStore(db: ReturnType<typeof world>) {
  const sends: Record<string, unknown>[] = []
  return {
    sends,
    store: {
      ensureSupplierOrder: jest.fn(),
      expireStaleSends: jest.fn(async () => undefined),
      insertSend: jest.fn(async (row: Record<string, unknown>) => {
        const id = `send-${sends.length + 1}`
        sends.push({ id, ...row })
        db.tables.supplier_order_sends.push({ id, ...row })
        return { id }
      }),
      insertSendLines: jest.fn(async (rows: Record<string, unknown>[]) => {
        db.tables.supplier_order_send_lines.push(...rows)
        return {}
      }),
      insertSendSourcing: jest.fn(async () => ({})),
      completeSend: jest.fn(async (id: string, patch: Record<string, unknown>) => {
        Object.assign(db.tables.supplier_order_sends.find((s) => s.id === id)!, patch)
        return {}
      }),
      updateSupplierOrder: jest.fn(async (id: string, patch: Record<string, unknown>) => {
        Object.assign(db.tables.supplier_orders.find((o) => o.id === id)!, patch)
        return {}
      }),
      uploadPdf: jest.fn(async () => ({})),
      insertJobNote: jest.fn(async () => undefined),
    },
  }
}

const actor = { id: USER, name: 'Sam', email: 'sam@green.test', canSend: true }

describe('a draft', () => {
  it('numbers like the materials flow (<job>-<letter>), one PO per vendor per job, lines replaced in place', async () => {
    const db = world()
    const id = await makeDraft(db)
    expect(db.tables.supplier_orders[0]).toMatchObject({ kind: 'general', po_number: '26-0100-A', status: 'draft', vendor_id: VENDOR, job_id: JOB })
    // same vendor again edits the SAME order
    const again = parsePoDraft(draftBody({ lines: [{ description: 'Gravel load', quantity: 3, unitCost: '100' }, { description: 'Delivery', quantity: 1, unitCost: '50' }] }))
    if (!again.ok) throw new Error('x')
    const r = await savePoDraft(db.client as never, target, USER, again.value, null)
    expect(r).toMatchObject({ ok: true, id, created: false })
    expect(db.tables.supplier_orders).toHaveLength(1)
    expect(db.tables.purchase_order_lines).toHaveLength(2)
  })
  it('letters skip the materials order already on the job', async () => {
    const db = world({ supplier_orders: [{ id: 'm1', org_id: ORG, job_id: JOB, vendor_id: 'other', kind: 'materials', po_letter: 'A', po_number: '26-0100-A', status: 'sent' }] })
    await makeDraft(db)
    expect(db.tables.supplier_orders.find((o) => o.kind === 'general')!.po_number).toBe('26-0100-B')
  })
  it("refuses another company's vendor and a cancelled job", async () => {
    const db = world({ vendors: [{ id: VENDOR, org_id: OTHER, name: 'X', active: true, deleted_at: null }] })
    const parsed = parsePoDraft(draftBody())
    if (!parsed.ok) throw new Error('x')
    expect(await savePoDraft(db.client as never, target, USER, parsed.value, null)).toMatchObject({ ok: false, status: 404 })
    expect(await savePoDraft(world().client as never, { ...target, cancelled: true }, USER, parsed.value, null)).toMatchObject({ ok: false, status: 409 })
  })
})

describe('sending is explicit, previewed and safe', () => {
  it('refuses without the previewed token; nothing leaves, nothing is logged', async () => {
    const db = world()
    const id = await makeDraft(db)
    const m = memStore(db)
    const transmit = jest.fn()
    const r = await executePoSend(db.client as never, ORG, id, { requested: 'order', previewToken: 'stale', confirmResend: false }, actor, { store: m.store as never, transmit })
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(transmit).not.toHaveBeenCalled()
    expect(m.sends).toHaveLength(0)
  })

  async function previewToken(db: ReturnType<typeof world>, id: string) {
    const loaded = await loadPoContext(db.client as never, ORG, id)
    if (!loaded.ok) throw new Error(loaded.message)
    return buildPoPreview(loaded.ctx, { requested: 'order' }, actor, new Date(), 'link')
  }

  it('sends once with a PDF and a confirm link, records the send, marks it sent', async () => {
    const db = world()
    const id = await makeDraft(db)
    const m = memStore(db)
    const transmit = jest.fn(async () => ({ channel: 'email' as const, reference: '<msg-1>' }))
    const p = await previewToken(db, id)
    expect(p.blockers).toEqual([])
    const r = await executePoSend(db.client as never, ORG, id, { requested: 'order', previewToken: p.previewToken, confirmResend: false }, actor, { store: m.store as never, transmit })
    expect(r).toMatchObject({ ok: true, kind: 'order', status: 'sent' })
    expect(transmit).toHaveBeenCalledTimes(1)
    const sent = (transmit.mock.calls[0] as unknown as [{ email: { text: string; to: string }; pdf: Buffer }])[0]
    expect(sent.email.to).toBe('orders@gravel.test')
    expect(sent.email.text).toMatch(/https:\/\/green\.example\.test\/po\/[A-Za-z0-9_-]{40,}/)
    expect(sent.pdf.subarray(0, 5).toString()).toBe('%PDF-')
    const row = db.tables.supplier_orders[0]
    expect(row.status).toBe('sent')
    expect(typeof row.ack_token_hash).toBe('string')
    // the raw token is never stored
    const token = /\/po\/([A-Za-z0-9_-]+)/.exec(sent.email.text)![1]
    expect(row.ack_token_hash).toBe(hashToken(token))
    expect(JSON.stringify(row)).not.toContain(token)
  })

  it('sending the identical order again needs a second yes', async () => {
    const db = world()
    const id = await makeDraft(db)
    const m = memStore(db)
    const transmit = jest.fn(async () => ({ channel: 'email' as const, reference: null }))
    const p1 = await previewToken(db, id)
    await executePoSend(db.client as never, ORG, id, { requested: 'order', previewToken: p1.previewToken, confirmResend: false }, actor, { store: m.store as never, transmit })
    const p2 = await previewToken(db, id)
    expect(p2.kind).toBe('resend')
    const r = await executePoSend(db.client as never, ORG, id, { requested: 'order', previewToken: p2.previewToken, confirmResend: false }, actor, { store: m.store as never, transmit })
    expect(r).toMatchObject({ ok: false, needsConfirm: true })
    expect(transmit).toHaveBeenCalledTimes(1)
  })

  it('a changed order is a revision that must be confirmed again by the vendor', async () => {
    const db = world()
    const id = await makeDraft(db)
    const m = memStore(db)
    const transmit = jest.fn(async () => ({ channel: 'email' as const, reference: null }))
    const p1 = await previewToken(db, id)
    await executePoSend(db.client as never, ORG, id, { requested: 'order', previewToken: p1.previewToken, confirmResend: false }, actor, { store: m.store as never, transmit })
    db.tables.supplier_orders[0].acknowledged_at = '2026-11-02T00:00:00Z'
    const edit = parsePoDraft(draftBody({ lines: [{ id: db.tables.purchase_order_lines[0].id, description: 'Gravel load', quantity: 5, unitCost: '100' }] }))
    if (!edit.ok) throw new Error('x')
    await savePoDraft(db.client as never, target, USER, edit.value, id)
    const p2 = await previewToken(db, id)
    expect(p2.kind).toBe('revision')
    expect(p2.changes.join(' ')).toMatch(/Changed: Gravel load/)
    const r = await executePoSend(db.client as never, ORG, id, { requested: 'order', previewToken: p2.previewToken, confirmResend: true }, actor, { store: m.store as never, transmit })
    expect(r).toMatchObject({ ok: true, kind: 'revision' })
    expect(db.tables.supplier_orders[0]).toMatchObject({ revision: 1, acknowledged_at: null })
  })

  it('a vendor on the supplier API is refused (general orders go by email)', async () => {
    const db = world()
    db.tables.vendors[0].connection_type = 'api'
    const id = await makeDraft(db)
    const p = await previewToken(db, id)
    expect(p.blockers.join(' ')).toMatch(/API/)
    const transmit = jest.fn()
    const r = await executePoSend(db.client as never, ORG, id, { requested: 'order', previewToken: p.previewToken, confirmResend: false }, actor, { store: memStore(db).store as never, transmit })
    expect(r.ok).toBe(false)
    expect(transmit).not.toHaveBeenCalled()
  })

  it('no order email blocks a real send but not "I sent it myself"', async () => {
    const db = world()
    db.tables.vendors[0].order_email = null
    const id = await makeDraft(db)
    const loaded = await loadPoContext(db.client as never, ORG, id)
    if (!loaded.ok) throw new Error('x')
    expect(buildPoPreview(loaded.ctx, { requested: 'order' }, actor, new Date(), null).blockers.join(' ')).toMatch(/no order email/i)
    const transmit = jest.fn()
    const r = await executePoSend(db.client as never, ORG, id, { requested: 'order', previewToken: '', confirmResend: false, manual: true }, actor, { store: memStore(db).store as never, transmit })
    expect(r).toMatchObject({ ok: true, to: 'sent by hand' })
    expect(transmit).not.toHaveBeenCalled()
  })

  it('a failed send never marks the order sent', async () => {
    const db = world()
    const id = await makeDraft(db)
    const p = await previewToken(db, id)
    const transmit = jest.fn(async () => {
      throw new Error('The mail server refused: x')
    })
    const r = await executePoSend(db.client as never, ORG, id, { requested: 'order', previewToken: p.previewToken, confirmResend: false }, actor, { store: memStore(db).store as never, transmit })
    expect(r.ok).toBe(false)
    expect(db.tables.supplier_orders[0].status).toBe('draft')
  })

  it('only editors may send', async () => {
    const db = world()
    const id = await makeDraft(db)
    const r = await executePoSend(db.client as never, ORG, id, { requested: 'order', previewToken: 'x', confirmResend: false }, { ...actor, canSend: false }, { store: memStore(db).store as never, transmit: jest.fn() })
    expect(r).toMatchObject({ ok: false, status: 403 })
  })
})

describe('after it is sent', () => {
  async function sentPo() {
    const db = world()
    const id = await makeDraft(db)
    Object.assign(db.tables.supplier_orders[0], { status: 'sent', first_sent_at: '2026-11-02T00:00:00Z', last_sent_at: '2026-11-02T00:00:00Z' })
    return { db, id }
  }

  it('receiving partly then fully walks the status; quantities are clamped; a draft cannot be received', async () => {
    const { db, id } = await sentPo()
    const line = db.tables.purchase_order_lines[0].id as string
    expect(await receivePo(db.client as never, ORG, id, { lines: [{ lineId: line, quantity: 1 }] })).toMatchObject({ ok: true, status: 'partially_received' })
    expect(await receivePo(db.client as never, ORG, id, { all: true })).toMatchObject({ ok: true, status: 'received' })
    expect(await receivePo(db.client as never, ORG, id, { lines: [{ lineId: line, quantity: 99 }] })).toMatchObject({ ok: true })
    expect(db.tables.purchase_order_lines[0].received_quantity).toBe(2)
    const d = world()
    const draftId = await makeDraft(d)
    expect(await receivePo(d.client as never, ORG, draftId, { all: true })).toMatchObject({ ok: false, status: 409 })
  })

  it('the vendor link confirms once, only with the right token, and only that', async () => {
    const { db, id } = await sentPo()
    const token = 'a'.repeat(43)
    Object.assign(db.tables.supplier_orders[0], { ack_token_hash: hashToken(token), ack_token_expires_at: new Date(Date.now() + 86_400_000).toISOString() })
    expect((await loadVendorLinkView(db.client as never, 'b'.repeat(43)))).toBeNull()
    expect(await acknowledgeByToken(db.client as never, 'b'.repeat(43), null)).toMatchObject({ ok: false })
    expect(await acknowledgeByToken(db.client as never, 'short', null)).toMatchObject({ ok: false })
    const view = await loadVendorLinkView(db.client as never, token)
    expect(view).toMatchObject({ orgName: 'Green Co', vendorName: 'Gravel Guys' })
    expect(JSON.stringify(view)).not.toMatch(new RegExp(`${ORG}|${JOB}|${USER}`))
    expect(await acknowledgeByToken(db.client as never, token, 'on it')).toEqual({ ok: true })
    expect(db.tables.supplier_orders.find((o) => o.id === id)).toMatchObject({ status: 'acknowledged', acknowledged_by: 'vendor_link', acknowledged_note: 'on it' })
  })

  it('an expired link and a cancelled order do not confirm', async () => {
    const { db } = await sentPo()
    const token = 'c'.repeat(43)
    Object.assign(db.tables.supplier_orders[0], { ack_token_hash: hashToken(token), ack_token_expires_at: '2020-01-01T00:00:00Z' })
    expect(await acknowledgeByToken(db.client as never, token, null)).toMatchObject({ ok: false })
    db.tables.supplier_orders[0].ack_token_expires_at = new Date(Date.now() + 1e9).toISOString()
    db.tables.supplier_orders[0].status = 'cancelled'
    expect(await acknowledgeByToken(db.client as never, token, null)).toMatchObject({ ok: false })
  })
})

describe('vendor bills land in the one job cost ledger, once', () => {
  const bill = { amountCents: 20000, billNumber: 'INV-9', billDate: '2026-11-20', isCredit: false, notes: null, costType: 'material' as const }

  async function sentPo() {
    const db = world()
    const id = await makeDraft(db)
    Object.assign(db.tables.supplier_orders[0], { status: 'sent', first_sent_at: '2026-11-02T00:00:00Z' })
    return { db, id }
  }

  it('writes ONE cost line (source vendor_bill, unapproved, not in the commission base) and ties it to the bill', async () => {
    const { db, id } = await sentPo()
    const r = await recordPoBill(db.client as never, ORG, USER, id, bill, { over: false, duplicate: false })
    expect(r).toMatchObject({ ok: true, status: 'billed' })
    expect(db.tables.job_cost_lines).toHaveLength(1)
    expect(db.tables.job_cost_lines[0]).toMatchObject({ job_id: JOB, org_id: ORG, source: 'vendor_bill', amount: 200, cost_type: 'material', approved: false, deduct_from_commission_base: false, vendor_id: VENDOR, status: 'active' })
    expect(db.tables.job_cost_lines[0].purchase_order_bill_id).toBe(db.tables.purchase_order_bills[0].id)
    expect(db.tables.purchase_order_bills[0].cost_line_id).toBe(db.tables.job_cost_lines[0].id)
    expect(db.tables.supplier_orders[0].status).toBe('billed')
  })

  it('a credit is a negative cost; voiding the bill archives its cost line and reopens the status', async () => {
    const { db, id } = await sentPo()
    const r = await recordPoBill(db.client as never, ORG, USER, id, bill, { over: false, duplicate: false })
    if (!r.ok) throw new Error(r.message)
    await recordPoBill(db.client as never, ORG, USER, id, { ...bill, amountCents: 500, billNumber: 'CR-1', isCredit: true }, { over: false, duplicate: false })
    expect(db.tables.job_cost_lines[1].amount).toBe(-5)
    const v = await voidPoBill(db.client as never, ORG, USER, id, r.billId)
    expect(v.ok).toBe(true)
    expect(db.tables.job_cost_lines[0]).toMatchObject({ status: 'archived' })
    expect(db.tables.job_cost_lines[0].deleted_at).toBeTruthy()
    expect(db.tables.supplier_orders[0].status).not.toBe('billed')
  })

  it('bills past the order total, or money already typed on the job by hand, ask before counting twice', async () => {
    const { db, id } = await sentPo()
    const over = await recordPoBill(db.client as never, ORG, USER, id, { ...bill, amountCents: 30000 }, { over: false, duplicate: false })
    expect(over).toMatchObject({ ok: false, needsConfirm: true, confirmKind: 'over' })
    expect(db.tables.job_cost_lines).toHaveLength(0)

    db.tables.job_cost_lines.push({ id: 'manual-1', org_id: ORG, job_id: JOB, vendor_id: VENDOR, amount: 200, description: 'Gravel (typed)', source: 'manual', status: 'active', deleted_at: null, cost_type: 'material', approved: false, deduct_from_commission_base: false })
    const dup = await recordPoBill(db.client as never, ORG, USER, id, bill, { over: false, duplicate: false })
    expect(dup).toMatchObject({ ok: false, needsConfirm: true, confirmKind: 'duplicate' })
    expect(db.tables.purchase_order_bills).toHaveLength(0)
    const ok = await recordPoBill(db.client as never, ORG, USER, id, bill, { over: false, duplicate: true })
    expect(ok.ok).toBe(true)
  })

  it('a draft order cannot be billed; a visit without a job records the bill but no cost line', async () => {
    const db = world()
    const id = await makeDraft(db)
    expect(await recordPoBill(db.client as never, ORG, USER, id, bill, { over: false, duplicate: false })).toMatchObject({ ok: false, status: 409 })

    const v = world({ work_orders: [{ id: 'w1', org_id: ORG, work_order_number: 'WO-00001', job_id: null, address: '9 Elm', scheduled_date: null, status: 'scheduled', customer: null }] })
    const vt = { ...target, jobId: null, workOrderId: 'w1', reference: 'WO-00001' }
    const parsed = parsePoDraft(draftBody())
    if (!parsed.ok) throw new Error('x')
    const saved = await savePoDraft(v.client as never, vt, USER, parsed.value, null)
    if (!saved.ok) throw new Error(saved.message)
    expect(v.tables.supplier_orders[0]).toMatchObject({ po_number: 'WO-00001-A', job_id: null, work_order_id: 'w1' })
    Object.assign(v.tables.supplier_orders[0], { status: 'sent', first_sent_at: '2026-11-02T00:00:00Z' })
    const r = await recordPoBill(v.client as never, ORG, USER, saved.id, bill, { over: false, duplicate: false })
    expect(r).toMatchObject({ ok: true, costLineId: null })
    expect(v.tables.job_cost_lines).toHaveLength(0)
  })

  it("another company's order is not found", async () => {
    const { db, id } = await sentPo()
    expect(await recordPoBill(db.client as never, OTHER, USER, id, bill, { over: false, duplicate: false })).toMatchObject({ ok: false, status: 404 })
  })
})
