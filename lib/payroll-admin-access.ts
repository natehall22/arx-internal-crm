/**
 * Who may use /admin/payroll UI and /api/admin/payroll/* APIs.
 * Keep in sync with app/admin/payroll/layout.tsx.
 */
export const PAYROLL_ADMIN_ROLES = ['admin', 'owner', 'operations'] as const

export const PAYROLL_ADMIN_ROLE_SET = new Set<string>(PAYROLL_ADMIN_ROLES)

export function isPayrollAdminRole(role: string | null | undefined): boolean {
  return PAYROLL_ADMIN_ROLE_SET.has(String(role || '').toLowerCase())
}
