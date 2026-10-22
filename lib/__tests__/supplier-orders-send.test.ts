jest.mock('@/lib/pdf/job-material-order', () => ({
  renderJobMaterialOrderPDF: () => ({ pdf: Buffer.from('%PDF-test'), truncated: false }),
}))

import { executeSupplierOrderSend, buildSupplierOrderPreview, type SupplierOrderContext, type SendDeps } from '@/lib/supplier-orders'
import { poNumber, type OrderLine, type SupplierRecord } from '@/lib/material-sourcing'

const supplier = (over: Partial<SupplierRecord> = {}): SupplierRecord => ({
  id: 'v-abc', name: 'ABC Supply', orderEmail: 'orders@abc.test', ccEmails: [], accountNumber: null, defaultBranch: null,
  defaultDeliveryNotes: null, defaultForTrades: ['roofing', 'electrical'], active: true, connectionType: 'email', ...over,
})
const line = (key: string, trade: string): OrderLine => ({ key, trade, label: key, qty: '3', detail: null, note: null, status: 'ready', excluded: false })

function ctx(over: Partial<SupplierOrderContext> = {}): SupplierOrderContext {
  return {
    orgId: 'org', jobId: 'job', jobNumber: '26-0042', jobStatus: 'materials', primaryTrade: 'roofing', address: '12 Elm St',
    scheduledDate: null, orgName: 'ARX', orgPhone: null,
    baseSheet: { sections: [], product: null, accessories: null, isEmpty: false } as any,
    displayByKey: new Map(), lines: [line('shingles', 'roofing'), line('panel', 'electrical')],
    suppliers: [supplier()], trades: [], tradeOverrides: [], orgSourceDefaults: {}, orders: [], sends: [], lastSentSourcing: null, ...over,
  }
}

function deps() {
  const calls: string[] = []
  const d: SendDeps = {
    store: {
      ensureSupplierOrder: async () => ({ id: 'o1', vendorId: 'v-abc', poLetter: 'A', poNumber: poNumber('26-0042', 'A'), revision: 0, status: 'draft' } as any),
      expireStaleSends: async () => undefined,
      insertSend: async (row) => { calls.push(`insertSend:${row.to_email}`); return { id: 's1' } },
      insertSendLines: async () => ({}),
      insertSendSourcing: async () => ({}),
      completeSend: async (_id, patch) => { calls.push(`complete:${patch.status}`); return {} },
      updateSupplierOrder: async () => ({}),
      uploadPdf: async () => ({}),
      insertJobNote: async () => undefined,
    },
    transmit: async () => { calls.push('transmit'); return { channel: 'email', reference: 'm1' } },
    markMaterialsOrdered: async () => { calls.push('mark'); return { changed: true } },
  }
  return { d, calls }
}

const actor = { id: 'u1', name: 'Ops', email: 'ops@arx.test', canSend: true }
const req = { vendorId: 'v-abc', requested: 'order' as const, deliveryDate: '2026-11-02', deliveryAddress: '12 Elm St', note: null }

describe('one PO per supplier, trades sectioned inside', () => {
  it('roofing and electrical from the same supplier share one PO', () => {
    const built = buildSupplierOrderPreview(ctx(), req, actor)
    if (!built.ok) throw new Error(built.message)
    expect(built.preview.lines.map((l) => l.trade).sort()).toEqual(['electrical', 'roofing'])
  })
})

describe('sending', () => {
  it('requires the token from the preview the person looked at', async () => {
    const { d, calls } = deps()
    const r = await executeSupplierOrderSend(ctx(), { ...req, previewToken: 'wrong', confirmResend: false }, actor, d)
    expect(r.ok).toBe(false)
    expect(calls).not.toContain('transmit')
  })

  it('sends, logs, and marks ordered only when every supplier is covered', async () => {
    const built = buildSupplierOrderPreview(ctx(), req, actor)
    if (!built.ok) throw new Error(built.message)
    const { d, calls } = deps()
    const r = await executeSupplierOrderSend(ctx(), { ...req, previewToken: built.preview.previewToken, confirmResend: false }, actor, d)
    expect(r.ok).toBe(true)
    expect(calls).toEqual(expect.arrayContaining(['transmit', 'complete:sent', 'mark']))
  })

  it('a failed transmit never marks ordered', async () => {
    const built = buildSupplierOrderPreview(ctx(), req, actor)
    if (!built.ok) throw new Error(built.message)
    const { d, calls } = deps()
    d.transmit = async () => { throw new Error('The mail server refused: x') }
    const r = await executeSupplierOrderSend(ctx(), { ...req, previewToken: built.preview.previewToken, confirmResend: false }, actor, d)
    expect(r.ok).toBe(false)
    expect(calls).toContain('complete:failed')
    expect(calls).not.toContain('mark')
  })

  it('an ambiguous failure (timeout) is recorded as unknown, not failed', async () => {
    const built = buildSupplierOrderPreview(ctx(), req, actor)
    if (!built.ok) throw new Error(built.message)
    const { d, calls } = deps()
    d.transmit = async () => { throw new Error('socket hang up') }
    await executeSupplierOrderSend(ctx(), { ...req, previewToken: built.preview.previewToken, confirmResend: false }, actor, d)
    expect(calls).toContain('complete:unknown')
  })

  it('"I sent this myself" records the send and rolls up, with nothing emailed (works with no order email)', async () => {
    const c = ctx({ suppliers: [supplier({ orderEmail: null })] })
    const { d, calls } = deps()
    const r = await executeSupplierOrderSend(c, { ...req, deliveryDate: null, previewToken: '', confirmResend: false, manual: true }, actor, d)
    expect(r.ok).toBe(true)
    expect(calls).toContain('insertSend:sent by hand')
    expect(calls).not.toContain('transmit')
    expect(calls).toContain('mark')
  })

  it('refuses a send when another screen just sent the same order', async () => {
    const built = buildSupplierOrderPreview(ctx(), req, actor)
    if (!built.ok) throw new Error(built.message)
    const { d, calls } = deps()
    d.store.ensureSupplierOrder = async () => ({ id: 'o1', vendorId: 'v-abc', poLetter: 'A', poNumber: poNumber('26-0042', 'A'), revision: 0, status: 'sent', lastSentAt: '2026-10-22T10:00:00Z' } as any)
    const r = await executeSupplierOrderSend(ctx(), { ...req, previewToken: built.preview.previewToken, confirmResend: false }, actor, d)
    expect(r.ok).toBe(false)
    expect(calls).not.toContain('transmit')
  })
})

describe('manual record is orders only', () => {
  it('refuses to record a cancellation by hand', async () => {
    const { d, calls } = deps()
    const r = await executeSupplierOrderSend(ctx(), { ...req, requested: 'cancellation', previewToken: '', confirmResend: false, manual: true }, actor, d)
    expect(r.ok).toBe(false)
    expect(calls).toEqual([])
  })
})
