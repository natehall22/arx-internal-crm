import { netCommissionableFromJob } from '@/lib/financing'
import { roundMoney } from '@/lib/money'

/** Org policy: total rep commissions + incentives cannot exceed this fraction of commission comp base. */
export const SALES_COMMISSION_POOL_RATE = 0.18

/**
 * Plan types whose dollar amounts are entered outside commission math (period hours, etc.)
 * and must never be summed into `scaleCommissionsToPool()` — doing so would shrink every
 * percentage-plan rep's scaled commission.
 */
export const POOL_CAP_EXCLUDED_PLAN_TYPES = new Set(['hourly', 'hybrid', 'unit_based'])

export function isPoolCapExcludedPlanType(planType: string | null | undefined): boolean {
  return POOL_CAP_EXCLUDED_PLAN_TYPES.has(String(planType || '').toLowerCase())
}

/**
 * Commission comp base = pre–sales-tax subtotal minus dealer fee (when both known from proposal).
 */
export function commissionCompBaseFromPreTaxAndDealerFee(
  preTaxSubtotal: number,
  dealerFeeAmount: number | null | undefined
): number {
  const pre = roundMoney(preTaxSubtotal)
  const fee = roundMoney(dealerFeeAmount ?? 0)
  return Math.max(0, roundMoney(pre - fee))
}

export function commissionPoolCap(compBase: number): number {
  return roundMoney(roundMoney(compBase) * SALES_COMMISSION_POOL_RATE)
}

export type CommissionPayrollSource = 'stored' | 'computed_fallback' | 'unavailable'

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
 * Prefer stored columns (set at contract sign from proposal subtotal + dealer fee).
 */
export function buildCommissionPayrollSnapshot(job: JobRow): CommissionPayrollSnapshot {
  const dealerFee = roundMoney(job.dealer_fee_amount ?? 0)

  if (job.commission_comp_base != null && job.commission_comp_base > 0) {
    const compBase = roundMoney(job.commission_comp_base)
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

  const sale = job.sale_amount != null ? roundMoney(job.sale_amount) : null
  if (sale != null && sale > 0) {
    const approx = netCommissionableFromJob(sale, job.dealer_fee_amount)
    return {
      preTaxSubtotal: null,
      dealerFeeAmount: dealerFee,
      compBase: approx,
      poolCap: commissionPoolCap(approx),
      poolRate: SALES_COMMISSION_POOL_RATE,
      source: 'computed_fallback',
      fallbackNote:
        'Comp base estimated from sale amount and dealer fee (pre-tax subtotal not on file). Confirm with proposal if tax or pricing differs.',
    }
  }

  return {
    preTaxSubtotal: null,
    dealerFeeAmount: dealerFee,
    compBase: null,
    poolCap: null,
    poolRate: SALES_COMMISSION_POOL_RATE,
    source: 'unavailable',
    fallbackNote: null,
  }
}
