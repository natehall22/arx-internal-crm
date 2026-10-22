/**
 * Super admin = an ARX owner. The one switch that gates money overrides:
 * forcing a job "paid in full" with a balance, and changing sale credit
 * (setter / closer / self-generated) after the contract is signed.
 *
 * Stored as `users.is_super_admin` (nullable boolean, default false — migration
 * 202610210010). It is a per-person flag, NOT a role: six people share role
 * `admin` today and only the owners among them are super admins. Do not add a
 * second permission system beside this — import `isSuperAdmin` instead.
 *
 * Client-safe (no server imports). A profile loaded before the column exists has
 * no `is_super_admin` key and is treated as NOT a super admin — fail closed.
 */
export type SuperAdminProfile = {
  is_super_admin?: boolean | null
  active?: boolean | null
} | null | undefined

export function isSuperAdmin(profile: SuperAdminProfile): boolean {
  if (!profile) return false
  // A deactivated owner account must not keep override powers.
  if (profile.active === false) return false
  return profile.is_super_admin === true
}

/** An ARX owner: a super admin, or the `owner` role (active only). The one "who is an owner" check. */
export function isOwnerProfile(profile: (NonNullable<SuperAdminProfile> & { role?: string | null }) | null | undefined): boolean {
  if (!profile) return false
  return isSuperAdmin(profile) || (profile.active !== false && String(profile.role || '').toLowerCase() === 'owner')
}
