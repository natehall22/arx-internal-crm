/**
 * `users.role` values that imply full org-wide access — always shown as **Admin** in-product.
 *
 * Postgres may still expose `owner` on the enum and on stale rows until migrations run.
 */
export const ORG_SUPERUSER_ROLE_SLUGS = new Set(['admin', 'owner'])

export function isOrgSuperuserRoleSlug(role: string | null | undefined): boolean {
  return ORG_SUPERUSER_ROLE_SLUGS.has(String(role || '').toLowerCase().trim())
}
