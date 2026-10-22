/**
 * THE rule for "is this job paid in full / collected".
 *
 * Owner decision (Nathan, 2026-10-21): collected is CALCULATED, not chosen —
 *   recorded payments (sum of `job_payments.amount_cents`, refunds negative) vs the
 *   sale amount (signed contract + signed change orders, written only by
 *   lib/job-commission-base.ts). Within $0.05 counts as paid in full. Beyond that only a
 *   SUPER ADMIN can force it, with a required reason; who/when/why is stored on the job
 *   (`allow_close_with_balance` + `close_balance_reason` + `close_balance_by` +
 *   `close_balance_at`) and in `payroll_override_audit` ('force_paid_in_full').
 *
 * A legacy `allow_close_with_balance = true` with no `close_balance_by` was set by
 * whoever clicked "close with balance" before this rule existed — it does NOT count as
 * forced. A super admin re-confirms it (with a reason) if it should stand.
 *
 * Pending payments (`funding_status = 'pending'`) are not money in hand and don't count.
 *
 * Client-safe: used by the job page, the ops board, payroll eligibility and the API guard.
 */

/** $0.05 — rounding on lender/insurance checks shouldn't block a job from closing. */
export const PAID_IN_FULL_TOLERANCE_CENTS = 5

export type CollectionPayment = {
  amount_cents: number | null | undefined
  funding_status?: string | null
}

export type JobCollectionInput = {
  /** production_jobs.sale_amount, dollars. */
  saleAmount: number | string | null | undefined
  /** Either the payment rows, or an already-summed cents figure. */
  payments?: CollectionPayment[]
  collectedCents?: number | null
  allowCloseWithBalance?: boolean | null
  closeBalanceBy?: string | null
}

export type JobCollection = {
  requiredCents: number
  collectedCents: number
  /** required − collected; negative when overpaid. */
  remainingCents: number
  /** Payments cover the sale amount within the tolerance. */
  paidByPayments: boolean
  /** A super admin forced it through with a reason. */
  forcedPaidInFull: boolean
  /** paidByPayments || forcedPaidInFull — the only answer anything should use. */
  paidInFull: boolean
  /** No sale amount on file — nothing to collect against; NOT treated as paid. */
  missingSaleAmount: boolean
  /** An old "close with balance" flag with no super admin on record. */
  legacyCloseWithBalance: boolean
}

export function sumCollectedCents(payments: CollectionPayment[]): number {
  return payments.reduce((sum, payment) => {
    if (payment.funding_status === 'pending') return sum
    const cents = Number(payment.amount_cents)
    return sum + (Number.isFinite(cents) ? Math.round(cents) : 0)
  }, 0)
}

export function evaluateJobCollection(input: JobCollectionInput): JobCollection {
  const sale = Number(input.saleAmount)
  const requiredCents = Number.isFinite(sale) ? Math.round(sale * 100) : 0
  const collectedCents =
    input.payments != null
      ? sumCollectedCents(input.payments)
      : Math.round(Number(input.collectedCents) || 0)
  const remainingCents = requiredCents - collectedCents
  const missingSaleAmount = requiredCents <= 0
  const paidByPayments = !missingSaleAmount && remainingCents <= PAID_IN_FULL_TOLERANCE_CENTS
  const hasForceFlag = Boolean(input.allowCloseWithBalance)
  const forcedPaidInFull = hasForceFlag && Boolean(input.closeBalanceBy)
  return {
    requiredCents,
    collectedCents,
    remainingCents,
    paidByPayments,
    forcedPaidInFull,
    paidInFull: paidByPayments || (!missingSaleAmount && forcedPaidInFull),
    missingSaleAmount,
    legacyCloseWithBalance: hasForceFlag && !input.closeBalanceBy,
  }
}

/** Columns a caller must select from production_jobs to evaluate collection. */
export const JOB_COLLECTION_COLUMNS = 'sale_amount, allow_close_with_balance, close_balance_by'
