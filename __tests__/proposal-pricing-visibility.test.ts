import { shouldShowOnlyTotalInvestment } from '@/lib/proposal-pricing-visibility'

describe('shouldShowOnlyTotalInvestment', () => {
  it('collapses pricing when the all-in financed total includes a gross-up', () => {
    expect(shouldShowOnlyTotalInvestment(26864, 22837)).toBe(true)
  })

  it('keeps the standard breakdown when financing does not increase the total', () => {
    expect(shouldShowOnlyTotalInvestment(22837, 22837)).toBe(false)
  })

  it('compares currency at cent precision', () => {
    expect(shouldShowOnlyTotalInvestment(22837.004, 22837)).toBe(false)
    expect(shouldShowOnlyTotalInvestment(22837.01, 22837)).toBe(true)
  })
})
