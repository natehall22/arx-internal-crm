import type { CompPlanForCalc } from '@/lib/calculate-commission-from-plan'

type HybridHourlyComponent = {
  type: string
  rate?: number | null
  unit_type?: string | null
}

type CompPlanRow = CompPlanForCalc & {
  hourly_rate?: number | null
  hybrid_components?: HybridHourlyComponent[] | null
}

function extractHourlyRateFromHybridComponents(
  components: HybridHourlyComponent[] | null | undefined
): number | null {
  if (!Array.isArray(components)) return null
  for (const comp of components) {
    if (comp.type !== 'hourly') continue
    const rate = Number(comp.rate)
    if (Number.isFinite(rate) && rate > 0) return rate
  }
  return null
}

/**
 * Resolve hourly rate for period hours entry: user override, plan hourly_rate,
 * then hybrid component with type hourly.
 */
export function resolveHourlyRate(input: {
  hourlyRateOverride: number | null | undefined
  compPlan: CompPlanRow | null | undefined
}): number | null {
  const override = Number(input.hourlyRateOverride)
  if (Number.isFinite(override) && override > 0) return override
  const planRate = Number(input.compPlan?.hourly_rate)
  if (Number.isFinite(planRate) && planRate > 0) return planRate
  if (String(input.compPlan?.plan_type || '').toLowerCase() === 'hybrid') {
    return extractHourlyRateFromHybridComponents(input.compPlan?.hybrid_components)
  }
  return null
}
