/**
 * `users.role` values that imply full org-wide access — always shown as **Admin** in-product.
 *
 * Postgres may still expose `owner` on the enum and on stale rows until migrations run.
 */
export const ORG_SUPERUSER_ROLE_SLUGS = new Set(['admin', 'owner'])

export function isOrgSuperuserRoleSlug(role: string | null | undefined): boolean {
  return ORG_SUPERUSER_ROLE_SLUGS.has(String(role || '').toLowerCase().trim())
}

/**
 * Roles that manage regions, teams and team closer queues — the `/api/admin/data` gate. One copy: the closer-queue
 * route used to have no role check at all (security audit C4, 2026-11-07).
 */
const TEAM_ADMIN_ROLE_SLUGS = new Set(['admin', 'regional_manager', 'sales_manager'])

export function isTeamAdminRoleSlug(role: string | null | undefined): boolean {
  return TEAM_ADMIN_ROLE_SLUGS.has(String(role || '').toLowerCase().trim())
}
