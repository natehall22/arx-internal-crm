import { JobPayment } from '@/lib/types/job-payments'

export interface DepositCheckResult {
  satisfied: boolean
  reason: 'deposit_payment' | 'threshold_met' | 'not_met'
  hasDepositPayment: boolean
  collectedCents: number
  requiredDepositCents: number
  depositPercent: number
}

/**
 * Determines if the deposit requirement is satisfied for a job.
 * 
 * Deposit is satisfied if:
 * 1. Any payment with payment_type === 'deposit' exists (and amount > 0)
 * 2. OR total collected >= required deposit amount (sale * deposit_percent)
 */
export function isDepositSatisfied(
  payments: JobPayment[],
  collectedCents: number,
  saleAmountCents: number,
  depositRequiredPercent: number
): boolean {
  const result = checkDepositStatus(payments, collectedCents, saleAmountCents, depositRequiredPercent)
  return result.satisfied
}

/**
 * Returns detailed deposit status for debugging and display purposes.
 */
export function checkDepositStatus(
  payments: JobPayment[],
  collectedCents: number,
  saleAmountCents: number,
  depositRequiredPercent: number
): DepositCheckResult {
  const hasDepositPayment = payments.some(
    p => p.payment_type === 'deposit' && p.amount_cents > 0
  )
  
  const requiredDepositCents = Math.round(saleAmountCents * depositRequiredPercent)
  const meetsThreshold = collectedCents >= requiredDepositCents
  
  let reason: DepositCheckResult['reason'] = 'not_met'
  let satisfied = false
  
  if (hasDepositPayment) {
    reason = 'deposit_payment'
    satisfied = true
  } else if (meetsThreshold) {
    reason = 'threshold_met'
    satisfied = true
  }
  
  return {
    satisfied,
    reason,
    hasDepositPayment,
    collectedCents,
    requiredDepositCents,
    depositPercent: depositRequiredPercent,
  }
}

/**
 * Calculate the required deposit amount in cents.
 */
export function calculateRequiredDeposit(
  saleAmountCents: number,
  depositRequiredPercent: number
): number {
  return Math.round(saleAmountCents * depositRequiredPercent)
}
