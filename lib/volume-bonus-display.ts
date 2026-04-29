export type VolumeBonusTierMetric = 'volume' | 'closing_rate' | 'sits'

export function normalizeVolumeBonusTierMetric(m: string | null | undefined): VolumeBonusTierMetric {
  if (m === 'closing_rate' || m === 'sits') return m
  return 'volume'
}

/** Human-readable range for tier rows (min/max semantics depend on metric). */
export function formatVolumeBonusTierRange(
  tier: { min_volume: number; max_volume: number | null; tier_metric?: string | null },
  opts?: { nextMinVolume?: number | null }
): string {
  const m = normalizeVolumeBonusTierMetric(tier.tier_metric)
  const min = tier.min_volume
  const max = tier.max_volume
  if (m === 'sits') {
    const hi =
      max != null
        ? max
        : opts?.nextMinVolume != null
          ? opts.nextMinVolume - 1
          : null
    return hi != null ? `${min} – ${hi} sits` : `${min}+ sits`
  }
  if (m === 'closing_rate') {
    const hi =
      max != null
        ? max
        : opts?.nextMinVolume != null
          ? opts.nextMinVolume - 1
          : null
    return hi != null ? `${min}% – ${hi}% close rate` : `${min}%+ close rate`
  }
  return max != null
    ? `$${min.toLocaleString()} – $${max.toLocaleString()} volume`
    : `$${min.toLocaleString()}+ volume`
}

export function volumeBonusTierInRange(
  tier: { min_volume: number; max_volume: number | null; tier_metric?: string | null },
  values: {
    periodVolume: number
    periodSits: number
    periodClosingRatePct: number | null
  },
  opts?: { nextMinVolume?: number | null }
): boolean {
  const m = normalizeVolumeBonusTierMetric(tier.tier_metric)
  let v: number | null
  if (m === 'volume') v = values.periodVolume
  else if (m === 'sits') v = values.periodSits
  else {
    v = values.periodClosingRatePct
  }
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
    | Array<{
        min_volume: number
        max_volume: number | null
        bonus_type: string
        bonus_value: number
        tier_metric?: string | null
      }>
    | null
    | undefined,
  values: {
    periodVolume: number
    periodSits: number
    periodClosingRatePct: number | null
  }
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
