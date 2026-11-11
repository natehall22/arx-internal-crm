import { loadOnlinePayments } from '@/lib/online-payments/accounts'
import { payableCents } from '@/lib/online-payments/checkout'
import { createPaymentLink, tooManyLinks } from '@/lib/online-payments/links'
import { portalJson, requirePortalApi } from '@/lib/portal/api'
import { findPortalInvoice } from '@/lib/portal/data'
import { PORTAL_LIMITS, takePortalAttempt } from '@/lib/portal/server'

export const dynamic = 'force-dynamic'

/**
 * POST — "Pay" on one of the customer's own invoices. Hands back the company's existing pay page (/pay/<token>) for it,
 * which does the Stripe checkout — no second payment path. An invoice that is not this customer's is "not found".
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const c = await requirePortalApi(request)
  if (c instanceof Response) return c
  const { admin, session } = c
  const inv = await findPortalInvoice(admin, session, params.id)
  if (!inv) return portalJson({ error: 'Not found' }, 404)
  const op = await loadOnlinePayments(admin, session.orgId)
  if (!op.featureOn || !op.ready) return portalJson({ error: 'Paying online is not available right now. Please contact us to pay.' }, 409)
  const pay = await payableCents(admin, session.orgId, inv.id)
  if (pay.balanceCents <= 0) return portalJson({ error: 'This invoice is already paid.' }, 409)
  if (pay.payableCents <= 0) return portalJson({ error: 'A bank payment for this invoice is already on its way.' }, 409)
  if (!(await takePortalAttempt(admin, `paylink:${session.customerId}`, PORTAL_LIMITS.payLinksPerCustomer)) || (await tooManyLinks(admin, session.orgId, { invoiceId: inv.id }))) {
    return portalJson({ error: 'Too many tries. Please wait a few minutes.' }, 429)
  }
  const link = await createPaymentLink(admin, session.orgId, { kind: 'invoice', invoiceId: inv.id }, null)
  return portalJson({ url: link.url })
}
