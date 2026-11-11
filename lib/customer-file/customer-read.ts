/**
 * Who may read ONE customer record, and the read itself (GET /api/customers/[id] and the AI connector's get_customer ask here):
 * customer-records access, then — for rep-like roles — only customers they own a project or deal for. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { canAccessCustomerRecordsFromPermissionNames, isRepLikeCustomerRecordRole } from '@/lib/permissions'

type Caller = { id: string; org_id: string; role: string; custom_role_id?: string | null }

export async function loadCustomerForCaller(
  admin: SupabaseClient,
  profile: Caller,
  customerId: string
): Promise<{ ok: true; customer: Record<string, unknown> } | { ok: false; status: 403 | 404 }> {
  const perms = await resolveEffectivePermissionNames(admin, profile.id, profile)
  if (!canAccessCustomerRecordsFromPermissionNames(perms)) return { ok: false, status: 403 }

  const { data: customer, error } = await admin.from('customers').select('*').eq('id', customerId).eq('org_id', profile.org_id).single()
  if (error || !customer) return { ok: false, status: 404 }

  if (isRepLikeCustomerRecordRole(profile.role)) {
    const [{ data: ownedProjects }, { data: ownedOpportunities }] = await Promise.all([
      admin.from('projects').select('id').eq('org_id', profile.org_id).eq('customer_id', customerId).eq('owner_user_id', profile.id).limit(1),
      admin.from('opportunities').select('id').eq('org_id', profile.org_id).eq('customer_id', customerId).eq('owner_user_id', profile.id).limit(1),
    ])
    if ((ownedProjects || []).length === 0 && (ownedOpportunities || []).length === 0) return { ok: false, status: 403 }
  }
  return { ok: true, customer: customer as Record<string, unknown> }
}
