/**
 * Which `users.role` slugs a comp plan may be tagged as applying to.
 *
 * `comp_plans.applicable_roles` is a labelling/filter aid only — payroll pays from the
 * explicit `user_comp_plans` assignment, never from this array (see
 * lib/payroll-export.ts and app/api/user/comp-plan/route.ts, neither of which reads it).
 * Editing this list therefore cannot change anyone's pay; it only changes what an admin
 * can tick in the builder.
 *
 * Every value here is typed as `UserRole`, so TypeScript rejects invented role strings.
 * Labels carry the published ARX comp-ladder rung name where one exists; the raw slug is
 * always shown next to it so an admin can tell `canvasser` (the role field marketers
 * actually hold today) from `setter`.
 */

import type { UserRole } from '@/lib/types/database'

export type CompPlanRoleOption = {
  role: UserRole
  /** Ladder rung name shown to the admin. */
  label: string
  /** Optional one-line clarification under the label. */
  note?: string
}

export const COMP_PLAN_ROLE_OPTIONS: CompPlanRoleOption[] = [
  { role: 'canvasser', label: 'Field Marketer', note: 'Ladder rung 1 — base %; weekly floor is a separate program' },
  { role: 'setter', label: 'Senior Field Marketer', note: 'Ladder rung 2 — base % + inspection %' },
  { role: 'sales_rep', label: 'Closer', note: 'Ladder rung 3 — the role closers hold today' },
  { role: 'closer', label: 'Closer (alt slug)', note: 'No users hold this slug today' },
  { role: 'setter_manager', label: 'Setter Manager', note: 'Ladder rung 4 — base % + inspection % + team override' },
  { role: 'sales_manager', label: 'Sales Manager', note: 'Ladder rung 5 — base % + self-gen + inspection % + override' },
  { role: 'regional_setter_manager', label: 'Regional Setter Manager' },
  { role: 'regional_manager', label: 'Regional Manager' },
  { role: 'inside_sales', label: 'Inside Sales' },
  { role: 'call_center', label: 'Call Center' },
  { role: 'operations', label: 'Operations' },
]

const COMP_PLAN_ROLE_LABELS = new Map<string, string>(
  COMP_PLAN_ROLE_OPTIONS.map((o) => [o.role, o.label])
)

export function isKnownCompPlanRole(role: string): boolean {
  return COMP_PLAN_ROLE_LABELS.has(role)
}

export function compPlanRoleLabel(role: string): string {
  return COMP_PLAN_ROLE_LABELS.get(role) ?? role
}

/**
 * Roles that flip a plan to `is_manager_plan` (unlocking the personal-sales and
 * team-override options). `regional_setter_manager` is included — it was missing from the
 * builder's inline list even though it is a real role slug elsewhere in the system.
 */
export const COMP_PLAN_MANAGER_ROLES: readonly UserRole[] = [
  'sales_manager',
  'setter_manager',
  'regional_manager',
  'regional_setter_manager',
]

const MANAGER_ROLE_SET = new Set<string>(COMP_PLAN_MANAGER_ROLES)

export function isCompPlanManagerRole(role: string): boolean {
  return MANAGER_ROLE_SET.has(role)
}
