import type { Metadata } from 'next'

import { signingTokenOf } from '@/lib/signing-tokens'
import { orgAppUrl } from '@/lib/company-links'
import { customerSignedDocPath } from '@/lib/files/files-object'
import { loadOrgFeatures } from '@/lib/org-features'
import { depositStateFor, finalizeApproval, loadApproval } from '@/lib/quotes/approve'
import { resolvePublicQuoteLink, touchQuoteLink } from '@/lib/quotes/links'
import { buildQuoteView, companyForQuote, loadQuoteContext, type QuoteView } from '@/lib/quotes/load'
import { orgDb } from '@/lib/supabase/org-db'
import { createServiceClient } from '@/lib/supabase/service'
import QuoteClient from '@/components/quotes/QuoteClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Your quote', robots: { index: false, follow: false }, referrer: 'no-referrer' }

/**
 * The customer's quote page (no login, no Nav, the company's brand only). A bad / expired / revoked token, a link opened on
 * another company's address, or a company with the switch off all look the same: "not active".
 */
export default async function QuotePage({ params }: { params: { token: string } }) {
  const admin = createServiceClient()
  const link = await resolvePublicQuoteLink(admin, params.token)
  if (!link || !(await loadOrgFeatures(admin, link.org_id)).quoteApproval) return <QuoteClient token={params.token} view={null} />
  const orgId = link.org_id
  const ctx = await loadQuoteContext(admin, orgId, link.proposal_id)
  if (!ctx) return <QuoteClient token={params.token} view={null} />
  await touchQuoteLink(admin, link).catch(() => null)
  const p = ctx.proposal
  await orgDb(admin, orgId).from('proposals').update({ viewed_at: new Date().toISOString() }).eq('id', p.id).is('viewed_at', null)

  let approval = await loadApproval(admin, orgId, p.id)
  // An approval that stopped half way is finished the next time anyone opens the page.
  if (approval && !approval.finalized_at) {
    await finalizeApproval(admin, orgId, approval.id, { pageUrl: `${await orgAppUrl(orgId)}/q/${params.token}` })
    approval = await loadApproval(admin, orgId, p.id)
  }
  const company = await companyForQuote(admin, orgId)
  let state: QuoteView['state'] = 'open'
  let approvalView: QuoteView['approval'] = null
  if (approval) {
    state = 'approved'
    let copyHref: string | null = null
    if (approval.contract_id) {
      const { data: c } = await orgDb(admin, orgId).from('order_form_contracts').select('signing_token, signing_token_enc, pdf_url').eq('id', approval.contract_id).maybeSingle()
      const row = c as { signing_token?: string | null; signing_token_enc?: string | null; pdf_url?: string | null } | null
      const copyToken = signingTokenOf(row)
      if (copyToken && row?.pdf_url) copyHref = customerSignedDocPath('contract', copyToken)
    }
    const dep = approval.finalized_at ? await depositStateFor(admin, orgId, approval) : null
    approvalView = {
      typedName: approval.typed_name,
      approvedAt: approval.approved_at,
      totalCents: approval.total_cents,
      depositCents: approval.deposit_cents,
      taxCents: approval.tax_cents,
      chosenNames: approval.snapshot.lines.filter((l) => l.chosen && l.optional).map((l) => l.name),
      depositState: !dep ? 'pending' : dep.state,
      canPayOnline: dep?.canPayOnline ?? false,
      copyHref,
    }
  } else if (p.expires_at && Date.parse(p.expires_at) < Date.now()) state = 'expired'
  else if (!['draft', 'sent', 'viewed'].includes(String(p.status))) state = 'unavailable'
  return <QuoteClient token={params.token} view={buildQuoteView({ ctx, state, company, approval: approvalView })} />
}
