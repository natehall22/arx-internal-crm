import type { SupabaseClient } from '@supabase/supabase-js'

import type { CustomerFileRow } from '@/lib/customer-file/customer-files'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { canAccessCustomerRecordsFromPermissionNames, isRepLikeCustomerRecordRole } from '@/lib/permissions'
import { resolveFieldOrSalesDocBarred } from '@/lib/sales-doc-access'
import { canOpenDeal } from '@/lib/threads/api'
import { dealRefsFor } from '@/lib/threads/get-thread'
import type { ThreadViewer } from '@/lib/threads/visibility'
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
export async function customerFileUploadAccess(
  admin: SupabaseClient,
  profile: UploadProfile,
  customerId: string,
  /** Pass what the caller already resolved (isFieldRole(viewer), the page's permission set) to skip resolving it again. */
  precomputed: { barred?: boolean; permissions?: { fullAccess: boolean; permissionNames: Set<string> } } = {}
): Promise<CustomerFileUploadAccess> {
  const no: CustomerFileUploadAccess = { ok: false, status: 404, error: 'Customer not found' }
  if (!profile.org_id || !isUuid(customerId)) return no

  if (precomputed.barred ?? (await resolveFieldOrSalesDocBarred(admin, profile))) return no
  const perms = precomputed.permissions ?? (await resolveEffectivePermissionNames(admin, profile.id, profile))
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
 *  - files on the given projects / deals / leads. Callers pass only records the viewer may see; both pages go through
 *    loadCustomerFilesForViewer, which decides that once.
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
 * THE scope of the customer file list for one viewer — used by BOTH customer pages, so they always list the same files:
 *  - customer-level files (see loadCustomerFiles);
 *  - files on every deal of this customer the viewer can open (`canOpenDeal`: owner / setter / appointment closer for reps,
 *    everything for owners, ops and managers), and on those deals' projects and leads;
 *  - `extraProjectIds`: projects the caller already shows the viewer (the account page's rep-scoped project list; a project
 *    can exist without a deal) and their leads;
 *  - leads attached to the customer with no deal, only for viewers who can open every deal (owner / ops / manager) — a rep
 *    never gets another rep's lead this way.
 * Pass `openableDealIds` when the caller already has them (the Customer File's `ctx.deals`) to skip the deal lookup.
 *
 * The two pages list the same files except one case: the account page also passes its own rep-scoped projects
 * (`extraProjectIds`), so a project the rep owns that has NO deal shows there and not on the Customer File (which is opened
 * through a deal). Leads on the customer with no deal show on both pages only for owners, ops and managers.
 */
export async function loadCustomerFilesForViewer(
  admin: SupabaseClient,
  viewer: ThreadViewer,
  customerId: string,
  opts: { openableDealIds?: string[]; extraProjectIds?: string[] } = {}
): Promise<CustomerFileRow[]> {
  const orgId = viewer.orgId
  if (!isUuid(customerId) || !orgId) return []

  let dealIds = opts.openableDealIds
  if (!dealIds) {
    const { data: opps } = await admin.from('opportunities').select('id, owner_user_id, setter_user_id').eq('org_id', orgId).eq('customer_id', customerId)
    const rows = (opps ?? []) as Array<{ id: string; owner_user_id: string | null; setter_user_id: string | null }>
    const refs = await dealRefsFor(admin, orgId, rows.map((o) => o.id))
    dealIds = rows.filter((o) => canOpenDeal(viewer, refs.get(o.id) ?? o)).map((o) => o.id)
  }
  const deals = dealIds.filter((id) => isUuid(id))
  const extraProjects = (opts.extraProjectIds ?? []).filter((id) => isUuid(id))
  const broad = viewer.ownerLike || viewer.jobBoard || viewer.managerLike

  const [dealProjects, dealOpps, extraProjectRows, looseLeads] = await Promise.all([
    deals.length > 0 ? admin.from('projects').select('id, lead_id').eq('org_id', orgId).in('opportunity_id', deals) : Promise.resolve({ data: [] }),
    deals.length > 0 ? admin.from('opportunities').select('lead_id').eq('org_id', orgId).eq('customer_id', customerId).in('id', deals) : Promise.resolve({ data: [] }),
    extraProjects.length > 0 ? admin.from('projects').select('id, lead_id').eq('org_id', orgId).in('id', extraProjects) : Promise.resolve({ data: [] }),
    broad ? admin.from('leads').select('id').eq('org_id', orgId).eq('customer_id', customerId) : Promise.resolve({ data: [] }),
  ])
  const projects = [...((dealProjects.data ?? []) as Array<{ id: string; lead_id: string | null }>), ...((extraProjectRows.data ?? []) as Array<{ id: string; lead_id: string | null }>)]
  const leadIds = [
    ...((dealOpps.data ?? []) as Array<{ lead_id: string | null }>).map((o) => o.lead_id),
    ...projects.map((p) => p.lead_id),
    ...((looseLeads.data ?? []) as Array<{ id: string }>).map((l) => l.id),
  ].filter((x): x is string => !!x)

  return loadCustomerFiles(admin, { orgId, customerId, opportunityIds: deals, projectIds: projects.map((p) => p.id), leadIds })
}
