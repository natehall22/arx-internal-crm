/**
 * Org default pay plan per role.
 *
 * Payroll pays from an explicit `user_comp_plans` assignment. A person with none used to be silently skipped
 * (materializePayrollPeriod: `if (!plan) continue`) — paid nothing, with no warning. A default fills that gap:
 *  - only when there is NO assignment on the sale date;
 *  - only for sale dates on/after the default's `effective_from` (history is never restated);
 *  - the latest default for the person's role with effective_from <= saleDate wins.
 * Pure helpers here; the DB read lives in lib/payroll-export.ts next to the assignment read, so there is one resolver.
 */

export type OrgDefaultCompPlanRow = {
  role: string
  comp_plan_id: string
  effective_from: string
}

export function selectDefaultForRole<T extends OrgDefaultCompPlanRow>(rows: readonly T[], role: string | null | undefined, saleDateYmd: string): T | null {
  if (!role) return null
  const matches = rows.filter((r) => r.role === role && r.effective_from <= saleDateYmd)
  if (matches.length === 0) return null
  return [...matches].sort((a, b) => (a.effective_from < b.effective_from ? 1 : a.effective_from > b.effective_from ? -1 : 0))[0]
}

export type PlanForSuggestion = {
  id: string
  name: string
  is_active: boolean
  base_percentage: number | string | null
  applicable_roles: string[] | null
  plan_purpose: string | null
  is_manager_plan: boolean | null
  plan_type: string | null
}

/** The company base rate each role is paid at (CLAUDE.md / comp ladder): setter 5%, closer 7%. */
export const COMPANY_BASE_RATE_BY_ROLE: Record<string, number> = {
  setter: 5,
  sales_rep: 7,
  closer: 7,
}

/**
 * The one plan we would suggest as a role's default: a primary, non-manager percentage plan tagged for the role
 * whose base rate is the company rate. `null` when there is not exactly one — then a person picks.
 * Inactive plans are allowed (an inactive plan still prices correctly; "active" only hides it from new assignments).
 */
export function suggestDefaultPlan(role: string, plans: readonly PlanForSuggestion[]): PlanForSuggestion | null {
  const rate = COMPANY_BASE_RATE_BY_ROLE[role]
  if (rate === undefined) return null
  const candidates = plans.filter(
    (p) =>
      (p.plan_purpose ?? 'primary') === 'primary' &&
      !p.is_manager_plan &&
      p.plan_type === 'percentage' &&
      (p.applicable_roles ?? []).includes(role) &&
      Number(p.base_percentage) === rate
  )
  return candidates.length === 1 ? candidates[0] : null
}

export type PayPlanCandidate = { id: string; full_name: string | null; role: string }

/**
 * People who should have a pay plan but would be paid nothing: active, earn commission (a commission role, or
 * credited on a deal recently), and have neither a current assignment nor a default for their role.
 */
export function usersMissingPayPlan(args: {
  users: readonly PayPlanCandidate[]
  assignedUserIds: ReadonlySet<string>
  defaultRoles: ReadonlySet<string>
  creditedUserIds: ReadonlySet<string>
}): PayPlanCandidate[] {
  return args.users.filter(
    (u) =>
      !args.assignedUserIds.has(u.id) &&
      !args.defaultRoles.has(u.role) &&
      (COMMISSION_ROLES.has(u.role) || args.creditedUserIds.has(u.id))
  )
}

/** Roles that earn commission by being the role. (Admins/owners only count when credited on a deal.) */
export const COMMISSION_ROLES: ReadonlySet<string> = new Set([
  'sales_rep',
  'closer',
  'setter',
  'canvasser',
  'setter_manager',
  'sales_manager',
  'regional_manager',
  'regional_setter_manager',
  'inside_sales',
  'call_center',
  'rep',
])
