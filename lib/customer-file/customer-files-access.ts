import type { SupabaseClient } from '@supabase/supabase-js'

import type { CustomerFileRow } from '@/lib/customer-file/customer-files'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { canAccessCustomerRecordsFromPermissionNames, isRepLikeCustomerRecordRole } from '@/lib/permissions'
import { resolveFieldOrSalesDocBarred } from '@/lib/sales-doc-access'
import { isUuid } from '@/lib/uuid'

export type CustomerFileUploadAccess = { ok: true } | { ok: false; status: 404; error: string }

type UploadProfile = { id: string; org_id: string; role: string; custom_role_id?: string | null }

/**
 * Who may add files to a customer: the same people who can open that customer's account page and its Files tab
 * (`customers:view`/`customers:edit` or full access; reps/closers only for customers they own a project for — the page 404s
 * otherwise), never field roles or anyone barred from sales docs (they can't read these files back through
 * GET /api/files/object either). Every "no" is a 404 and the role checks run before any customer lookup, so the answer never
 * says whether a customer exists.
 */
export async function customerFileUploadAccess(admin: SupabaseClient, profile: UploadProfile, customerId: string): Promise<CustomerFileUploadAccess> {
  const no: CustomerFileUploadAccess = { ok: false, status: 404, error: 'Customer not found' }
  if (!profile.org_id || !isUuid(customerId)) return no

  if (await resolveFieldOrSalesDocBarred(admin, profile)) return no
  const perms = await resolveEffectivePermissionNames(admin, profile.id, profile)
  if (!canAccessCustomerRecordsFromPermissionNames(perms)) return no

  const { data: customer } = await admin.from('customers').select('id').eq('id', customerId).eq('org_id', profile.org_id).maybeSingle()
  if (!customer) return no

  if (isRepLikeCustomerRecordRole(profile.role)) {
    const { data: own } = await admin
      .from('projects')
      .select('id')
      .eq('customer_id', customerId)
      .eq('org_id', profile.org_id)
      .eq('owner_user_id', profile.id)
      .limit(1)
    if ((own?.length ?? 0) === 0) return no
  }
  return { ok: true }
}

/**
 * THE customer file list, for both customer pages (`/customers/[id]?tab=files` and the Customer File's Files tab), newest first:
 *  - customer-level files: `customer_id` = this customer AND attached to nothing else (no deal, project, lead or job). A row
 *    with `customer_id` plus a deal/project/lead/job — e.g. a signed contract — belongs to that record, so it is NOT let in by
 *    its customer_id; otherwise a closer would see the contract on another closer's deal for the same customer.
 *  - files on the given projects / deals / leads. Callers pass only the records the viewer may see (the account page its
 *    rep-scoped projects and deals; the Customer File the deals the viewer can open and their projects and leads).
 */
export async function loadCustomerFiles(
  client: SupabaseClient,
  args: { orgId: string; customerId: string; projectIds?: string[]; opportunityIds?: string[]; leadIds?: string[] }
): Promise<CustomerFileRow[]> {
  if (!isUuid(args.customerId) || !args.orgId) return []
  const ids = (xs?: Array<string | null | undefined>) => Array.from(new Set((xs ?? []).filter((x): x is string => isUuid(x))))
  const projectIds = ids(args.projectIds)
  const opportunityIds = ids(args.opportunityIds)
  const leadIds = ids(args.leadIds)
  const filters = [
    `and(customer_id.eq.${args.customerId},opportunity_id.is.null,project_id.is.null,lead_id.is.null,job_id.is.null)`,
    projectIds.length > 0 ? `project_id.in.(${projectIds.join(',')})` : null,
    opportunityIds.length > 0 ? `opportunity_id.in.(${opportunityIds.join(',')})` : null,
    leadIds.length > 0 ? `lead_id.in.(${leadIds.join(',')})` : null,
  ].filter(Boolean)
  const { data } = await client
    .from('files')
    .select('id, file_name, tag, storage_path, created_at')
    .eq('org_id', args.orgId)
    .or(filters.join(','))
    .order('created_at', { ascending: false })
  return (data ?? []) as CustomerFileRow[]
}

/**
 * The Customer File's list: customer-level files plus files on the given deals (already filtered to the ones the viewer can
 * open) and on those deals' projects and leads — the same scope the account page builds from its own project/deal/lead lists.
 */
export async function loadCustomerFilesForDeals(
  admin: SupabaseClient,
  orgId: string,
  customerId: string,
  dealIds: string[]
): Promise<CustomerFileRow[]> {
  const deals = dealIds.filter((id) => isUuid(id))
  if (!isUuid(customerId) || !orgId) return []
  let projectIds: string[] = []
  let leadIds: string[] = []
  if (deals.length > 0) {
    const [projects, opps] = await Promise.all([
      admin.from('projects').select('id').eq('org_id', orgId).in('opportunity_id', deals),
      admin.from('opportunities').select('lead_id').eq('org_id', orgId).eq('customer_id', customerId).in('id', deals),
    ])
    projectIds = ((projects.data ?? []) as Array<{ id: string }>).map((p) => p.id)
    leadIds = ((opps.data ?? []) as Array<{ lead_id: string | null }>).map((o) => o.lead_id).filter((x): x is string => !!x)
  }
  return loadCustomerFiles(admin, { orgId, customerId, opportunityIds: deals, projectIds, leadIds })
}
