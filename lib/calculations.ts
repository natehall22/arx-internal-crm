import type { Estimate, EstimateLine } from '@/lib/types/database'

export interface CalculationResult {
  laborSubtotal: number
  materialsSubtotal: number
  subtotal: number
  tax: number
  total: number
}

export function calculateEstimateTotals(
  lines: EstimateLine[],
  steepMultiplierPct: number,
  highMultiplierPct: number,
  taxRate: number,
  discountAmount: number
): CalculationResult {
  // Separate labor and materials
  const laborLines = lines.filter((line) => line.is_labor)
  const materialLines = lines.filter((line) => !line.is_labor)

  // Calculate labor subtotal with multipliers
  const laborSubtotal = laborLines.reduce((sum, line) => sum + line.line_total, 0)
  const laborWithMultipliers = laborSubtotal * (1 + steepMultiplierPct + highMultiplierPct)

  // Calculate materials subtotal
  const materialsSubtotal = materialLines.reduce((sum, line) => sum + line.line_total, 0)

  // Calculate subtotal
  const subtotal = laborWithMultipliers + materialsSubtotal - discountAmount

  // Calculate tax on taxable items only
  const taxableSubtotal = lines
    .filter((line) => line.is_taxable)
    .reduce((sum, line) => {
      if (line.is_labor) {
        return sum + line.line_total * (1 + steepMultiplierPct + highMultiplierPct)
      }
      return sum + line.line_total
    }, 0) - discountAmount

  const tax = Math.max(0, taxableSubtotal * taxRate)

  // Calculate total
  const total = subtotal + tax

  return {
    laborSubtotal,
    materialsSubtotal,
    subtotal,
    tax,
    total,
  }
}
