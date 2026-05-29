import type { CompPlanForCalc } from '@/lib/calculate-commission-from-plan'

type CompPlanRow = CompPlanForCalc & { hourly_rate?: number | null }

/**
 * Resolve hourly rate for period hours entry: user override, then plan hourly_rate.
 */
export function resolveHourlyRate(input: {
  hourlyRateOverride: number | null | undefined
  compPlan: CompPlanRow | null | undefined
}): number | null {
  const override = Number(input.hourlyRateOverride)
  if (Number.isFinite(override) && override > 0) return override
  const planRate = Number(input.compPlan?.hourly_rate)
  if (Number.isFinite(planRate) && planRate > 0) return planRate
  return null
}
