import type { UserRole } from '@/lib/types/database'
import { getRoleDisplayName } from '@/lib/permissions'

/**
 * Roles that may receive per-adder manager SPO (aligned with management roles in admin / permissions).
 * Excludes reps, setters, ops, admin/owner (use org policy if those should receive SPO).
 */
export const MANAGER_SPO_ELIGIBLE_ROLES: readonly UserRole[] = [
  'setter_manager',
  'sales_manager',
  'regional_setter_manager',
  'regional_manager',
] as const

export function isManagerSpoEligibleRole(role: string | null | undefined): boolean {
  if (!role) return false
  // Legacy `manager` role (some orgs still use it)
  if (role === 'manager') return true
  return (MANAGER_SPO_ELIGIBLE_ROLES as readonly string[]).includes(role)
}

/** Short list for admin UI helper text */
export function getManagerSpoRoleSummary(): string {
  return MANAGER_SPO_ELIGIBLE_ROLES.map((r) => getRoleDisplayName(r)).join(', ')
}
