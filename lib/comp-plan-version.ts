/**
 * Effective-dated comp plan bodies.
 *
 * `comp_plans` used to hold both a plan's identity (name, roles, readme) and its
 * pay-affecting terms (rates, tiers, volume bonuses), with no history — so editing a
 * live plan silently restated what every past job pays. That is why
 * `PUT /api/admin/data?resource=comp_plan` hard-409s on any assigned plan, which in
 * practice meant no plan in the system was editable at all.
 *
 * `comp_plan_versions` holds the terms instead, one append-only row per change with an
 * `effective_from`. Payroll resolves the body on the job's SALE DATE, exactly as it
 * already resolves org derived rates (`resolveDerivedCommissionRatesForSaleDate`) and
 * management overlay rates (`resolveOverlayRatePercent`). Amending a plan then means
 * "add a version from date X", and history keeps paying what it always paid.
 *
 * Identity stays on `comp_plans` and is edited in place: name, description,
 * applicable_roles, readme, is_active, is_default. `is_manager_plan` is NOT identity —
 * it gates who earns derived lines in `buildAdditiveParticipantsForJob` — so it lives
 * on the version.
 */

/** The pay-affecting columns. Mirrors comp_plan_versions one for one. */
export const COMP_PLAN_BODY_FIELDS = [
  'plan_type',
  'base_percentage',
  'flat_amount',
  'hourly_rate',
  'unit_rate',
  'unit_type',
  'hybrid_components',
  'tiers',
  'volume_bonuses',
  'team_overrides',
  'is_manager_plan',
  'personal_sales_enabled',
  'team_override_enabled',
] as const

export type CompPlanBodyField = (typeof COMP_PLAN_BODY_FIELDS)[number]

export type CompPlanVersionRow = {
  comp_plan_id: string
  effective_from: string
} & Partial<Record<CompPlanBodyField, unknown>>

/**
 * The version in force for a plan on a date: the latest one at or before it.
 *
 * Returns null when the plan has no version at or before the date. Callers must treat
 * that as "fall back to the plan row", never as "this plan pays nothing" — an unpriced
 * date must not silently zero somebody's commission.
 */
export function resolveCompPlanVersionForSaleDate(
  versions: readonly CompPlanVersionRow[],
  planId: string,
  saleDate: string | null | undefined
): CompPlanVersionRow | null {
  const ymd = saleDate?.slice(0, 10) ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  return (
    versions
      .filter((row) => row.comp_plan_id === planId && row.effective_from <= ymd)
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null
  )
}

/**
 * The plan as it stood on the sale date: identity from the plan row, terms from the
 * version in force. With no version the plan row is returned untouched, so a plan whose
 * history is missing pays exactly what it pays today rather than nothing.
 */
export function applyCompPlanVersion<T extends Record<string, unknown>>(
  plan: T,
  version: CompPlanVersionRow | null
): T {
  if (!version) return plan
  const merged: Record<string, unknown> = { ...plan }
  for (const field of COMP_PLAN_BODY_FIELDS) {
    if (field in version) merged[field] = version[field]
  }
  return merged as T
}

/** Convenience wrapper: resolve and merge in one step. */
export function compPlanAsOf<T extends Record<string, unknown> & { id: string }>(
  plan: T,
  versions: readonly CompPlanVersionRow[],
  saleDate: string | null | undefined
): T {
  return applyCompPlanVersion(plan, resolveCompPlanVersionForSaleDate(versions, plan.id, saleDate))
}

/**
 * A plan body in canonical form, so "did the terms change?" is a string comparison and
 * not a field-by-field diff that quietly forgets a column. Numeric columns arrive from
 * Postgres as strings and from a form as numbers; both normalize to a number or null.
 */
export function normalizeCompPlanBody(input: Record<string, unknown>): Record<string, unknown> {
  const numeric = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  const json = (value: unknown): unknown => {
    if (value === null || value === undefined) return null
    if (Array.isArray(value) && value.length === 0) return null
    return value
  }
  return {
    plan_type: input.plan_type ?? null,
    base_percentage: numeric(input.base_percentage),
    flat_amount: numeric(input.flat_amount),
    hourly_rate: numeric(input.hourly_rate),
    unit_rate: numeric(input.unit_rate),
    unit_type: input.unit_type === '' || input.unit_type === undefined ? null : input.unit_type,
    hybrid_components: json(input.hybrid_components),
    tiers: json(input.tiers),
    volume_bonuses: json(input.volume_bonuses),
    team_overrides: json(input.team_overrides),
    is_manager_plan: input.is_manager_plan === true,
    personal_sales_enabled: input.personal_sales_enabled !== false,
    team_override_enabled: input.team_override_enabled === true,
  }
}

/** True when two plan bodies differ in any pay-affecting way. */
export function compPlanBodyChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): boolean {
  return JSON.stringify(normalizeCompPlanBody(before)) !== JSON.stringify(normalizeCompPlanBody(after))
}
