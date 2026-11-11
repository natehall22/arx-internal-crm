/** @jest-environment node */
import {
  checkBillAgainstPo,
  clampReceived,
  derivePoStatus,
  dollarsToCents,
  lineTotalCents,
  parseBillInput,
  parsePoDraft,
  poTotalCents,
  sendStateOf,
} from '@/lib/purchase-orders'

const V = '11111111-1111-4111-8111-111111111111'

describe('money is integer cents', () => {
  it('rounds a line once, half-up, and sums lines exactly', () => {
    expect(lineTotalCents(3, 1999)).toBe(5997)
    expect(lineTotalCents(0.333, 1000)).toBe(333)
    expect(poTotalCents([{ quantity: 2.5, unitCostCents: 1234 }, { quantity: 1, unitCostCents: 1 }])).toBe(3086)
  })
  it('parses dollars from text and refuses junk, negatives and absurd sums', () => {
    expect(dollarsToCents('$1,234.56')).toBe(123456)
    expect(dollarsToCents('12.345')).toBe(1235)
    expect(dollarsToCents('abc')).toBeNull()
    expect(dollarsToCents(-1)).toBeNull()
    expect(dollarsToCents(99_999_999)).toBeNull()
  })
})

describe('parsePoDraft', () => {
  const ok = { vendorId: V, lines: [{ description: ' Gravel  load ', quantity: '2', unit: 'ea', unitCost: '45.50', costType: 'material' }], date: '2026-12-01' }
  it('cleans a valid draft', () => {
    const r = parsePoDraft(ok)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.lines[0]).toMatchObject({ description: 'Gravel load', quantity: 2, unitCostCents: 4550, costType: 'material' })
      expect(r.value.dateKind).toBe('delivery')
    }
  })
  it.each([
    [{ ...ok, vendorId: 'nope' }, 'Pick who'],
    [{ ...ok, lines: [] }, 'at least one'],
    [{ ...ok, lines: [{ description: '', quantity: 1 }] }, 'description'],
    [{ ...ok, lines: [{ description: 'x', quantity: 0 }] }, 'quantity'],
    [{ ...ok, lines: [{ description: 'x', quantity: 1, unitCost: 'free' }] }, 'price'],
    [{ ...ok, lines: Array.from({ length: 61 }, () => ({ description: 'x', quantity: 1 })) }, 'At most'],
  ])('refuses %#', (body, text) => {
    const r = parsePoDraft(body as never)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain(text)
  })
  it('an unknown cost type falls back to material; a bad date is dropped', () => {
    const r = parsePoDraft({ ...ok, date: 'tomorrow', lines: [{ description: 'x', quantity: 1, costType: 'bogus' }] })
    expect(r.ok && r.value.lines[0].costType).toBe('material')
    expect(r.ok && r.value.date).toBeNull()
  })
})

describe('derivePoStatus', () => {
  const lines = [{ quantity: 4, receivedQuantity: 0 }, { quantity: 2, receivedQuantity: 0 }]
  const base = { firstSentAt: '2026-11-01', cancelledAt: null, acknowledgedAt: null, lines, totalCents: 10000, billedCents: 0 }
  it('walks draft → sent → acknowledged → partial → received → billed', () => {
    expect(derivePoStatus({ ...base, firstSentAt: null })).toBe('draft')
    expect(derivePoStatus(base)).toBe('sent')
    expect(derivePoStatus({ ...base, acknowledgedAt: 'x' })).toBe('acknowledged')
    expect(derivePoStatus({ ...base, lines: [{ quantity: 4, receivedQuantity: 1 }, lines[1]] })).toBe('partially_received')
    expect(derivePoStatus({ ...base, lines: [{ quantity: 4, receivedQuantity: 4 }, { quantity: 2, receivedQuantity: 2 }] })).toBe('received')
    expect(derivePoStatus({ ...base, billedCents: 10000 })).toBe('billed')
  })
  it('billed within 5 cents counts; a partial bill does not; cancelled wins', () => {
    expect(derivePoStatus({ ...base, billedCents: 9996 })).toBe('billed')
    expect(derivePoStatus({ ...base, billedCents: 4000 })).toBe('sent')
    expect(derivePoStatus({ ...base, cancelledAt: 'x', billedCents: 10000 })).toBe('cancelled')
  })
  it('an order with no money on it is never "billed"', () => {
    expect(derivePoStatus({ ...base, totalCents: 0, billedCents: 5000 })).toBe('sent')
  })
  it('send guard sees only draft / sent / cancelled', () => {
    expect(['draft', 'sent', 'acknowledged', 'received', 'billed', 'cancelled'].map((s) => sendStateOf(s as never))).toEqual(['draft', 'sent', 'sent', 'sent', 'sent', 'cancelled'])
  })
})

describe('bills', () => {
  it('says so when bills pass the order total, and not within the tolerance', () => {
    expect(checkBillAgainstPo(10000, 0, 10000).message).toBeNull()
    expect(checkBillAgainstPo(10000, 0, 10004).message).toBeNull()
    expect(checkBillAgainstPo(10000, 6000, 5000).message).toContain('$10.00'.replace('$10.00', '$110.00'))
  })
  it('parseBillInput needs a positive amount', () => {
    expect(parseBillInput({ amount: '0' }).ok).toBe(false)
    expect(parseBillInput({ amount: '12.50', billNumber: ' A-1 ' })).toMatchObject({ ok: true, value: { amountCents: 1250, billNumber: 'A-1' } })
  })
  it('received quantity is clamped to 0..ordered', () => {
    expect(clampReceived(-3, 5)).toBe(0)
    expect(clampReceived(9, 5)).toBe(5)
    expect(clampReceived(2.5, 5)).toBe(2.5)
  })
})
