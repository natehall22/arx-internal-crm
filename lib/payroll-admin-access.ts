/**
 * Who may use /admin/payroll UI and /api/admin/payroll/* APIs.
 * Keep in sync with app/admin/payroll/layout.tsx.
 */
export const PAYROLL_ADMIN_ROLES = ['admin', 'owner', 'operations'] as const

export const PAYROLL_ADMIN_ROLE_SET = new Set<string>(PAYROLL_ADMIN_ROLES)

export function isPayrollAdminRole(role: string | null | undefined): boolean {
  return PAYROLL_ADMIN_ROLE_SET.has(String(role || '').toLowerCase())
}

/**
 * Roles that may approve bonuses — but only for reps within their manager hierarchy.
 * These roles are NOT in PAYROLL_ADMIN_ROLES and must not gain access to other payroll
 * endpoints (statements, commission overrides, period locking, etc.).
 */
export const REGIONAL_BONUS_APPROVER_ROLES = new Set<string>([
  'regional_manager',
  'regional_setter_manager',
])

export function isRegionalBonusApproverRole(role: string | null | undefined): boolean {
  return REGIONAL_BONUS_APPROVER_ROLES.has(String(role ?? '').toLowerCase())
}
