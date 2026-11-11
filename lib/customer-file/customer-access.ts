/**
 * Who may see / change a CUSTOMER's own records (properties, customer-level documents, customer custom fields) — the
 * customer-level twin of the deal rule `canOpenDeal` (lib/threads/api.ts), built on the same ThreadViewer:
 *   - read: company-wide viewers (owner/admin, job board, managers) always; everyone else (closers, setters, inside sales)
 *     only when they can open at least one of this customer's deals — the same people who can open the Customer File;
 *   - edit properties / customer fields: anyone who can read, except field roles (setters, canvassers, inside sales);
 *   - gate / access notes: hidden from field roles;
 *   - documents (contracts and the like): not for pricing-barred roles — the same rule as the Files tab (tabsFor).
 * Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { dealRefsFor } from '@/lib/threads/get-thread'
import { canOpenDeal } from '@/lib/threads/api'
import { isFieldRole, type ThreadViewer } from '@/lib/threads/visibility'
import { orgDb } from '@/lib/supabase/org-db'

export type CustomerAccess = {
  customerId: string
  read: boolean
  edit: boolean
  accessNotes: boolean
  documents: boolean
  /** May upload / file documents (read documents + not a field role). */
  editDocuments: boolean
}

/** Pure part (tested): what a viewer may do, given whether they can open any deal of the customer. */
export function customerAccessFor(v: ThreadViewer, canOpenAnyDeal: boolean): Omit<CustomerAccess, 'customerId'> {
  const companyWide = v.ownerLike || v.jobBoard || v.managerLike
  const read = companyWide || canOpenAnyDeal
  const field = isFieldRole(v)
  return {
    read,
    edit: read && !field,
    accessNotes: read && !field,
    documents: read && !v.pricingBarred,
    editDocuments: read && !v.pricingBarred && !field,
  }
}

/** null = no such customer in the viewer's company (callers answer 404, never 403, so existence is not leaked). */
export async function resolveCustomerAccess(admin: SupabaseClient, viewer: ThreadViewer, customerId: string): Promise<CustomerAccess | null> {
  if (typeof customerId !== 'string' || !customerId) return null
  const db = orgDb(admin, viewer.orgId)
  const { data: customer } = await db.from('customers').select('id').eq('id', customerId).maybeSingle()
  if (!customer) return null
  let canOpenAnyDeal = false
  if (!(viewer.ownerLike || viewer.jobBoard || viewer.managerLike)) {
    const { data: deals } = await db.from('opportunities').select('id, owner_user_id, setter_user_id').eq('customer_id', customerId)
    const rows = (deals ?? []) as Array<{ id: string; owner_user_id: string | null; setter_user_id: string | null }>
    const refs = await dealRefsFor(admin, viewer.orgId, rows.map((d) => d.id))
    canOpenAnyDeal = rows.some((d) => canOpenDeal(viewer, refs.get(d.id) ?? d))
  }
  return { customerId, ...customerAccessFor(viewer, canOpenAnyDeal) }
}
