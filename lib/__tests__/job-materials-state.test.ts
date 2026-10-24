import { deriveMaterialsState, supplierDisplayState } from '@/lib/job-materials-state'

const rollup = (covered: number, total: number) => ({ covered, total, allCovered: total > 0 && covered === total })

describe('one materials answer', () => {
  it('no supplier plan: the stored status is the fallback', () => {
    expect(deriveMaterialsState({ stored: 'received' })).toMatchObject({ key: 'received', source: 'recorded', mirror: 'received' })
    expect(deriveMaterialsState({ stored: 'ordered' })).toMatchObject({ key: 'ordered', source: 'recorded' })
    expect(deriveMaterialsState({ stored: null })).toMatchObject({ key: 'not_ordered', source: 'recorded' })
    expect(deriveMaterialsState({ stored: 'received', suppliers: { rollup: rollup(0, 0), sentOrders: [] } })).toMatchObject({ key: 'received', source: 'recorded' })
  })
  it('with a plan the supplier orders win over a stale stored status', () => {
    expect(deriveMaterialsState({ stored: 'received', suppliers: { rollup: rollup(0, 2), sentOrders: [] } })).toMatchObject({ key: 'not_ordered', source: 'suppliers', detail: '0 of 2 ordered', mirror: 'not_ordered' })
  })
  it('walks not ordered -> partly -> ordered -> received', () => {
    expect(deriveMaterialsState({ stored: null, suppliers: { rollup: rollup(1, 3), sentOrders: [{ receivedAt: null }] } })).toMatchObject({ key: 'partial', detail: '1 of 3 ordered', mirror: 'partial' })
    expect(deriveMaterialsState({ stored: null, suppliers: { rollup: rollup(2, 2), sentOrders: [{ receivedAt: null }, { receivedAt: null }] } })).toMatchObject({ key: 'ordered', detail: '2 of 2 ordered' })
    expect(deriveMaterialsState({ stored: null, suppliers: { rollup: rollup(2, 2), sentOrders: [{ receivedAt: 'x' }, { receivedAt: null }] } })).toMatchObject({ key: 'ordered', detail: '1 of 2 received' })
    expect(deriveMaterialsState({ stored: null, suppliers: { rollup: rollup(2, 2), sentOrders: [{ receivedAt: 'x' }, { receivedAt: 'y' }] } })).toMatchObject({ key: 'received', mirror: 'received' })
  })
  it('an installer-supplied part counts as covered but is not a PO to receive', () => {
    // 2 parts (1 supplier PO sent + 1 installer trade scheduled), only the PO can be received
    expect(deriveMaterialsState({ stored: null, suppliers: { rollup: rollup(2, 2), sentOrders: [{ receivedAt: 'x' }] } })).toMatchObject({ key: 'received' })
  })
})

describe('per-supplier state', () => {
  it('Draft / Sent / Received', () => {
    expect(supplierDisplayState({ state: 'not_sent', orderStatus: null })).toBe('draft')
    expect(supplierDisplayState({ state: 'sent', orderStatus: 'sent', receivedAt: null })).toBe('sent')
    expect(supplierDisplayState({ state: 'sent', orderStatus: 'sent', receivedAt: '2026-10-20T12:00:00Z' })).toBe('received')
    expect(supplierDisplayState({ state: 'changed', orderStatus: 'sent' })).toBe('changed')
  })
})
