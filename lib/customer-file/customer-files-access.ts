import type { SupabaseClient } from '@supabase/supabase-js'

import { isUuid } from '@/lib/customer-file/customer-files'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { canAccessCustomerRecordsFromPermissionNames, isRepLikeCustomerRecordRole } from '@/lib/permissions'
import { resolveFieldOrSalesDocBarred } from '@/lib/sales-doc-access'
import type { User } from '@/lib/types/database'

export type CustomerFileUploadAccess = { ok: true } | { ok: false; status: 403 | 404; error: string }

/**
 * Who may add files to a customer: the same people who can open that customer's page and its Files tab
 * (`customers:view`/`customers:edit` or full access; reps/closers only for customers they own a project for — the page 404s
 * otherwise), minus field roles and anyone barred from sales docs, who can never read these files back
 * (GET /api/files/object). Not allowed and not found both answer 404 for the customer, so the route never confirms one exists.
 */
export async function customerFileUploadAccess(admin: SupabaseClient, profile: User, customerId: string): Promise<CustomerFileUploadAccess> {
  const notFound: CustomerFileUploadAccess = { ok: false, status: 404, error: 'Customer not found' }
  if (!profile.org_id || !isUuid(customerId)) return notFound

  const perms = await resolveEffectivePermissionNames(admin, profile.id, profile)
  if (!canAccessCustomerRecordsFromPermissionNames(perms)) return notFound

  const { data: customer } = await admin.from('customers').select('id').eq('id', customerId).eq('org_id', profile.org_id).maybeSingle()
  if (!customer) return notFound

  if (isRepLikeCustomerRecordRole(profile.role)) {
    const { data: own } = await admin
      .from('projects')
      .select('id')
      .eq('customer_id', customerId)
      .eq('org_id', profile.org_id)
      .eq('owner_user_id', profile.id)
      .limit(1)
    if ((own?.length ?? 0) === 0) return notFound
  }

  if (await resolveFieldOrSalesDocBarred(admin, profile)) {
    return { ok: false, status: 403, error: 'Your role cannot add customer files' }
  }
  return { ok: true }
}
