import { roundMoney } from '@/lib/money'

/** Org policy: total rep commissions + incentives cannot exceed this fraction of commission comp base. */
export const SALES_COMMISSION_POOL_RATE = 0.18

/**
 * Plan types whose ENTIRE payout is entered outside per-job commission math (period
 * hours, per-period sit/sale units) and must never be summed into
 * `scaleCommissionsToPool()` — doing so would shrink every percentage-plan rep's
 * scaled commission.
 *
 * `hybrid` was in this set and is not any more. It could not stay: a hybrid plan can
 * carry a `% of Sale` or `$ per Job` component, which is per-sale pay and belongs
 * inside the 18% cap alongside the closer and setter lines. The exclusion is now made
 * per COMPONENT instead of per plan type — `calculateCommissionFromPlanForSale()`
 * returns only a hybrid's per-sale components in `totalAmount` and reports
 * `countsTowardPoolCap`, so hourly/per-unit dollars still never touch the cap.
 *
 * Prefer `calc.countsTowardPoolCap` over this set in new payroll code.
 */
export const POOL_CAP_EXCLUDED_PLAN_TYPES = new Set(['hourly', 'unit_based'])

export function isPoolCapExcludedPlanType(planType: string | null | undefined): boolean {
  return POOL_CAP_EXCLUDED_PLAN_TYPES.has(String(planType || '').toLowerCase())
}

export function commissionPoolCap(compBase: number): number {
  return roundMoney(roundMoney(compBase) * SALES_COMMISSION_POOL_RATE)
}

export type CommissionPayrollSource = 'stored' | 'unavailable'

export type CommissionPayrollSnapshot = {
  preTaxSubtotal: number | null
  dealerFeeAmount: number
  compBase: number | null
  poolCap: number | null
  poolRate: number
  source: CommissionPayrollSource
  /** When we could not use proposal snapshot; UI should mention imprecision. */
  fallbackNote: string | null
}

type JobRow = {
  commission_pre_tax_subtotal?: number | null
  commission_comp_base?: number | null
  sale_amount?: number | null
  dealer_fee_amount?: number | null
}

/**
 * Build payroll-facing numbers for a production job.
 *
 * The base is read ONLY from `production_jobs.commission_comp_base`, which has exactly
 * one writer (lib/job-commission-base.ts: signed contract + signed change orders). There
 * is no fallback estimate any more — the old "sale amount minus dealer fee" guess was a
 * second definition of the base. A job without a stored base is `unavailable`, and
 * payroll skips it (`missing_commission_base`) until the data-health check gets it fixed.
 */
export function buildCommissionPayrollSnapshot(job: JobRow): CommissionPayrollSnapshot {
  const dealerFee = roundMoney(job.dealer_fee_amount ?? 0)
  const stored = job.commission_comp_base != null ? Number(job.commission_comp_base) : null

  if (stored != null && Number.isFinite(stored) && stored > 0) {
    const compBase = roundMoney(stored)
    return {
      preTaxSubtotal:
        job.commission_pre_tax_subtotal != null ? roundMoney(job.commission_pre_tax_subtotal) : null,
      dealerFeeAmount: dealerFee,
      compBase,
      poolCap: commissionPoolCap(compBase),
      poolRate: SALES_COMMISSION_POOL_RATE,
      source: 'stored',
      fallbackNote: null,
    }
  }

  return {
    preTaxSubtotal: null,
    dealerFeeAmount: dealerFee,
    compBase: null,
    poolCap: null,
    poolRate: SALES_COMMISSION_POOL_RATE,
    source: 'unavailable',
    fallbackNote: 'No commission base on file. It is set when the contract or a change order is signed.',
  }
}
