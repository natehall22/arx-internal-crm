jest.mock('@/lib/pdf/job-material-order', () => ({
  renderJobMaterialOrderPDF: () => ({ pdf: Buffer.from('%PDF-test'), truncated: false }),
}))

import { planLineSupplierMove } from '@/lib/supplier-order-line'
import { planSupplierSwitch } from '@/lib/supplier-order-switch'
import { buildSupplierOrdersView, type SupplierOrderContext } from '@/lib/supplier-orders'
import type { OrderLine, SupplierRecord } from '@/lib/material-sourcing'

const supplier = (id: string, name: string, over: Partial<SupplierRecord> = {}): SupplierRecord => ({
  id, name, orderEmail: `${name.toLowerCase().replace(/\W/g, '')}@orders.test`, ccEmails: [], accountNumber: null, defaultBranch: null,
  defaultDeliveryNotes: null, defaultForTrades: [], active: true, connectionType: 'email', ...over,
})
const line = (key: string, over: Partial<OrderLine> = {}): OrderLine => ({ key, trade: 'roofing', label: key, qty: '3', detail: null, note: null, status: 'ready', excluded: false, ...over })
const order = (vendorId: string, status: 'draft' | 'sent' | 'cancelled') => ({ id: `o-${vendorId}`, vendorId, poLetter: 'A', poNumber: '26-0042-A', revision: 0, status, lastLinesHash: null, lastContentHash: null, lastLines: null, lastDeliveryDate: null, lastDeliveryAddress: null, lastSentAt: null, lastSentTo: null, receivedAt: null })

function ctx(over: Partial<SupplierOrderContext> = {}): SupplierOrderContext {
  return {
    orgId: 'org', jobId: 'job', jobNumber: '26-0042', jobStatus: 'materials', primaryTrade: 'roofing', address: '12 Elm St',
    scheduledDate: null, orgName: 'ARX', orgPhone: null,
    baseSheet: { sections: [], product: null, accessories: null, isEmpty: false } as any,
    displayByKey: new Map(), lines: [line('shingles'), line('starter')],
    suppliers: [supplier('abc', 'ABC Supply', { defaultForTrades: ['roofing'] }), supplier('qxo', 'QXO')],
    trades: [], tradeOverrides: [], orgSourceDefaults: {}, orders: [], sends: [], lastSentSourcing: null, ...over,
  }
}

describe('planLineSupplierMove', () => {
  it('plans moving one line of a draft card to another active supplier', () => {
    expect(planLineSupplierMove(ctx(), 'starter', 'qxo')).toMatchObject({ ok: true, itemKey: 'starter', fromName: 'ABC Supply', toName: 'QXO' })
  })

  it('refuses a sent source, a sent target, an inactive target, the same supplier, an unknown item, a cancelled job, an in-flight send', () => {
    expect(planLineSupplierMove(ctx({ orders: [order('abc', 'sent')] }), 'starter', 'qxo')).toMatchObject({ ok: false, status: 409 })
    expect(planLineSupplierMove(ctx({ orders: [order('qxo', 'sent')] }), 'starter', 'qxo')).toMatchObject({ ok: false, status: 409 })
    expect(planLineSupplierMove(ctx({ suppliers: [supplier('abc', 'ABC Supply', { defaultForTrades: ['roofing'] }), supplier('qxo', 'QXO', { active: false })] }), 'starter', 'qxo')).toMatchObject({ ok: false, status: 400 })
    expect(planLineSupplierMove(ctx(), 'starter', 'abc')).toMatchObject({ ok: false, status: 400 })
    expect(planLineSupplierMove(ctx(), 'nope', 'qxo')).toMatchObject({ ok: false, status: 404 })
    expect(planLineSupplierMove(ctx({ jobStatus: 'cancelled' }), 'starter', 'qxo')).toMatchObject({ ok: false, status: 409 })
    const sends = [{ id: 's', supplierOrderId: 'o', vendorId: 'abc', kind: 'order', status: 'sending', createdAt: '', sentAt: null, toEmail: '', poLabel: '' }] as any
    expect(planLineSupplierMove(ctx({ sends }), 'starter', 'qxo')).toMatchObject({ ok: false, status: 409 })
  })
})

describe('after a line moves', () => {
  it('the job shows two cards, each with only its own lines, and a send to one never includes the other', () => {
    const moved = ctx({ lines: [line('shingles'), line('starter', { vendorOverrideId: 'qxo' })] })
    const cards = buildSupplierOrdersView(moved).cards
    expect(cards.map((c) => [c.supplierName, c.lines.map((l) => l.key)])).toEqual([['ABC Supply', ['shingles']], ['QXO', ['starter']]])
  })
})

describe('switching a card that only holds moved items', () => {
  const split = ctx({ lines: [line('shingles'), line('starter', { vendorOverrideId: 'qxo' })], suppliers: [supplier('abc', 'ABC Supply', { defaultForTrades: ['roofing'] }), supplier('qxo', 'QXO'), supplier('hvac', 'HVAC')] })

  it('does not re-point the trade, so the other card keeps its lines', () => {
    expect(planSupplierSwitch(split, 'qxo', 'hvac')).toMatchObject({ ok: true, trades: [], lineKeys: ['starter'] })
  })

  it('the trade card still re-points its trade', () => {
    expect(planSupplierSwitch(split, 'abc', 'hvac')).toMatchObject({ ok: true, trades: ['roofing'], lineKeys: ['shingles'] })
  })
})
