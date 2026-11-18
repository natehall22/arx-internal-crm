import { NOT_PORTAL_LINK, portalQuoteLink } from '@/lib/quotes/links'
import { takePortalAttempt } from '@/lib/portal/server'
import { loadApproval } from '@/lib/quotes/approve'
import { loadOrgFeatures } from '@/lib/org-features'
import { portalJson, requirePortalApi } from '@/lib/portal/api'
import { orgDb } from '@/lib/supabase/org-db'

export const dynamic = 'force-dynamic'

/**
 * POST — a signed-in customer opens one of THEIR pending quotes from the portal. The emailed link is stored hashed (it can't be
 * shown again), so the portal has its OWN link row (`portalQuoteLink`): reused while live, expiring with the emailed link, never
 * revoking it or touching its "opened" history. Rate limited per customer.
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
  const { data: live } = await db.from('quote_links').select('expires_at').eq('proposal_id', proposal.id).or(NOT_PORTAL_LINK).is('revoked_at', null).gt('expires_at', new Date().toISOString()).order('expires_at', { ascending: false }).limit(1)
  const expiresAt = ((live ?? []) as { expires_at: string }[])[0]?.expires_at
  if (!expiresAt) return portalJson({ error: 'This quote link has expired. Please contact us for a new one.' }, 409)
  if (!(await takePortalAttempt(admin, `portal-open-quote:${orgId}:${session.customerId}`, { limit: 20, windowSeconds: 3600 }))) return portalJson({ error: 'Too many tries. Please wait a little and try again.' }, 429)
  const link = await portalQuoteLink(admin, orgId, proposal.id, expiresAt)
  if (!link) return portalJson({ error: 'We could not open that quote here. Please contact us.' }, 503)
  return portalJson({ url: new URL(link.url).pathname })
}
