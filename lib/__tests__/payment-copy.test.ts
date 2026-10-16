import { computeBalanceDue, paymentNotes } from '@/lib/contracts/payment-copy'

describe('computeBalanceDue', () => {
  it('is price minus deposit, never negative', () => {
    expect(computeBalanceDue(16325, 2000)).toBe(14325)
    expect(computeBalanceDue(1000, 5000)).toBe(0)
    expect(computeBalanceDue(null, undefined)).toBe(0)
  })
})

describe('paymentNotes', () => {
  it('always states the balance rule, the Substantial Completion meaning and change orders', () => {
    const notes = paymentNotes({ paymentMethod: 'cash' }).join(' ')
    expect(notes).toMatch(/balance is due when the work is substantially complete/i)
    expect(notes).toMatch(/"substantially complete" means/)
    expect(notes).toMatch(/change orders are due with this final payment/i)
    expect(notes).toMatch(/does not profit from a cancellation/)
    expect(notes).not.toMatch(/insurance/i)
  })
  it('mentions the carrier approving the scope only on insurance deals', () => {
    expect(paymentNotes({ paymentMethod: 'insurance' }).join(' ')).toMatch(/insurance carrier approves the completed scope/)
  })
  it('names the lender only on finance deals and the insurance note only on insurance deals', () => {
    expect(paymentNotes({ paymentMethod: 'finance', financeCompany: 'Sunlight' }).join(' ')).toMatch(/through your Sunlight financing/)
    expect(paymentNotes({ paymentMethod: 'cash', financeCompany: 'Sunlight' }).join(' ')).not.toMatch(/Sunlight/)
    expect(paymentNotes({ paymentMethod: 'insurance' }).join(' ')).toMatch(/Working with your insurance/)
  })
})
