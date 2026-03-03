import { isDepositSatisfied, checkDepositStatus, calculateRequiredDeposit } from '../job-deposit'
import type { JobPayment } from '@/lib/types/job-payments'

const createPayment = (overrides: Partial<JobPayment> = {}): JobPayment => ({
  id: 'payment-1',
  job_id: 'job-1',
  paid_at: '2024-01-15',
  amount_cents: 0,
  payment_type: 'other',
  method: 'check',
  payer: 'homeowner',
  note: null,
  created_at: '2024-01-15T12:00:00Z',
  created_by: 'user-1',
  ...overrides,
})

describe('isDepositSatisfied', () => {
  const saleAmountCents = 2593200 // $25,932
  const depositPercent = 0.5 // 50%
  const requiredDepositCents = 1296600 // $12,966

  describe('0% collected', () => {
    it('should NOT be satisfied when no payments exist', () => {
      const result = isDepositSatisfied([], 0, saleAmountCents, depositPercent)
      expect(result).toBe(false)
    })

    it('should NOT be satisfied when collected is 0', () => {
      const payments = [createPayment({ amount_cents: 0, payment_type: 'deposit' })]
      const result = isDepositSatisfied(payments, 0, saleAmountCents, depositPercent)
      expect(result).toBe(false)
    })
  })

  describe('50% collected with deposit requirement = 50%', () => {
    it('should be satisfied when deposit payment exists', () => {
      const payments = [createPayment({ amount_cents: requiredDepositCents, payment_type: 'deposit' })]
      const result = isDepositSatisfied(payments, requiredDepositCents, saleAmountCents, depositPercent)
      expect(result).toBe(true)
    })

    it('should be satisfied when collected meets threshold (even without deposit type)', () => {
      const payments = [createPayment({ amount_cents: requiredDepositCents, payment_type: 'other' })]
      const result = isDepositSatisfied(payments, requiredDepositCents, saleAmountCents, depositPercent)
      expect(result).toBe(true)
    })

    it('should be satisfied when collected exceeds threshold', () => {
      const payments = [createPayment({ amount_cents: requiredDepositCents + 10000, payment_type: 'other' })]
      const result = isDepositSatisfied(payments, requiredDepositCents + 10000, saleAmountCents, depositPercent)
      expect(result).toBe(true)
    })

    it('should NOT be satisfied when collected is just under threshold', () => {
      const payments = [createPayment({ amount_cents: requiredDepositCents - 1, payment_type: 'other' })]
      const result = isDepositSatisfied(payments, requiredDepositCents - 1, saleAmountCents, depositPercent)
      expect(result).toBe(false)
    })
  })

  describe('fixed dollar deposit requirement', () => {
    it('should be satisfied when collected meets fixed amount', () => {
      const fixedDepositCents = 500000 // $5,000 fixed deposit
      const fixedPercent = fixedDepositCents / saleAmountCents // ~19.3%
      
      const payments = [createPayment({ amount_cents: fixedDepositCents, payment_type: 'deposit' })]
      const result = isDepositSatisfied(payments, fixedDepositCents, saleAmountCents, fixedPercent)
      expect(result).toBe(true)
    })
  })

  describe('multiple payments', () => {
    it('should sum multiple payments for threshold check', () => {
      const payments = [
        createPayment({ id: 'p1', amount_cents: 500000, payment_type: 'insurance_acv' }),
        createPayment({ id: 'p2', amount_cents: 796600, payment_type: 'homeowner' }),
      ]
      const totalCollected = 500000 + 796600 // 1,296,600 = exactly 50%
      const result = isDepositSatisfied(payments, totalCollected, saleAmountCents, depositPercent)
      expect(result).toBe(true)
    })

    it('should be satisfied if any payment is marked as deposit type', () => {
      const payments = [
        createPayment({ id: 'p1', amount_cents: 100000, payment_type: 'deposit' }),
        createPayment({ id: 'p2', amount_cents: 50000, payment_type: 'other' }),
      ]
      const totalCollected = 150000 // Only 5.8%, but has deposit payment
      const result = isDepositSatisfied(payments, totalCollected, saleAmountCents, depositPercent)
      expect(result).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('should handle 0% deposit requirement', () => {
      const result = isDepositSatisfied([], 0, saleAmountCents, 0)
      expect(result).toBe(true) // 0 >= 0
    })

    it('should handle 100% deposit requirement', () => {
      const payments = [createPayment({ amount_cents: saleAmountCents, payment_type: 'deposit' })]
      const result = isDepositSatisfied(payments, saleAmountCents, saleAmountCents, 1.0)
      expect(result).toBe(true)
    })

    it('should handle $0 sale amount', () => {
      const result = isDepositSatisfied([], 0, 0, 0.5)
      expect(result).toBe(true) // 0 >= 0
    })
  })
})

describe('checkDepositStatus', () => {
  const saleAmountCents = 2593200
  const depositPercent = 0.5
  const requiredDepositCents = 1296600

  it('should return deposit_payment reason when deposit payment exists', () => {
    const payments = [createPayment({ amount_cents: 100000, payment_type: 'deposit' })]
    const result = checkDepositStatus(payments, 100000, saleAmountCents, depositPercent)
    
    expect(result.satisfied).toBe(true)
    expect(result.reason).toBe('deposit_payment')
    expect(result.hasDepositPayment).toBe(true)
  })

  it('should return threshold_met reason when collected meets threshold', () => {
    const payments = [createPayment({ amount_cents: requiredDepositCents, payment_type: 'other' })]
    const result = checkDepositStatus(payments, requiredDepositCents, saleAmountCents, depositPercent)
    
    expect(result.satisfied).toBe(true)
    expect(result.reason).toBe('threshold_met')
    expect(result.hasDepositPayment).toBe(false)
  })

  it('should return not_met reason when deposit not satisfied', () => {
    const payments = [createPayment({ amount_cents: 100000, payment_type: 'other' })]
    const result = checkDepositStatus(payments, 100000, saleAmountCents, depositPercent)
    
    expect(result.satisfied).toBe(false)
    expect(result.reason).toBe('not_met')
    expect(result.hasDepositPayment).toBe(false)
    expect(result.requiredDepositCents).toBe(requiredDepositCents)
  })
})

describe('calculateRequiredDeposit', () => {
  it('should calculate 50% deposit correctly', () => {
    const result = calculateRequiredDeposit(2593200, 0.5)
    expect(result).toBe(1296600)
  })

  it('should round to nearest cent', () => {
    const result = calculateRequiredDeposit(10001, 0.5)
    expect(result).toBe(5001) // 5000.5 rounds to 5001
  })

  it('should handle 0% deposit', () => {
    const result = calculateRequiredDeposit(2593200, 0)
    expect(result).toBe(0)
  })
})
