/**
 * Mirrors supabase `calculate_commission_with_volume` (see migration 027):
 * tiered tiers use commissionable amount; percentage applies to commissionable amount.
 */

import { roundMoney } from '@/lib/money'

export type VolumeBonusTierMetric = 'volume' | 'closing_rate' | 'sits'

export type VolumeBonusRow = {
  min_volume: number
  max_volume: number | null
  bonus_type: string
  bonus_value: number
  /** What min/max bounds apply to. Defaults to volume ($) when omitted (legacy rows). */
  tier_metric?: VolumeBonusTierMetric | string | null
}

export type TierRow = { min: number; max: number | null; rate: number }

export type CompPlanForCalc = {
  id: string
  name?: string | null
  plan_type: string
  base_percentage?: number | null
  flat_amount?: number | null
  flat_rate?: number | null
  tiers?: TierRow[] | null
  volume_bonuses?: VolumeBonusRow[] | null
  is_active?: boolean
}

function normalizeTierMetric(row: VolumeBonusRow): VolumeBonusTierMetric {
  const m = row.tier_metric
  if (m === 'closing_rate' || m === 'sits') return m
  return 'volume'
}

function compareValueForVolumeBonus(
  row: VolumeBonusRow,
  input: { periodVolume: number; periodSits: number; periodClosingRatePct: number | null }
): number | null {
  const metric = normalizeTierMetric(row)
  if (metric === 'volume') return roundMoney(Number(input.periodVolume) || 0)
  if (metric === 'sits') return Math.round(Number(input.periodSits) || 0)
  if (input.periodClosingRatePct == null || !Number.isFinite(input.periodClosingRatePct)) return null
  return roundMoney(input.periodClosingRatePct)
}

function flatDollars(plan: CompPlanForCalc): number {
  return roundMoney(Number(plan.flat_amount ?? plan.flat_rate ?? 0) || 0)
}

export function calculateCommissionFromPlanForSale(input: {
  plan: CompPlanForCalc
  commissionableAmount: number
  /** User-attributed commission base sum for the sale month (volume bonus tiers). */
  periodVolume: number
  /** Setter: setter-attributed sits; closer (owner/rep): owner-attributed sits in period. */
  periodSits: number
  /** Closer-only: install sales / sits × 100 for the sale month; null if sits is 0. */
  periodClosingRatePct: number | null
  /** Per-user_comp_plans.override_percentage — replaces computed base % when set. */
  overridePercentage: number | null
}): {
  compPlanId: string
  baseRate: number
  volumeBonusRate: number
  volumeBonusFlat: number
  effectiveRate: number
  commissionAmount: number
  totalAmount: number
  unsupported: boolean
  note: string | null
} {
  const v = roundMoney(input.commissionableAmount)
  const plan = input.plan
  let baseRate = 0
  let commission = 0
  const pt = plan.plan_type

  if (pt === 'flat_rate') {
    baseRate = 0
    commission = flatDollars(plan)
  } else if (pt === 'percentage') {
    baseRate = roundMoney(Number(plan.base_percentage) || 0)
    commission = roundMoney(v * (baseRate / 100))
  } else if (pt === 'tiered' && plan.tiers && Array.isArray(plan.tiers)) {
    const tiers = plan.tiers as TierRow[]
    let tierRate: number | null = null
    for (const tier of tiers) {
      const min = Number(tier.min) || 0
      const max = tier.max == null ? null : Number(tier.max)
      if (v >= min && (max == null || v <= max)) {
        tierRate = Number(tier.rate) || 0
        break
      }
    }
    baseRate = roundMoney(tierRate ?? (Number(plan.base_percentage) || 0))
    commission = roundMoney(v * (baseRate / 100))
  } else if (pt === 'hybrid' || pt === 'hourly' || pt === 'unit_based') {
    return {
      compPlanId: plan.id,
      baseRate: 0,
      volumeBonusRate: 0,
      volumeBonusFlat: 0,
      effectiveRate: 0,
      commissionAmount: 0,
      totalAmount: 0,
      unsupported: false,
      note: 'Hourly/hybrid/unit — hourly pay entered separately in period hours entry.',
    }
  } else {
    baseRate = roundMoney(Number(plan.base_percentage) || 0)
    commission = roundMoney(v * (baseRate / 100))
  }

  if (input.overridePercentage != null && Number.isFinite(Number(input.overridePercentage))) {
    baseRate = roundMoney(Number(input.overridePercentage))
    if (pt !== 'flat_rate') {
      commission = roundMoney(v * (baseRate / 100))
    }
  }

  let volumeBonusRate = 0
  let volumeBonusFlat = 0
  const vb = plan.volume_bonuses
  if (vb && Array.isArray(vb)) {
    for (const row of vb as VolumeBonusRow[]) {
      const cmp = compareValueForVolumeBonus(row, {
        periodVolume: input.periodVolume,
        periodSits: input.periodSits,
        periodClosingRatePct: input.periodClosingRatePct,
      })
      if (cmp === null) continue
      const minV = Number(row.min_volume) || 0
      const maxV = row.max_volume == null ? null : Number(row.max_volume)
      if (cmp >= minV && (maxV == null || cmp <= maxV)) {
        if (row.bonus_type === 'percentage') {
          volumeBonusRate = roundMoney(volumeBonusRate + (Number(row.bonus_value) || 0))
        } else if (row.bonus_type === 'flat') {
          volumeBonusFlat = roundMoney(volumeBonusFlat + (Number(row.bonus_value) || 0))
        }
      }
    }
  }

  const effectiveRate = roundMoney(baseRate + volumeBonusRate)

  if (pt === 'flat_rate') {
    commission = roundMoney(flatDollars(plan))
  } else {
    commission = roundMoney(v * (effectiveRate / 100))
  }

  // volumeBonusFlat is a period-level bonus (e.g. "$500 when sits hit 20").
  // It is NOT added to the per-sale commission here so it can be applied
  // exactly once per period in the export / payroll pipeline.
  const bonus = 0
  const total = roundMoney(commission + bonus)

  return {
    compPlanId: plan.id,
    baseRate,
    volumeBonusRate,
    volumeBonusFlat,
    effectiveRate,
    commissionAmount: commission,
    totalAmount: total,
    unsupported: false,
    note: null,
  }
}
