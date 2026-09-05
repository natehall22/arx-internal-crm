import type { SupabaseClient } from '@supabase/supabase-js'

type MaybeString = string | null | undefined

function normalizeLabel(value: MaybeString): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function isFinanceAdminLabel(value: MaybeString): boolean {
  const normalized = normalizeLabel(value)
  return normalized === 'finance_admin'
}

export function canAccessJobBilling(args: {
  role?: MaybeString
  customRoleName?: MaybeString
  customRoleDisplayName?: MaybeString
}): boolean {
  const role = normalizeLabel(args.role)
  if (
    role === 'owner' ||
    role === 'finance_admin' ||
    role === 'admin' ||
    role === 'operations' ||
    /** Same jobs/ops surface as Nav ops links — can record deposits and view job payments */
    role === 'regional_manager' ||
    role === 'manager'
  ) {
    return true
  }

  return (
    isFinanceAdminLabel(args.customRoleName) ||
    isFinanceAdminLabel(args.customRoleDisplayName)
  )
}

/**
 * Job-billing gate for a caller resolved by `requireAuthApi()`.
 *
 * `canAccessJobBilling` also honours a *custom* role named `finance_admin`, which lives
 * on `custom_roles`, not on `users`. Six API routes each hand-rolled the same
 * `custom_role:custom_roles(name, display_name)` join plus the array/object unwrap that
 * PostgREST embedding requires; this is the single home for it.
 *
 * Only queries `custom_roles` when the caller actually has one — a built-in role that
 * already passes short-circuits without the extra round trip.
 */
export async function callerCanAccessJobBilling(
  admin: SupabaseClient,
  profile: { role?: MaybeString; custom_role_id?: string | null }
): Promise<boolean> {
  if (canAccessJobBilling({ role: profile.role })) return true
  if (!profile.custom_role_id) return false

  const { data: customRole } = await admin
    .from('custom_roles')
    .select('name, display_name')
    .eq('id', profile.custom_role_id)
    .maybeSingle()

  return canAccessJobBilling({
    role: profile.role,
    customRoleName: customRole?.name,
    customRoleDisplayName: customRole?.display_name,
  })
}
