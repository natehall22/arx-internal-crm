import { computeJobSaleTotals } from '@/lib/job-commission-base'
import { buildCommissionPayrollSnapshot } from '@/lib/commission-payroll'

const co = (id: string, o: number, u: number, createdAt: string, isCommissionable: boolean | null = true) => ({
  id,
  originalAmount: o,
  updatedTotal: u,
  isCommissionable,
  createdAt,
})

describe('computeJobSaleTotals — base = signed contract + signed change orders', () => {
  it('uses the signed contract total when there are no change orders', () => {
    const t = computeJobSaleTotals({ contracts: [{ id: 'c', projectCost: 9900.14 }], changeOrders: [] })
    expect(t).toMatchObject({ ok: true, saleAmount: 9900.14, commissionBase: 9900.14, contractSource: 'signed_contracts' })
  })

  it('adds every signed CO delta (26-0037: 23,786.11 + two COs = 34,957.69)', () => {
    const t = computeJobSaleTotals({
      contracts: [{ id: 'c', projectCost: 23786.11 }],
      changeOrders: [co('2', 26053.15, 34957.69, '2026-08-02'), co('1', 23786.11, 26053.15, '2026-08-01')],
    })
    expect(t).toMatchObject({ ok: true, saleAmount: 34957.69, commissionBase: 34957.69, changeOrdersTotal: 11171.58 })
  })

  it('handles a CO that lowers the price (26-0046: 44,986.42 → 43,633.42)', () => {
    const t = computeJobSaleTotals({
      contracts: [{ id: 'c', projectCost: 44986.42 }],
      changeOrders: [co('1', 44986.42, 43633.42, '2026-09-30')],
    })
    expect(t).toMatchObject({ ok: true, saleAmount: 43633.42, commissionBase: 43633.42 })
  })

  it('does not lose a CO when two were written off the same starting total', () => {
    const t = computeJobSaleTotals({
      contracts: [{ id: 'c', projectCost: 10000 }],
      changeOrders: [co('1', 10000, 10500, '2026-01-01'), co('2', 10000, 10200, '2026-01-02')],
    })
    expect(t).toMatchObject({ ok: true, saleAmount: 10700 })
  })

  it('keeps non-commissionable COs out of the base but in the sale amount', () => {
    const t = computeJobSaleTotals({
      contracts: [{ id: 'c', projectCost: 10000 }],
      changeOrders: [co('1', 10000, 11000, '2026-01-01', false)],
    })
    expect(t).toMatchObject({ ok: true, saleAmount: 11000, commissionBase: 10000 })
  })

  it('starts from the first signed CO when the contract never linked to the job (26-0011)', () => {
    const t = computeJobSaleTotals({
      contracts: [],
      changeOrders: [co('1', 9684.12, 10852.12, '1'), co('2', 10852.12, 10976.12, '2'), co('3', 10976.12, 11280, '3')],
    })
    expect(t).toMatchObject({ ok: true, contractSource: 'first_change_order', saleAmount: 11280 })
  })

  it('refuses to guess when the CO chain disagrees with the contract on file', () => {
    const t = computeJobSaleTotals({
      contracts: [{ id: 'c', projectCost: 9457.84 }],
      changeOrders: [co('1', 14457.84, 15000, '1')],
    })
    expect(t).toEqual({ ok: false, reason: 'change_order_chain_conflict', contractTotal: 9457.84, firstChangeOrderOriginal: 14457.84 })
  })

  it('reports no_signed_contract instead of writing a number', () => {
    expect(computeJobSaleTotals({ contracts: [], changeOrders: [] })).toMatchObject({ ok: false, reason: 'no_signed_contract' })
    expect(computeJobSaleTotals({ contracts: [{ id: 'c', projectCost: 0 }], changeOrders: [] })).toMatchObject({ ok: false })
  })

  it('sums two signed sale agreements on a split deal', () => {
    const t = computeJobSaleTotals({
      contracts: [{ id: 'a', projectCost: 9457.84 }, { id: 'b', projectCost: 5000 }],
      changeOrders: [],
    })
    expect(t).toMatchObject({ ok: true, saleAmount: 14457.84 })
  })
})

describe('buildCommissionPayrollSnapshot reads only the stored base', () => {
  it('uses the stored base and never subtracts a dealer fee', () => {
    const s = buildCommissionPayrollSnapshot({ commission_comp_base: 6622.79, sale_amount: 6622.79, dealer_fee_amount: 992.76 })
    expect(s.compBase).toBe(6622.79)
    expect(s.source).toBe('stored')
  })

  it('has no fallback estimate: a missing base is unavailable', () => {
    const s = buildCommissionPayrollSnapshot({ commission_comp_base: null, sale_amount: 10000, dealer_fee_amount: 500 })
    expect(s.compBase).toBeNull()
    expect(s.poolCap).toBeNull()
    expect(s.source).toBe('unavailable')
  })
})

describe('computeJobSaleTotals — base excludes sales tax ONLY, never the dealer fee (2026-10-22)', () => {
  it('sale amount stays tax-included; base = signed total − sales tax', () => {
    const t = computeJobSaleTotals({ contracts: [{ id: 'c', projectCost: 12998.56 }], changeOrders: [], salesTax: 805.81 })
    if (!t.ok) throw new Error('expected ok')
    expect(t.saleAmount).toBe(12998.56)
    expect(t.commissionBase).toBe(12192.75)
  })

  it('change orders add to the base; tax still comes off', () => {
    const t = computeJobSaleTotals({
      contracts: [{ id: 'c', projectCost: 10000 }],
      changeOrders: [{ id: 'co', originalAmount: 10000, updatedTotal: 10500, isCommissionable: true, createdAt: '2026-01-01' }],
      salesTax: 500,
    })
    if (!t.ok) throw new Error('expected ok')
    expect(t.saleAmount).toBe(10500)
    expect(t.commissionBase).toBe(10000)
  })

  it('never goes negative', () => {
    const t = computeJobSaleTotals({ contracts: [{ id: 'c', projectCost: 100 }], changeOrders: [], salesTax: 150 })
    if (!t.ok) throw new Error('expected ok')
    expect(t.commissionBase).toBe(0)
  })

  it('a DEALER FEE NEVER REDUCES THE BASE, even if a caller passes one', () => {
    const input = { contracts: [{ id: 'c', projectCost: 16325 }], changeOrders: [], salesTax: 0 }
    const without = computeJobSaleTotals(input)
    for (const fee of [1, 681.12, 5000, 99999]) {
      const withFee = computeJobSaleTotals({ ...input, dealerFee: fee } as never)
      if (!without.ok || !withFee.ok) throw new Error('expected ok')
      expect(withFee.commissionBase).toBe(without.commissionBase)
      expect(withFee.commissionBase).toBe(16325)
    }
  })

  it('the writer never selects or uses the job dealer fee column', () => {
    const raw = require('fs').readFileSync(require('path').join(process.cwd(), 'lib/job-commission-base.ts'), 'utf8')
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/dealer_?fee/i)
  })
})
