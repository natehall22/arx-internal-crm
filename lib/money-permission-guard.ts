/**
 * Only an owner may add or remove the two money permissions (reports:financials, money:record), on a person OR on a role.
 * Every other permission-editing route (user permissions, roles, new users, single grants) runs its request through here so the
 * "owner-only" rule cannot be side-stepped by editing a role or saving a user's permission list.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { DENIABLE_PERMISSIONS } from '@/lib/effective-permissions'
import { isOwnerProfile } from '@/lib/super-admin'

export async function actorIsOwner(admin: SupabaseClient, actorId: string): Promise<boolean> {
  const { data } = await admin.from('users').select('role, is_super_admin, active').eq('id', actorId).maybeSingle()
  return isOwnerProfile(data)
}

export async function moneyPermissionIds(admin: SupabaseClient): Promise<Set<string>> {
  const { data } = await admin.from('permissions').select('id').in('name', [...DENIABLE_PERMISSIONS])
  return new Set((data ?? []).map((p: { id: string }) => p.id))
}

export function isMoneyPermissionName(name: unknown): boolean {
  return (DENIABLE_PERMISSIONS as readonly string[]).includes(String(name))
}

/**
 * The permission ids to actually save. An owner's list is used as sent. For anyone else the money permissions are ignored in the
 * request and whatever the person/role already has of them is kept.
 */
export function lockMoneyPermissions(requested: string[], current: string[], moneyIds: ReadonlySet<string>, isOwner: boolean): string[] {
  if (isOwner) return requested
  const keep = current.filter((id) => moneyIds.has(id))
  return Array.from(new Set([...requested.filter((id) => !moneyIds.has(id)), ...keep]))
}
