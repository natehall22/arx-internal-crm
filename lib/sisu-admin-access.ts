/**
 * Roles that administer the Sisu surfaces — incentives, badges, goals, setter ramp,
 * and the accountability board.
 *
 * Wider than `PAYROLL_ADMIN_ROLES` on purpose: these screens configure and review
 * program *targets*, they do not approve or release money. Do not reuse this set to
 * gate a payout — see `lib/payroll-admin-access.ts` for that.
 *
 * This was the same eight-role literal copy-pasted into seven files (six API routes
 * plus `app/admin/sisu/layout.tsx`); adding a role meant finding all seven.
 */
export const SISU_ADMIN_ROLES = [
  'admin',
  'owner',
  'regional_manager',
  'regional_setter_manager',
  'sales_manager',
  'setter_manager',
  'manager',
  'operations',
] as const

const SISU_ADMIN_ROLE_SET = new Set<string>(SISU_ADMIN_ROLES)

export function isSisuAdminRole(role: string | null | undefined): boolean {
  return SISU_ADMIN_ROLE_SET.has(String(role || '').toLowerCase().trim())
}
