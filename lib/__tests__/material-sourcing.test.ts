import {
  decideSend,
  poLabel,
  poNumber,
  resolveSourcing,
  type OrderLine,
  type SupplierOrderRecord,
  type SupplierRecord,
} from '@/lib/material-sourcing'

const supplier = (over: Partial<SupplierRecord> = {}): SupplierRecord => ({
  id: 'v-abc',
  name: 'ABC Supply',
  orderEmail: 'orders@abc.test',
  ccEmails: [],
  accountNumber: '123',
  defaultBranch: null,
  defaultDeliveryNotes: null,
  defaultForTrades: ['roofing'],
  active: true,
  connectionType: 'email',
  ...over,
})

const line = (key: string, trade: string, over: Partial<OrderLine> = {}): OrderLine => ({
  key,
  trade,
  label: key,
  qty: '1',
  detail: null,
  note: null,
  status: 'ready',
  excluded: false,
  ...over,
})

const base = { tradeOverrides: [], orgSourceDefaults: null }

describe('resolveSourcing', () => {
  it('groups supplier lines into ONE PO per supplier with trades sectioned inside', () => {
    const r = resolveSourcing({
      ...base,
      lines: [line('shingles', 'roofing'), line('gutter', 'gutters')],
      suppliers: [supplier({ defaultForTrades: ['roofing', 'gutters'] })],
      trades: [],
    })
    expect(r.supplierGroups).toHaveLength(1)
    expect(r.supplierGroups[0].trades.sort()).toEqual(['gutters', 'roofing'])
    expect(r.unassigned).toHaveLength(0)
  })

  it('works for any trade: an electrical line with an electrical-default supplier makes its own PO', () => {
    const r = resolveSourcing({
      ...base,
      lines: [line('shingles', 'roofing'), line('panel', 'electrical')],
      suppliers: [supplier(), supplier({ id: 'v-elec', name: 'City Electric', defaultForTrades: ['electrical'] })],
      trades: [],
    })
    expect(r.supplierGroups.map((g) => g.supplier.name).sort()).toEqual(['ABC Supply', 'City Electric'])
  })

  it('installer-supplied lines never make a PO', () => {
    const r = resolveSourcing({
      ...base,
      lines: [line('panel', 'electrical')],
      suppliers: [supplier()],
      trades: [{ trade: 'electrical', installer: { subId: 's1', name: 'Sparky', suppliesMaterials: true }, scheduled: true }],
      tradeOverrides: [{ trade: 'electrical', source: 'installer', vendorId: null }],
    })
    expect(r.supplierGroups).toHaveLength(0)
    expect(r.nonPo[0]).toMatchObject({ source: 'installer', trade: 'electrical' })
  })

  it('a supplier line with no supplier is unassigned and blocks sending', () => {
    const r = resolveSourcing({ ...base, lines: [line('panel', 'electrical')], suppliers: [supplier()], trades: [] })
    expect(r.unassigned).toHaveLength(1)
  })
})

describe('PO numbers and sending rules', () => {
  const order = (over: Partial<SupplierOrderRecord> = {}): SupplierOrderRecord =>
    ({
      id: 'o1',
      vendorId: 'v-abc',
      poLetter: 'A',
      poNumber: 'PO-26-0042-A',
      revision: 0,
      status: 'sent',
      lastSentAt: '2026-10-21T14:00:00Z',
      lastSentTo: 'orders@abc.test',
      lastContentHash: 'h1',
      ...over,
    }) as SupplierOrderRecord
  const now = new Date('2026-10-21T15:00:00Z')

  it('revised POs get an -R suffix', () => {
    expect(poLabel(poNumber('26-0042', 'A'), 1)).toMatch(/-R1$/)
  })

  it('a first send is an order with no confirmation', () => {
    const d = decideSend({ requested: 'order', order: null, contentHash: 'h1', lastSend: null, now, timeZone: 'America/New_York' })
    expect(d).toMatchObject({ ok: true, kind: 'order', confirmMessage: null })
  })

  it('sending identical content again needs an explicit second yes', () => {
    const d = decideSend({ requested: 'order', order: order(), contentHash: 'h1', lastSend: null, now, timeZone: 'America/New_York' })
    expect(d).toMatchObject({ ok: true, kind: 'resend' })
    expect((d as { confirmMessage: string | null }).confirmMessage).toMatch(/Already sent/)
  })

  it('changed content is a revision (-R1)', () => {
    const d = decideSend({ requested: 'order', order: order(), contentHash: 'h2', lastSend: null, now, timeZone: 'America/New_York' })
    expect(d).toMatchObject({ ok: true, kind: 'revision', revision: 1 })
  })

  it('cancelling something never sent is refused', () => {
    const d = decideSend({ requested: 'cancellation', order: null, contentHash: 'h1', lastSend: null, now, timeZone: 'America/New_York' })
    expect(d.ok).toBe(false)
  })
})
