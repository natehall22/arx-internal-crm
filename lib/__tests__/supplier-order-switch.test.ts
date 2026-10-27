jest.mock('@/lib/pdf/job-material-order', () => ({
  renderJobMaterialOrderPDF: () => ({ pdf: Buffer.from('%PDF-test'), truncated: false }),
}))

import { planSupplierSwitch } from '@/lib/supplier-order-switch'
import { buildSupplierOrderPreview, buildSupplierOrdersView, sourcingFor, type SupplierOrderContext } from '@/lib/supplier-orders'
import type { OrderLine, SupplierRecord } from '@/lib/material-sourcing'

const supplier = (id: string, name: string, over: Partial<SupplierRecord> = {}): SupplierRecord => ({
  id, name, orderEmail: `${name.toLowerCase().replace(/\W/g, '')}@orders.test`, ccEmails: [], accountNumber: null, defaultBranch: null,
  defaultDeliveryNotes: null, defaultForTrades: [], active: true, connectionType: 'email', ...over,
})
const line = (key: string, trade: string): OrderLine => ({ key, trade, label: key, qty: '3', detail: null, note: null, status: 'ready', excluded: false })
const order = (vendorId: string, status: 'draft' | 'sent' | 'cancelled') => ({ id: `o-${vendorId}`, vendorId, poLetter: 'A', poNumber: '26-0042-A', revision: 0, status, lastLinesHash: null, lastContentHash: null, lastLines: null, lastDeliveryDate: null, lastDeliveryAddress: null, lastSentAt: null, lastSentTo: null, receivedAt: null })

function ctx(over: Partial<SupplierOrderContext> = {}): SupplierOrderContext {
  return {
    orgId: 'org', jobId: 'job', jobNumber: '26-0042', jobStatus: 'materials', primaryTrade: 'roofing', address: '12 Elm St',
    scheduledDate: null, orgName: 'ARX', orgPhone: null,
    baseSheet: { sections: [], product: null, accessories: null, isEmpty: false } as any,
    displayByKey: new Map(), lines: [line('shingles', 'roofing')],
    suppliers: [supplier('abc', 'ABC Supply', { defaultForTrades: ['roofing'] }), supplier('qxo', 'QXO')],
    trades: [], tradeOverrides: [], orgSourceDefaults: {}, orders: [], sends: [], lastSentSourcing: null, ...over,
  }
}

describe('planSupplierSwitch', () => {
  it('plans a switch for a draft card and lists the trades and lines that move', () => {
    const p = planSupplierSwitch(ctx(), 'abc', 'qxo')
    expect(p).toMatchObject({ ok: true, trades: ['roofing'], lineKeys: ['shingles'], fromName: 'ABC Supply', toName: 'QXO', draft: { action: 'none' } })
  })

  it('moves an existing draft PO row, or drops it when the target already has a draft', () => {
    expect(planSupplierSwitch(ctx({ orders: [order('abc', 'draft')] }), 'abc', 'qxo')).toMatchObject({ ok: true, draft: { action: 'move', orderId: 'o-abc' } })
    expect(planSupplierSwitch(ctx({ orders: [order('abc', 'draft'), order('qxo', 'draft')] }), 'abc', 'qxo')).toMatchObject({ ok: true, draft: { action: 'drop' } })
  })

  it('refuses once the PO was sent, or when the target holds a sent PO', () => {
    expect(planSupplierSwitch(ctx({ orders: [order('abc', 'sent')] }), 'abc', 'qxo')).toMatchObject({ ok: false, status: 409 })
    expect(planSupplierSwitch(ctx({ orders: [order('qxo', 'sent')] }), 'abc', 'qxo')).toMatchObject({ ok: false, status: 409 })
  })

  it('refuses an inactive or unknown target, the same supplier, and a cancelled job', () => {
    expect(planSupplierSwitch(ctx({ suppliers: [supplier('abc', 'ABC Supply', { defaultForTrades: ['roofing'] }), supplier('qxo', 'QXO', { active: false })] }), 'abc', 'qxo')).toMatchObject({ ok: false, status: 400 })
    expect(planSupplierSwitch(ctx(), 'abc', 'nope')).toMatchObject({ ok: false, status: 400 })
    expect(planSupplierSwitch(ctx(), 'abc', 'abc')).toMatchObject({ ok: false, status: 400 })
    expect(planSupplierSwitch(ctx({ jobStatus: 'cancelled' }), 'abc', 'qxo')).toMatchObject({ ok: false, status: 409 })
  })

  it('refuses while an email is being sent', () => {
    const sends = [{ id: 's', supplierOrderId: 'o', vendorId: 'abc', kind: 'order', status: 'sending', createdAt: '', sentAt: null, toEmail: '', poLabel: '' }] as any
    expect(planSupplierSwitch(ctx({ sends }), 'abc', 'qxo')).toMatchObject({ ok: false, status: 409 })
  })
})

describe('after the switch the card and the preview follow the new supplier', () => {
  const switched = ctx({ tradeOverrides: [{ trade: 'roofing', source: null, vendorId: 'qxo' }] })

  it('the draft card is QXO and its preview goes to QXO\'s order email, not ABC\'s', () => {
    expect(sourcingFor(switched).supplierGroups.map((g) => g.supplier.id)).toEqual(['qxo'])
    expect(buildSupplierOrdersView(switched).cards.map((c) => c.supplierName)).toEqual(['QXO'])
    const built = buildSupplierOrderPreview(switched, { vendorId: 'qxo', requested: 'order', deliveryDate: '2026-11-02', deliveryAddress: '12 Elm St', note: null }, { id: 'u1', name: 'Ops', email: 'ops@arx.test' })
    if (!built.ok) throw new Error(built.message)
    expect(built.preview.email.to).toBe('qxo@orders.test')
  })

  it('the picker lists only active suppliers', () => {
    const v = buildSupplierOrdersView(ctx({ suppliers: [supplier('abc', 'ABC Supply', { defaultForTrades: ['roofing'] }), supplier('qxo', 'QXO', { active: false })] }))
    expect(v.suppliers.map((s) => s.name)).toEqual(['ABC Supply'])
  })
})
