/**
 * Setters and canvassers may see a homeowner's contact details only for their OWN work (rule: lib/contact-scope.ts, SQL
 * arx_private.lead_mine). The connector applies the same rule to customers: a scoped person finds and reads only
 * customers that have a lead of theirs, so a connected AI app cannot be used to pull everyone's phone and email.
 * (The app's own screens still do not apply this to customer records: Known Redundancy in CLAUDE.md.)
 */
import { isContactScoped, myLeadIds } from '@/lib/contact-scope'
import { orgDb } from '@/lib/supabase/org-db'
import type { ToolContext } from '@/lib/ai-connector/tools/types'

/** null = this person is not contact-scoped (no limit). Otherwise the subset of `customerIds` that are their own work. */
export async function ownCustomerIds(ctx: ToolContext, customerIds: string[]): Promise<Set<string> | null> {
  if (!(await isContactScoped(ctx.admin, ctx.profile))) return null
  const ids = Array.from(new Set(customerIds.filter(Boolean)))
  if (ids.length === 0) return new Set()
  const { data } = await orgDb(ctx.admin, ctx.orgId).from('leads').select('id, customer_id').in('customer_id', ids).limit(2000)
  const leads = (data ?? []) as Array<{ id: string; customer_id: string | null }>
  const mine = await myLeadIds(ctx.admin, ctx.userId, leads.map((l) => l.id))
  return new Set(leads.filter((l) => mine.has(l.id) && l.customer_id).map((l) => l.customer_id as string))
}
