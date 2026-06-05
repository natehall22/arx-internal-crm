/** Compensation plan per-unit types (stored on comp_plans.unit_type / hybrid_components.unit_type). */

export const KNOWN_COMP_PLAN_UNIT_TYPES = [
  'square',
  'kw',
  'linear_foot',
  'panel',
  'window',
  'sit',
  'sale',
] as const

export type KnownCompPlanUnitType = (typeof KNOWN_COMP_PLAN_UNIT_TYPES)[number]

/** Period-scoped units are counted from CRM activity in the pay window (not per job). */
export const PERIOD_SCOPED_COMP_UNIT_TYPES = new Set<string>(['sit', 'sale'])

export function isKnownCompPlanUnitType(value: string | null | undefined): boolean {
  if (!value) return false
  return (KNOWN_COMP_PLAN_UNIT_TYPES as readonly string[]).includes(value)
}

export function isPeriodScopedCompUnitType(value: string | null | undefined): boolean {
  return Boolean(value && PERIOD_SCOPED_COMP_UNIT_TYPES.has(value))
}

export const COMP_PLAN_UNIT_TYPE_LABELS: Record<string, string> = {
  square: 'Square',
  kw: 'kW',
  linear_foot: 'Linear Ft',
  panel: 'Panel',
  window: 'Window',
  sit: 'Sit',
  sale: 'Sale',
  custom: 'Custom Unit',
}

export const COMP_PLAN_UNIT_RATE_LABELS: Record<string, string> = {
  square: 'per Square',
  kw: 'per kW',
  linear_foot: 'per Linear Foot',
  panel: 'per Panel',
  window: 'per Window',
  sit: 'per Sit',
  sale: 'per Sale',
  custom: 'Custom Unit',
}

export const COMP_PLAN_UNIT_HINTS: Record<string, string> = {
  square: 'Roofing squares (100 sq ft each)',
  kw: 'Kilowatts of solar installed',
  linear_foot: 'Linear feet of material',
  panel: 'Panels installed',
  window: 'Windows installed',
  sit: 'Qualified inspection sits you set in the pay period',
  sale: 'Closed installation or repair agreements in the pay period',
}

export const COMP_PLAN_UNIT_CALCULATOR_LABELS: Record<string, string> = {
  square: 'Squares per Month',
  kw: 'kW Installed per Month',
  panel: 'Panels per Month',
  linear_foot: 'Linear Feet per Month',
  window: 'Windows per Month',
  sit: 'Sits per Month',
  sale: 'Sales per Month',
}

export function formatCompPlanUnitShortLabel(unitType: string | null | undefined): string {
  if (!unitType) return 'Unit'
  return COMP_PLAN_UNIT_TYPE_LABELS[unitType] || unitType.replace(/_/g, ' ')
}

export function formatCompPlanUnitRateLabel(unitType: string | null | undefined): string {
  if (!unitType) return 'per unit'
  return COMP_PLAN_UNIT_RATE_LABELS[unitType] || `per ${formatCompPlanUnitShortLabel(unitType)}`
}

export function getCompPlanUnitHint(unitType: string | null | undefined): string | null {
  if (!unitType) return null
  return COMP_PLAN_UNIT_HINTS[unitType] ?? null
}

export function getCompPlanUnitCalculatorLabel(unitType: string | null | undefined): string {
  if (!unitType) return 'Units per Month'
  return COMP_PLAN_UNIT_CALCULATOR_LABELS[unitType] || `${formatCompPlanUnitShortLabel(unitType)} per Month`
}
