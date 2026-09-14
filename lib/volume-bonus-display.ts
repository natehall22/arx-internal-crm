import { volumeBonusTierMetric } from '@/lib/calculate-commission-from-plan'

type TierBounds = { min_volume: number; max_volume: number | null; tier_metric?: string | null }

/** The values a bonus tier can be measured against. Same inputs payroll uses. */
export type BonusTierValues = {
  periodSits: number
  periodClosingRatePct: number | null
}

/** Human-readable range for tier rows (min/max semantics depend on metric). */
export function formatVolumeBonusTierRange(
  tier: TierBounds,
  opts?: { nextMinVolume?: number | null }
): string {
  const m = volumeBonusTierMetric(tier.tier_metric)
  const min = tier.min_volume
  const max = tier.max_volume
  const hi =
    max != null
      ? max
      : opts?.nextMinVolume != null
        ? opts.nextMinVolume - 1
        : null
  if (m === 'sits') return hi != null ? `${min} – ${hi} sits` : `${min}+ sits`
  if (m === 'closing_rate') return hi != null ? `${min}% – ${hi}% close rate` : `${min}%+ close rate`
  // Payroll pays nothing on a row without a supported metric — say so rather than
  // render it as if it were a live tier.
  return 'Inactive tier (no sits / close-rate metric)'
}

export function volumeBonusTierInRange(
  tier: TierBounds,
  values: BonusTierValues,
  opts?: { nextMinVolume?: number | null }
): boolean {
  const m = volumeBonusTierMetric(tier.tier_metric)
  const v = m === 'sits' ? values.periodSits : m === 'closing_rate' ? values.periodClosingRatePct : null
  if (v === null) return false
  const minV = Number(tier.min_volume) || 0
  const maxV =
    tier.max_volume == null
      ? opts?.nextMinVolume != null
        ? opts.nextMinVolume - 1
        : null
      : Number(tier.max_volume)
  if (v < minV) return false
  if (maxV != null && v > maxV) return false
  return true
}

/** First matching tier wins (same rule as payroll `calculateCommissionFromPlanForSale`). */
export function applyFirstMatchingVolumeBonus(
  bonuses:
    | Array<TierBounds & { bonus_type: string; bonus_value: number }>
    | null
    | undefined,
  values: BonusTierValues
): { extraRatePct: number; flatPerSale: number } {
  if (!bonuses?.length) return { extraRatePct: 0, flatPerSale: 0 }
  for (let i = 0; i < bonuses.length; i++) {
    const tier = bonuses[i]
    const next = bonuses[i + 1]
    if (
      !volumeBonusTierInRange(tier, values, {
        nextMinVolume: next?.min_volume ?? null,
      })
    ) {
      continue
    }
    if (tier.bonus_type === 'percentage') {
      return { extraRatePct: Number(tier.bonus_value) || 0, flatPerSale: 0 }
    }
    if (tier.bonus_type === 'flat') {
      return { extraRatePct: 0, flatPerSale: Number(tier.bonus_value) || 0 }
    }
  }
  return { extraRatePct: 0, flatPerSale: 0 }
}
