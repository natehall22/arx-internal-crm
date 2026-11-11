import { nextChangeOrderNumber, parseSelectionOptions, priceDifference, readStoredOptions, selectionChangeOrderDescription, selectionState } from '@/lib/selections'

describe('selections', () => {
  it('price difference = chosen - allowance', () => {
    expect(priceDifference(500, 750)).toBe(250)
    expect(priceDifference(500, 400)).toBe(-100)
    expect(priceDifference(500, null)).toBeNull()
    expect(priceDifference(0.1 + 0.2, 0.3)).toBe(0)
  })
  const base = { allowance: 500, chosen_price: null as number | null, change_order_id: null as string | null, due_date: null as string | null }
  it('plain states', () => {
    expect(selectionState({ ...base, status: 'draft' }, null, '2026-03-02')).toBe('not_sent')
    expect(selectionState({ ...base, status: 'sent' }, null, '2026-03-02')).toBe('waiting_customer')
    expect(selectionState({ ...base, status: 'sent', due_date: '2026-03-01' }, null, '2026-03-02')).toBe('overdue')
    expect(selectionState({ ...base, status: 'sent', due_date: '2026-03-02' }, null, '2026-03-02')).toBe('waiting_customer')
    expect(selectionState({ ...base, status: 'cancelled' }, null, '2026-03-02')).toBe('cancelled')
  })
  it('within allowance is approved; over it waits for the change order signature', () => {
    expect(selectionState({ ...base, status: 'chosen', chosen_price: 450 }, null, 'x')).toBe('approved')
    expect(selectionState({ ...base, status: 'chosen', chosen_price: 500 }, null, 'x')).toBe('approved')
    expect(selectionState({ ...base, status: 'chosen', chosen_price: 650, change_order_id: 'co1' }, 'pending_customer', 'x')).toBe('waiting_signature')
    expect(selectionState({ ...base, status: 'chosen', chosen_price: 650, change_order_id: null }, null, 'x')).toBe('waiting_signature')
    expect(selectionState({ ...base, status: 'chosen', chosen_price: 650, change_order_id: 'co1' }, 'completed', 'x')).toBe('approved')
  })
  it('a chosen selection is never "overdue"', () => {
    expect(selectionState({ ...base, status: 'chosen', chosen_price: 10, due_date: '2020-01-01' }, null, '2026-03-02')).toBe('approved')
  })
  it('parses options: needs names and prices, drops blank rows, caps the count', () => {
    expect(parseSelectionOptions([{ label: 'A', price: '$1,200' }, { label: '', price: undefined }, { label: 'B', price: 0 }])).toMatchObject([{ label: 'A', price: 1200 }, { label: 'B', price: 0 }])
    expect(parseSelectionOptions([{ label: 'A' }])).toEqual({ error: '“A” needs a price' })
    expect(parseSelectionOptions([{ label: '', price: 5 }])).toEqual({ error: 'Every option needs a name' })
    expect(parseSelectionOptions([])).toEqual({ error: 'Add at least one option' })
    expect(parseSelectionOptions('x')).toEqual({ error: 'Add at least one option' })
    expect(parseSelectionOptions(Array.from({ length: 13 }, (_, i) => ({ label: `o${i}`, price: 1 })))).toEqual({ error: 'At most 12 options' })
    expect(parseSelectionOptions([{ label: 'A', price: -3 }])).toEqual({ error: '“A” needs a price' })
  })
  it('option ids are kept when valid and unique, else assigned', () => {
    const o = parseSelectionOptions([{ id: 'keep', label: 'A', price: 1 }, { id: 'keep', label: 'B', price: 2 }, { label: 'C', price: 3 }]) as Array<{ id: string }>
    expect(o[0].id).toBe('keep')
    expect(new Set(o.map((x) => x.id)).size).toBe(3)
  })
  it('reads stored options defensively', () => {
    expect(readStoredOptions([{ id: 'a', label: 'A', price: '5' }, { id: 'b' }, null, 'x'].filter(Boolean) as unknown[])).toEqual([{ id: 'a', label: 'A', price: 5 }])
    expect(readStoredOptions(null)).toEqual([])
  })
  it('change order text names the item and the numbers', () => {
    const d = selectionChangeOrderDescription({ item: 'Kitchen faucet', allowance: 500, chosen_label: 'Matte black', chosen_price: 750 })
    expect(d).toContain('Kitchen faucet')
    expect(d).toContain('Matte black')
    expect(d).toContain('$250.00')
  })
  it('numbers change orders after the highest', () => {
    expect(nextChangeOrderNumber([])).toBe('CO-001')
    expect(nextChangeOrderNumber(['CO-001', 'CO-009', 'CO-003'])).toBe('CO-010')
    expect(nextChangeOrderNumber(['weird'])).toBe('CO-001')
  })
})
