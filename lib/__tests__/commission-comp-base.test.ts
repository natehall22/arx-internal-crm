import { commissionCompBaseFromSale } from '@/lib/commission-payroll'

describe('commissionCompBaseFromSale', () => {
  it('uses the full signed sale (26-0047 Jones: discount already in the contract total)', () => {
    expect(commissionCompBaseFromSale(9900.14, null)).toBe(9900.14)
  })

  it('keeps sales tax in the base (26-0046 Cox: change-order total, tax included)', () => {
    expect(commissionCompBaseFromSale(43633.42, null)).toBe(43633.42)
  })

  it('subtracts the dealer fee on finance jobs', () => {
    expect(commissionCompBaseFromSale(18959.39, 756.48)).toBe(18202.91)
  })

  it('never goes negative', () => {
    expect(commissionCompBaseFromSale(100, 250)).toBe(0)
  })
})
