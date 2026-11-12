import type { SupabaseClient } from '@supabase/supabase-js'

import { effectiveHasPermission, resolveEffectivePermissionNames } from '@/lib/effective-permissions'

/**
 * Who may act on a document that is out for signature (through the permission model, no role list of its own):
 *  - resend / remind / extend / certificate: the person who sent it, or anyone with `contracts:send`;
 *  - void: the person who sent it, or a manager (`teams:manage`) / admin (full access).
 * Field roles never reach this (the route refuses them first). Reading the status is open to the same company's office users.
 */
export async function canActOnSigning(
  admin: SupabaseClient,
  user: { id: string; role: string; custom_role_id?: string | null },
  row: { created_by?: string | null },
  action: string
): Promise<boolean> {
  const isSender = !!row.created_by && row.created_by === user.id
  if (isSender) return true
  const perms = await resolveEffectivePermissionNames(admin, user.id, user)
  if (action === 'void') return effectiveHasPermission(perms, 'teams:manage')
  return effectiveHasPermission(perms, 'contracts:send')
}
