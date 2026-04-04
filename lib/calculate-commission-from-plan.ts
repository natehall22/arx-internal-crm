/**
 * Mirrors supabase `calculate_commission_with_volume` (see migration 027):
 * tiered tiers use commissionable amount; percentage applies to commissionable amount.
 */

export type VolumeBonusRow = {
  min_volume: number
  max_volume: number | null
  bonus_type: string
  bonus_value: number
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

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

function flatDollars(plan: CompPlanForCalc): number {
  return roundMoney(Number(plan.flat_amount ?? plan.flat_rate ?? 0) || 0)
}

export function calculateCommissionFromPlanForSale(input: {
  plan: CompPlanForCalc
  commissionableAmount: number
  /** User-attributed volume for the sale month (for volume bonus tiers). */
  periodVolume: number
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
      unsupported: true,
      note: `Plan type "${pt}" is not included in payroll export; configure percentage/tiered/flat or extend the calculator.`,
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
  if (vb && Array.isArray(vb) && input.periodVolume > 0) {
    const pv = input.periodVolume
    for (const row of vb as VolumeBonusRow[]) {
      const minV = Number(row.min_volume) || 0
      const maxV = row.max_volume == null ? null : Number(row.max_volume)
      if (pv >= minV && (maxV == null || pv <= maxV)) {
        if (row.bonus_type === 'percentage') {
          volumeBonusRate = roundMoney(Number(row.bonus_value) || 0)
        } else if (row.bonus_type === 'flat') {
          volumeBonusFlat = roundMoney(Number(row.bonus_value) || 0)
        }
        break
      }
    }
  }

  const effectiveRate = roundMoney(baseRate + volumeBonusRate)

  if (pt === 'flat_rate') {
    commission = roundMoney(flatDollars(plan) + volumeBonusFlat)
  } else {
    commission = roundMoney(v * (effectiveRate / 100) + volumeBonusFlat)
  }

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
