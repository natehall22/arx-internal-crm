/**
 * Per-sale commission from a comp plan. Tiered plans select a rate by the sale's
 * commissionable amount; percentage applies to the commissionable amount.
 */

import { roundMoney } from '@/lib/money'

/**
 * What a bonus tier's min/max bounds measure. Monthly $ sales volume was a third
 * metric until 2026-09-14: the current comp plan (arx-website src/lib/comp-plan.ts)
 * has no volume tiers and no plan or plan version in prod ever carried one, so the
 * metric was deleted rather than kept computing a number nothing paid on.
 */
export type VolumeBonusTierMetric = 'closing_rate' | 'sits'

/** One row of `comp_plans.volume_bonuses` — the column name predates sits/close-rate tiers. */
export type VolumeBonusRow = {
  min_volume: number
  max_volume: number | null
  bonus_type: string
  bonus_value: number
  tier_metric?: VolumeBonusTierMetric | string | null
}

export type TierRow = { min: number; max: number | null; rate: number }

/** One row of `comp_plans.hybrid_components` (see migration 040). */
export type HybridComponentForCalc = {
  type: string
  rate?: number | null
  unit_type?: string | null
  description?: string | null
}

export type CompPlanForCalc = {
  id: string
  name?: string | null
  plan_type: string
  base_percentage?: number | null
  flat_amount?: number | null
  flat_rate?: number | null
  tiers?: TierRow[] | null
  volume_bonuses?: VolumeBonusRow[] | null
  hybrid_components?: HybridComponentForCalc[] | null
  is_active?: boolean
}

export type HybridSaleComponents = {
  /** Sum of every `percentage` component's rate, as a percent of the commission base. */
  percentRate: number
  /** Sum of every `flat_per_job` component's rate, in dollars per sold job. */
  flatPerJob: number
  /** False when the plan has no per-sale component at all (pure hourly/per-unit hybrid). */
  hasSaleBasedComponent: boolean
}

/**
 * Split a hybrid plan's components into the part that is earned PER SALE and the
 * part that is earned per period.
 *
 * Only `percentage` and `flat_per_job` are per-sale, so only those belong in
 * per-job commission math. `hourly` is resolved by `lib/payroll-hourly-rate.ts`
 * against timesheet hours, and `per_unit` by `lib/comp-plan-period-unit-earnings.ts`
 * against sits/sales in the pay period — both are period-scoped and must never be
 * folded into a per-job amount (nor into the per-job pool cap).
 *
 * Multiple components of the same type are summed rather than "first wins": the
 * admin UI lets an admin add as many rows as they like, and dropping one silently
 * would underpay.
 */
export function sumHybridSaleComponents(
  components: HybridComponentForCalc[] | null | undefined
): HybridSaleComponents {
  let percentRate = 0
  let flatPerJob = 0
  let hasSaleBasedComponent = false

  if (Array.isArray(components)) {
    for (const comp of components) {
      const rate = Number(comp?.rate)
      if (!Number.isFinite(rate) || rate <= 0) continue
      if (comp.type === 'percentage') {
        percentRate += rate
        hasSaleBasedComponent = true
      } else if (comp.type === 'flat_per_job') {
        flatPerJob += rate
        hasSaleBasedComponent = true
      }
      // 'hourly' and 'per_unit' are deliberately ignored here.
    }
  }

  return {
    percentRate: roundMoney(percentRate),
    flatPerJob: roundMoney(flatPerJob),
    hasSaleBasedComponent,
  }
}

/**
 * The tier's metric, or null for a row with no supported metric — including a legacy
 * row with `tier_metric` omitted or `'volume'`. Such a row pays nothing: guessing a
 * metric for it would pay a bonus on terms nobody set.
 */
export function volumeBonusTierMetric(
  m: string | null | undefined
): VolumeBonusTierMetric | null {
  return m === 'closing_rate' || m === 'sits' ? m : null
}

/**
 * True when a submitted `volume_bonuses` value contains a row payroll would ignore
 * (no `sits` / `closing_rate` metric). Comp-plan writes reject these so an admin can't
 * save a tier that reps see on their dashboard but that never pays.
 */
export function hasUnsupportedBonusTier(rows: unknown): boolean {
  if (rows == null) return false
  if (!Array.isArray(rows)) return true
  return rows.some(
    (row) =>
      !row ||
      typeof row !== 'object' ||
      volumeBonusTierMetric((row as { tier_metric?: string | null }).tier_metric) === null
  )
}

function compareValueForVolumeBonus(
  row: VolumeBonusRow,
  input: { periodSits: number; periodClosingRatePct: number | null }
): number | null {
  const metric = volumeBonusTierMetric(row.tier_metric)
  if (metric === 'sits') return Math.round(Number(input.periodSits) || 0)
  if (metric === 'closing_rate') {
    if (input.periodClosingRatePct == null || !Number.isFinite(input.periodClosingRatePct)) return null
    return roundMoney(input.periodClosingRatePct)
  }
  return null
}

function flatDollars(plan: CompPlanForCalc): number {
  return roundMoney(Number(plan.flat_amount ?? plan.flat_rate ?? 0) || 0)
}

export function calculateCommissionFromPlanForSale(input: {
  plan: CompPlanForCalc
  commissionableAmount: number
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
  /**
   * Whether `totalAmount` must be summed into `scaleCommissionsToPool()`.
   *
   * This is per-COMPONENT, not per-plan-type: a hybrid plan's hourly and per-unit
   * dollars never reach `totalAmount` (they are period-scoped and computed
   * elsewhere), so a hybrid's per-sale percentage / $-per-job amount counts inside
   * the 18% pool cap exactly like any percentage plan would. Plans whose entire
   * payout is period-scoped return false with a $0 amount.
   */
  countsTowardPoolCap: boolean
} {
  const v = roundMoney(input.commissionableAmount)
  const plan = input.plan
  let baseRate = 0
  let commission = 0
  /** Dollars-per-job from hybrid `flat_per_job` components; added after rate math. */
  let hybridFlatPerJob = 0
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
  } else if (pt === 'hourly' || pt === 'unit_based') {
    return {
      compPlanId: plan.id,
      baseRate: 0,
      volumeBonusRate: 0,
      volumeBonusFlat: 0,
      effectiveRate: 0,
      commissionAmount: 0,
      totalAmount: 0,
      unsupported: false,
      note: 'Hourly/unit — pay entered separately in period hours / per-unit entry.',
      countsTowardPoolCap: false,
    }
  } else if (pt === 'hybrid') {
    // A hybrid plan's `% of Sale` and `$ per Job` components are real per-sale pay
    // and are rendered to the rep on their dashboard. Before this they produced no
    // payroll line at all, so a rep could see compensation they would never receive.
    const hybrid = sumHybridSaleComponents(plan.hybrid_components)
    if (!hybrid.hasSaleBasedComponent) {
      return {
        compPlanId: plan.id,
        baseRate: 0,
        volumeBonusRate: 0,
        volumeBonusFlat: 0,
        effectiveRate: 0,
        commissionAmount: 0,
        totalAmount: 0,
        unsupported: false,
        note: 'Hybrid — hourly/per-unit components only; paid separately in period hours entry.',
        countsTowardPoolCap: false,
      }
    }
    baseRate = hybrid.percentRate
    hybridFlatPerJob = hybrid.flatPerJob
    commission = roundMoney(v * (baseRate / 100))
  } else {
    baseRate = roundMoney(Number(plan.base_percentage) || 0)
    commission = roundMoney(v * (baseRate / 100))
  }

  // NOTE for hybrid plans: `user_comp_plans.override_percentage` REPLACES the summed
  // percentage components (it does not stack with them), exactly as it replaces
  // base_percentage on a percentage plan. A `flat_per_job` component is untouched by
  // the override — it is dollars, not a rate.
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
    // hybridFlatPerJob is 0 for every non-hybrid plan, so this stays byte-identical
    // to the previous `v * effectiveRate` for existing percentage/tiered reps.
    commission = roundMoney(roundMoney(v * (effectiveRate / 100)) + hybridFlatPerJob)
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
    countsTowardPoolCap: true,
  }
}
