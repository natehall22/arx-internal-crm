import type { Estimate, EstimateLine } from '@/lib/types/database'
import { computeSalesTax } from '@/lib/sales-tax'

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

  // Tax: THE one calculation (lib/sales-tax.ts) — taxable lines, discount spread over the taxable share, rounded to
  // the cent once. `taxRate` here is a decimal (0.08 = 8%). The estimates tool has 0 saved estimates in prod (2026-11-10),
  // so moving it off its own unrounded float math restates nothing.
  const lineCents = lines.map((line) =>
    Math.round((line.is_labor ? line.line_total * (1 + steepMultiplierPct + highMultiplierPct) : line.line_total) * 100)
  )
  const taxResult = computeSalesTax({
    lines: lines.map((line, i) => ({ amountCents: lineCents[i], taxable: line.is_taxable })),
    discountCents: Math.round((Number(discountAmount) || 0) * 100),
    rates: [{ name: 'Tax', percent: Math.round((Number(taxRate) || 0) * 100 * 1e6) / 1e6 }],
  })
  const tax = taxResult.taxCents / 100

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
