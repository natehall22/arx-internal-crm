import type { SupabaseClient } from '@supabase/supabase-js'
import { pickValidEmail } from '@/lib/email-address'

export type TransactionalEmailUser = {
  id: string
  full_name: string | null
  email: string | null
  active: boolean
  /** Resolved delivery address: auth.users.email, then public.users.email */
  resolvedEmail: string | null
}

/**
 * Bulk-load rep rows for payroll/CRM email. Auth email is authoritative when present;
 * public.users.email is fallback (see admin user PATCH for sync on admin-driven changes).
 */
export async function loadUsersForTransactionalEmail(
  supabase: SupabaseClient,
  orgId: string,
  userIds: string[]
): Promise<Map<string, TransactionalEmailUser>> {
  const out = new Map<string, TransactionalEmailUser>()
  if (!userIds.length) return out

  const { data: rows, error } = await supabase
    .from('users')
    .select('id, full_name, email, active')
    .eq('org_id', orgId)
    .in('id', userIds)

  if (error) {
    throw new Error('Failed to load users for transactional email')
  }

  const authEmailById = await fetchAuthEmailsByUserId(supabase, userIds)

  for (const row of rows || []) {
    const id = row.id as string
    const authEmail = authEmailById.get(id) ?? null
    const publicEmail = (row.email as string | null) ?? null
    out.set(id, {
      id,
      full_name: (row.full_name as string | null) ?? null,
      email: publicEmail,
      active: row.active !== false,
      resolvedEmail: pickValidEmail(authEmail, publicEmail),
    })
  }

  return out
}

async function fetchAuthEmailsByUserId(
  supabase: SupabaseClient,
  userIds: string[]
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  await Promise.all(
    userIds.map(async (id) => {
      try {
        const { data, error } = await supabase.auth.admin.getUserById(id)
        if (error || !data?.user) {
          map.set(id, null)
          return
        }
        map.set(id, data.user.email ?? null)
      } catch {
        map.set(id, null)
      }
    })
  )
  return map
}
