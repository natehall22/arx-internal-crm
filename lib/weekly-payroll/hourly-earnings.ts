import { roundMoney } from '@/lib/money'

export function computeHourlyEarnings(input: {
  regularHours: number
  overtimeHours: number
  hourlyRate: number
  otMultiplier?: number
}): { regularEarnings: number; overtimeEarnings: number; total: number } {
  const rate = roundMoney(Number(input.hourlyRate) || 0)
  const regH = Math.max(0, Number(input.regularHours) || 0)
  const otH = Math.max(0, Number(input.overtimeHours) || 0)
  const otMult = Number(input.otMultiplier) > 0 ? Number(input.otMultiplier) : 1.5
  const regularEarnings = roundMoney(regH * rate)
  const overtimeEarnings = roundMoney(otH * rate * otMult)
  return {
    regularEarnings,
    overtimeEarnings,
    total: roundMoney(regularEarnings + overtimeEarnings),
  }
}
