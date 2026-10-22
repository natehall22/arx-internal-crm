/** @jest-environment node */
jest.mock('@/lib/pdf/job-material-order', () => ({
  renderJobMaterialOrderPDF: () => ({ pdf: Buffer.from('%PDF-test'), truncated: true }),
}))

import { executeSupplierOrderSend, buildSupplierOrderPreview, type SupplierOrderContext, type SendDeps } from '@/lib/supplier-orders'
import { poNumber, type OrderLine, type SupplierRecord } from '@/lib/material-sourcing'
import type { SupplierApiSettings } from '@/lib/suppliers/abc/types'
import { makeApiBeforeTransmit } from '@/lib/suppliers/abc/send-gate'

const api = (over: Partial<SupplierApiSettings> = {}): SupplierApiSettings => ({
  provider: 'abc_supply', environment: 'sandbox', orderingEnabled: true, shipToNumber: '1', branchNumber: '128', deliveryService: 'OTR',
  orgOrderingEnabled: true, secondApprovalCents: 1_000_000,
  itemMap: [{ lineKey: 'shingles', itemNumber: 'X', uom: 'BD', qtyUnitWord: 'bundles', estUnitPriceCents: 3800 }],
  ...over,
})
const supplier = (a: SupplierApiSettings | null = api()): SupplierRecord => ({
  id: 'v-abc', name: 'ABC Supply', orderEmail: null, ccEmails: [], accountNumber: null, defaultBranch: null,
  defaultDeliveryNotes: null, defaultForTrades: ['roofing'], active: true, connectionType: 'api', api: a,
})
const line = (): OrderLine => ({ key: 'shingles', trade: 'roofing', label: 'Shingles', qty: '10 bundles', detail: null, note: null, status: 'ready', excluded: false })
const ctx = (over: Partial<SupplierOrderContext> = {}): SupplierOrderContext => ({
  orgId: 'org', jobId: 'job', jobNumber: '26-0042', jobStatus: 'materials', primaryTrade: 'roofing', address: '12 Elm St', scheduledDate: null,
  orgName: 'ARX', orgPhone: null, baseSheet: { sections: [], product: null, accessories: null, isEmpty: false } as any, displayByKey: new Map(),
  lines: [line()], suppliers: [supplier()], trades: [], tradeOverrides: [], orgSourceDefaults: {}, orders: [], sends: [], lastSentSourcing: null, ...over,
})
const actor = { id: 'u1', name: 'Ops', email: 'ops@arx.test', canSend: true }
const req = { vendorId: 'v-abc', requested: 'order' as const, deliveryDate: '2026-11-02', deliveryAddress: '12 Elm St', note: null }

function deps() {
  const calls: string[] = []
  const d: SendDeps = {
    store: {
      ensureSupplierOrder: async () => ({ id: 'o1', vendorId: 'v-abc', poLetter: 'A', poNumber: poNumber('26-0042', 'A'), revision: 0, status: 'draft' } as any),
      expireStaleSends: async () => undefined,
      insertSend: async () => { calls.push('insertSend'); return { id: 's1' } },
      insertSendLines: async () => ({}), insertSendSourcing: async () => ({}),
      completeSend: async (_i, p) => { calls.push(`complete:${p.status}`); return {} },
      updateSupplierOrder: async () => ({}), uploadPdf: async () => ({}), insertJobNote: async () => undefined,
    },
    transmit: async () => { calls.push('transmit'); return { channel: 'api', reference: 'C10-1' } },
    markMaterialsOrdered: async () => ({ changed: true }),
  }
  return { d, calls }
}

describe('API suppliers in the send flow', () => {
  const OLD = { ...process.env }
  beforeEach(() => { process.env.SUPPLIER_API_ORDERING = 'on'; process.env.ABC_CLIENT_ID_SANDBOX = 'id'; process.env.ABC_CLIENT_SECRET_SANDBOX = 's' })
  afterEach(() => { process.env = { ...OLD } })

  it('the page-fit limit of the email PDF does not block an API order', () => {
    const built = buildSupplierOrderPreview(ctx(), req, actor)
    if (!built.ok) throw new Error(built.message)
    expect(built.preview.blockers).toEqual([])
  })

  it('every switch is off by default: the preview is blocked and nothing is sent', async () => {
    delete process.env.SUPPLIER_API_ORDERING
    const built = buildSupplierOrderPreview(ctx(), req, actor)
    if (!built.ok) throw new Error(built.message)
    expect(built.preview.blockers[0]).toMatch(/switched off/)
    const { d, calls } = deps()
    const r = await executeSupplierOrderSend(ctx(), { ...req, previewToken: built.preview.previewToken, confirmResend: false }, actor, d)
    expect(r.ok).toBe(false)
    expect(calls).toEqual([])
  })

  it('changing the environment or a mapping after the preview invalidates its token', () => {
    const a = buildSupplierOrderPreview(ctx(), req, actor)
    const b = buildSupplierOrderPreview(ctx({ suppliers: [supplier(api({ environment: 'production' }))] }), req, actor)
    if (!a.ok || !b.ok) throw new Error('preview')
    expect(a.preview.previewToken).not.toBe(b.preview.previewToken)
  })

  it('a refusal from the gate places nothing and leaves no send row', async () => {
    const built = buildSupplierOrderPreview(ctx(), req, actor)
    if (!built.ok) throw new Error(built.message)
    const { d, calls } = deps()
    d.beforeTransmit = async () => ({ ok: false, status: 409, message: 'needs a second person' })
    const r = await executeSupplierOrderSend(ctx(), { ...req, previewToken: built.preview.previewToken, confirmResend: false }, actor, d)
    expect(r.ok).toBe(false)
    expect(calls).toEqual([])
  })

  it('an order with an unknown total only files a request (no send) when the sender is alone', async () => {
    const c = ctx({ suppliers: [supplier(api({ itemMap: [{ lineKey: 'shingles', itemNumber: 'X', uom: 'BD', qtyUnitWord: 'bundles', estUnitPriceCents: null }] }))] })
    const built = buildSupplierOrderPreview(c, req, actor)
    if (!built.ok) throw new Error(built.message)
    const inserted: unknown[] = []
    const admin: any = { from: () => ({ insert: async (row: unknown) => { inserted.push(row); return { error: null } } }) }
    const { d, calls } = deps()
    d.beforeTransmit = makeApiBeforeTransmit(admin, { role: 'owner' })
    const r = await executeSupplierOrderSend(c, { ...req, previewToken: built.preview.previewToken, confirmResend: false }, actor, d)
    expect(r.ok).toBe(false)
    expect(calls).toEqual([])
    expect(inserted.length).toBeGreaterThan(0)
  })

  it('a small known order goes straight through the gate to the connector', async () => {
    const built = buildSupplierOrderPreview(ctx(), req, actor)
    if (!built.ok) throw new Error(built.message)
    const admin: any = { from: () => ({ insert: async () => ({ error: null }) }) }
    const { d, calls } = deps()
    d.beforeTransmit = makeApiBeforeTransmit(admin, { role: 'owner' })
    const r = await executeSupplierOrderSend(ctx(), { ...req, previewToken: built.preview.previewToken, confirmResend: false }, actor, d)
    expect(r.ok).toBe(true)
    expect(calls).toEqual(expect.arrayContaining(['insertSend', 'transmit', 'complete:sent']))
  })

  it('a changed order (revision) cannot use the API', () => {
    const sentOrder = { id: 'o1', vendorId: 'v-abc', poLetter: 'A', poNumber: poNumber('26-0042', 'A'), revision: 0, status: 'sent', lastSentAt: '2026-10-22T10:00:00Z', lastContentHash: 'old', lastLinesHash: 'old' } as any
    const built = buildSupplierOrderPreview(ctx({ orders: [sentOrder] }), req, actor)
    if (!built.ok) throw new Error(built.message)
    expect(built.preview.blockers.join(' ')).toMatch(/Call the branch/)
  })
})
