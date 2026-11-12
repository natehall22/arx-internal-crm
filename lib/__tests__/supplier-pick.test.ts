/** @jest-environment node */
/**
 * One-tap supplier switch on the Materials tab: the card gets `supplierPick` only while nothing is live at
 * the supplier; the PATCH writes the trade override (never sends); and after the write the same view
 * regroups under the new vendor with no ghost card left behind.
 */
const requireAuthApi = jest.fn()
const createServiceClient = jest.fn()
const resolveAccess = jest.fn()
jest.mock('@/lib/auth', () => ({ requireAuthApi: (...a: unknown[]) => requireAuthApi(...a) }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => createServiceClient() }))
jest.mock('@/lib/supplier-orders', () => ({
  ...jest.requireActual('@/lib/supplier-orders'),
  resolveSupplierOrderAccess: (...a: unknown[]) => resolveAccess(...a),
}))

import { NextRequest } from 'next/server'

import { PATCH } from '@/app/api/ops/jobs/[id]/supplier-orders/route'
import { buildSupplierOrdersView, type SupplierOrderContext } from '@/lib/supplier-orders'
import type { OrderLine, SupplierOrderRecord, SupplierRecord, TradeOverride } from '@/lib/material-sourcing'

const supplier = (over: Partial<SupplierRecord>): SupplierRecord => ({
  id: 'v-abc', name: 'ABC Supply', orderEmail: null, ccEmails: [], accountNumber: null, defaultBranch: null,
  defaultDeliveryNotes: null, defaultForTrades: ['roofing', 'gutters'], active: true, connectionType: 'email', ...over,
})
const ABC = supplier({})
const QXO = supplier({ id: 'v-qxo', name: 'QXO', orderEmail: 'orders@qxo.test', defaultForTrades: [] })
const line = (key: string, trade: string, over: Partial<OrderLine> = {}): OrderLine => ({ key, trade, label: key, qty: '3', detail: null, note: null, status: 'ready', excluded: false, ...over })
const order = (over: Partial<SupplierOrderRecord>): SupplierOrderRecord => ({
  id: 'o1', vendorId: 'v-abc', poLetter: 'A', poNumber: 'PO-26-0042-A', revision: 0, status: 'draft', lastLinesHash: null, lastContentHash: null,
  lastLines: null, lastDeliveryDate: null, lastDeliveryAddress: null, lastSentAt: null, lastSentTo: null, receivedAt: null, ...over,
})

function ctx(over: Partial<SupplierOrderContext> = {}): SupplierOrderContext {
  return {
    orgId: 'org', jobId: 'job-1', jobNumber: '26-0042', jobStatus: 'materials', primaryTrade: 'roofing', address: '12 Elm St',
    scheduledDate: null, orgName: 'Co', orgPhone: null,
    baseSheet: { sections: [], product: null, accessories: null, isEmpty: false } as never,
    displayByKey: new Map(), lines: [line('shingles', 'roofing'), line('gutter', 'gutters')],
    suppliers: [ABC, QXO], trades: [], tradeOverrides: [], orgSourceDefaults: {}, orders: [], sends: [], lastSentSourcing: null, ...over,
  }
}

function fakeAdmin(vendors: Record<string, { org_id: string }>) {
  const upserts: Record<string, unknown>[] = []
  const deletes: string[] = []
  const admin = {
    from: (table: string) => {
      if (table === 'production_jobs') return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'job-1' } }) }) }) }) }
      if (table === 'vendors') {
        return { select: () => ({ eq: (_c: string, id: string) => ({ eq: (_o: string, org: string) => ({ is: () => ({ maybeSingle: async () => ({ data: vendors[id]?.org_id === org ? { id } : null }) }) }) }) }) }
      }
      if (table === 'job_trade_material_sources') {
        return {
          upsert: async (row: Record<string, unknown>) => (upserts.push(row), { error: null }),
          delete: () => ({ eq: () => ({ eq: () => ({ eq: async () => (deletes.push('x'), { error: null }) }) }) }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { admin, upserts, deletes }
}

const patch = (body: unknown) =>
  PATCH(new NextRequest('http://x/api/ops/jobs/job-1/supplier-orders', { method: 'PATCH', body: JSON.stringify(body) }), { params: { id: 'job-1' } })

beforeEach(() => {
  requireAuthApi.mockResolvedValue({ authUser: { id: 'u1' }, profile: { org_id: 'org', role: 'admin' } })
  resolveAccess.mockResolvedValue({ canView: true, canSend: true })
})

describe('which cards offer the switch', () => {
  it('draft card with 2+ active suppliers: one pick covering each trade on the card', () => {
    const view = buildSupplierOrdersView(ctx())
    expect(view.cards).toHaveLength(1)
    expect(view.cards[0].supplierName).toBe('ABC Supply')
    expect(view.cards[0].supplierPick).toEqual({ trades: [{ trade: 'roofing', source: null }, { trade: 'gutters', source: null }] })
    expect(view.suppliers.map((s) => s.name)).toEqual(['ABC Supply', 'QXO'])
  })

  it('keeps a trade-level source so the PATCH does not erase it', () => {
    const view = buildSupplierOrdersView(ctx({ tradeOverrides: [{ trade: 'roofing', source: 'supplier', vendorId: null }] }))
    expect(view.cards[0].supplierPick?.trades).toContainEqual({ trade: 'roofing', source: 'supplier' })
  })

  it.each([
    ['sent order', { orders: [order({ status: 'sent', lastSentAt: '2026-11-01T10:00:00Z', lastLinesHash: 'old' })] }],
    ['cancelled job', { jobStatus: 'cancelled' }],
    ['only one active supplier', { suppliers: [ABC, { ...QXO, active: false }] }],
  ])('no switch: %s', (_n, over) => {
    const v = buildSupplierOrdersView(ctx(over as Partial<SupplierOrderContext>))
    expect(v.cards.length).toBeGreaterThan(0)
    expect(v.cards.every((c) => c.supplierPick === null)).toBe(true)
  })

  it('a card holding a line with its own supplier is plain text; the other card still offers it', () => {
    const v = buildSupplierOrdersView(ctx({ lines: [line('shingles', 'roofing', { vendorOverrideId: 'v-qxo' }), line('gutter', 'gutters')] }))
    expect(Object.fromEntries(v.cards.map((c) => [c.supplierName, c.supplierPick !== null]))).toEqual({ QXO: false, 'ABC Supply': true })
  })

  it('a cancelled (nothing live) order can still be re-pointed', () => {
    const v = buildSupplierOrdersView(ctx({ orders: [order({ status: 'cancelled' })] }))
    expect(v.cards[0].supplierPick).not.toBeNull()
  })
})

describe('PATCH then regroup', () => {
  it('writes each trade, never sends, and the card moves to the new supplier with no ghost', async () => {
    const { admin, upserts } = fakeAdmin({ 'v-qxo': { org_id: 'org' }, 'v-abc': { org_id: 'org' } })
    createServiceClient.mockReturnValue(admin)
    const before = buildSupplierOrdersView(ctx({ orders: [order({ status: 'draft' })] }))
    const pick = before.cards[0].supplierPick!
    for (const t of pick.trades) {
      const res = await patch({ trade: t.trade, material_source: t.source, vendor_id: 'v-qxo' })
      expect(res.status).toBe(200)
    }
    expect(upserts.map((u) => [u.trade, u.vendor_id, u.material_source])).toEqual([['roofing', 'v-qxo', null], ['gutters', 'v-qxo', null]])

    // What the next GET loads: the rows just written become trade overrides; the old draft row is still in the DB.
    const overrides: TradeOverride[] = upserts.map((u) => ({ trade: String(u.trade), source: null, vendorId: String(u.vendor_id) }))
    const after = buildSupplierOrdersView(ctx({ tradeOverrides: overrides, orders: [order({ status: 'draft' })] }))
    expect(after.cards.map((c) => c.supplierName)).toEqual(['QXO'])
    expect(after.cards[0].lines.map((l) => l.key).sort()).toEqual(['gutter', 'shingles'])
    expect(after.cards[0].blockers).toEqual([]) // QXO has an order email, ABC did not
    expect(after.cards[0].poNumber).toBe('26-0042-B') // new vendor, next letter; the old draft is not a card
    expect(after.rollup.summary).not.toMatch(/26-0042-A/)
  })

  it('a vendor with no order email shows its warning after the switch', () => {
    const noEmail = buildSupplierOrdersView(ctx({ tradeOverrides: [{ trade: 'roofing', source: null, vendorId: 'v-abc' }], suppliers: [{ ...ABC, defaultForTrades: [] }, QXO, { ...supplier({ id: 'v-z', name: 'Zed', orderEmail: null }), defaultForTrades: [] }], lines: [line('shingles', 'roofing')] }))
    expect(noEmail.cards[0].blockers.join(' ')).toMatch(/no order email/)
  })

  it('refuses another company\'s vendor and a field role', async () => {
    const { admin, upserts } = fakeAdmin({ 'v-other': { org_id: 'other-org' } })
    createServiceClient.mockReturnValue(admin)
    expect((await patch({ trade: 'roofing', material_source: null, vendor_id: 'v-other' })).status).toBe(400)
    resolveAccess.mockResolvedValue({ canView: false, canSend: false })
    expect((await patch({ trade: 'roofing', material_source: null, vendor_id: 'v-qxo' })).status).toBe(403)
    expect(upserts).toHaveLength(0)
  })
})
