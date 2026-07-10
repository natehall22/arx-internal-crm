import { isOrgSuperuserRoleSlug } from '@/lib/permissions'

export function assertGoalsAdminAccess(role: string | null | undefined): boolean {
  return isOrgSuperuserRoleSlug(role)
}
