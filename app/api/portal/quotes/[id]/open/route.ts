import { createQuoteLink } from '@/lib/quotes/links'
import { readQuoteApprovalSettings } from '@/lib/quotes/settings'
import { loadApproval } from '@/lib/quotes/approve'
import { loadOrgFeatures } from '@/lib/org-features'
import { portalJson, requirePortalApi } from '@/lib/portal/api'
import { orgDb } from '@/lib/supabase/org-db'

export const dynamic = 'force-dynamic'

/**
 * POST — a signed-in customer opens one of THEIR pending quotes from the portal. The quote link is stored hashed (it can't be
 * shown again), so this makes a fresh one (the older link stops working, as with any resend) and returns its address.
 * The quote must belong to this customer's deals, still be open (sent / viewed, not approved) and have a live link out.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const c = await requirePortalApi(request)
  if (c instanceof Response) return c
  const { admin, session } = c
  const orgId = session.orgId
  if (!(await loadOrgFeatures(admin, orgId)).quoteApproval) return portalJson({ error: 'Not found' }, 404)
  const db = orgDb(admin, orgId)
  const { data: p } = await db.from('proposals').select('id, status, opportunity_id').eq('id', params.id).maybeSingle()
  const proposal = p as { id: string; status: string; opportunity_id: string | null } | null
  if (!proposal || !proposal.opportunity_id || !['sent', 'viewed'].includes(proposal.status)) return portalJson({ error: 'Not found' }, 404)
  const { data: o } = await db.from('opportunities').select('customer_id').eq('id', proposal.opportunity_id).maybeSingle()
  if ((o as { customer_id?: string | null } | null)?.customer_id !== session.customerId) return portalJson({ error: 'Not found' }, 404)
  if (await loadApproval(admin, orgId, proposal.id)) return portalJson({ error: 'This quote is already approved.' }, 409)
  const { data: live } = await db.from('quote_links').select('id').eq('proposal_id', proposal.id).is('revoked_at', null).gt('expires_at', new Date().toISOString()).limit(1)
  if (((live ?? []) as unknown[]).length === 0) return portalJson({ error: 'This quote link has expired. Please contact us for a new one.' }, 409)
  const { data: org } = await admin.from('orgs').select('settings').eq('id', orgId).maybeSingle()
  const link = await createQuoteLink(admin, orgId, proposal.id, null, readQuoteApprovalSettings((org as { settings?: unknown } | null)?.settings).linkDays)
  return portalJson({ url: new URL(link.url).pathname })
}
