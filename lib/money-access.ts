/**
 * Who has the two money permissions, and how an owner changes it for one person.
 *   state per person per permission: 'default' (what their role gives), 'grant' (user_permissions), 'deny' (permission_denials).
 * Owner-only to change (isOwnerProfile); owners themselves cannot be switched off (no lock-out); every change is audited.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { DENIABLE_PERMISSIONS, resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { hasFinancials, hasMoneyRecord } from '@/lib/financials-access'
import { isOwnerProfile } from '@/lib/super-admin'

export type MoneyPermission = (typeof DENIABLE_PERMISSIONS)[number]
export type MoneyMode = 'default' | 'grant' | 'deny'

export type MoneyAccessRow = {
  id: string
  name: string
  role: string
  isOwner: boolean
  financials: { effective: boolean; mode: MoneyMode }
  moneyRecord: { effective: boolean; mode: MoneyMode }
}

export function isMoneyPermission(v: unknown): v is MoneyPermission {
  return (DENIABLE_PERMISSIONS as readonly string[]).includes(String(v))
}

export async function listMoneyAccess(admin: SupabaseClient, orgId: string): Promise<MoneyAccessRow[]> {
  const [{ data: users }, { data: denials }, { data: grants }] = await Promise.all([
    admin.from('users').select('id, full_name, role, custom_role_id, is_super_admin, active').eq('org_id', orgId).eq('active', true).order('full_name'),
    admin.from('permission_denials').select('user_id, permission_name').eq('org_id', orgId),
    admin.from('user_permissions').select('user_id, permission:permissions(name)').eq('org_id', orgId),
  ])
  const denied = new Set((denials ?? []).map((d: { user_id: string; permission_name: string }) => `${d.user_id}|${d.permission_name}`))
  const granted = new Set<string>()
  for (const g of (grants ?? []) as unknown as Array<{ user_id: string; permission: { name: string } | { name: string }[] | null }>) {
    const p = Array.isArray(g.permission) ? g.permission[0] : g.permission
    if (p?.name) granted.add(`${g.user_id}|${p.name}`)
  }
  const people = (users ?? []) as Array<{ id: string; full_name: string | null; role: string; custom_role_id: string | null; is_super_admin: boolean | null; active: boolean }>
  const resolved = await Promise.all(people.map((u) => resolveEffectivePermissionNames(admin, u.id, u)))
  const rows: MoneyAccessRow[] = people.map((u, i) => {
    const perms = resolved[i]
    const mode = (name: MoneyPermission): MoneyMode => (denied.has(`${u.id}|${name}`) ? 'deny' : granted.has(`${u.id}|${name}`) ? 'grant' : 'default')
    return {
      id: u.id,
      name: u.full_name ?? '(no name)',
      role: u.role,
      isOwner: isOwnerProfile(u),
      financials: { effective: hasFinancials(perms), mode: mode('reports:financials') },
      moneyRecord: { effective: hasMoneyRecord(perms), mode: mode('money:record') },
    }
  })
  return rows
}

export type SetResult = { ok: true; before: MoneyMode; after: MoneyMode } | { ok: false; status: number; error: string }

export async function setMoneyAccess(
  admin: SupabaseClient,
  actor: { id: string; org_id: string; role: string; is_super_admin?: boolean | null; active?: boolean | null },
  input: { userId: string; permission: MoneyPermission; mode: MoneyMode; reason?: string }
): Promise<SetResult> {
  if (!isOwnerProfile(actor)) return { ok: false, status: 403, error: 'Only an owner can change money access' }
  const { data: target } = await admin.from('users').select('id, org_id, role, is_super_admin, active').eq('id', input.userId).eq('org_id', actor.org_id).maybeSingle()
  if (!target) return { ok: false, status: 404, error: 'Person not found' }
  if (input.mode === 'deny' && isOwnerProfile(target)) return { ok: false, status: 400, error: 'An owner cannot be switched off (no lock-out)' }

  const { data: perm } = await admin.from('permissions').select('id').eq('name', input.permission).maybeSingle()
  if (!perm) return { ok: false, status: 500, error: 'Permission is not set up' }

  const [{ data: den }, { data: gr }] = await Promise.all([
    admin.from('permission_denials').select('id').eq('user_id', input.userId).eq('permission_name', input.permission).maybeSingle(),
    admin.from('user_permissions').select('id').eq('user_id', input.userId).eq('permission_id', perm.id).maybeSingle(),
  ])
  const before: MoneyMode = den ? 'deny' : gr ? 'grant' : 'default'
  if (before === input.mode) return { ok: true, before, after: before }

  // Set the wanted switch FIRST, then clear the other one: a failure part-way never leaves the person less restricted than before.
  if (input.mode === 'deny') {
    const { error } = await admin.from('permission_denials').upsert({ org_id: actor.org_id, user_id: input.userId, permission_name: input.permission, denied_by: actor.id, reason: input.reason?.slice(0, 300) ?? null }, { onConflict: 'user_id,permission_name' })
    if (error) return { ok: false, status: 500, error: 'Could not save' }
    await admin.from('user_permissions').delete().eq('user_id', input.userId).eq('permission_id', perm.id)
  } else if (input.mode === 'grant') {
    const { error } = await admin.from('user_permissions').upsert({ org_id: actor.org_id, user_id: input.userId, permission_id: perm.id, granted_by: actor.id }, { onConflict: 'user_id,permission_id' })
    if (error) return { ok: false, status: 500, error: 'Could not save' }
    await admin.from('permission_denials').delete().eq('user_id', input.userId).eq('permission_name', input.permission)
  } else {
    await admin.from('permission_denials').delete().eq('user_id', input.userId).eq('permission_name', input.permission)
    await admin.from('user_permissions').delete().eq('user_id', input.userId).eq('permission_id', perm.id)
  }
  await admin.from('permission_audit').insert({
    org_id: actor.org_id, actor_user_id: actor.id, target_user_id: input.userId, permission_name: input.permission,
    action: input.mode, before_state: before, after_state: input.mode,
  })
  return { ok: true, before, after: input.mode }
}
