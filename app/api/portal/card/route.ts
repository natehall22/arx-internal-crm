import { loadOnlinePayments } from '@/lib/online-payments/accounts'
import { removeCardOnFile, setAutopayOff } from '@/lib/online-payments/cards'
import { createPaymentLink, tooManyLinks } from '@/lib/online-payments/links'
import { portalJson, requirePortalApi } from '@/lib/portal/api'

export const dynamic = 'force-dynamic'

/**
 * POST { action: 'autopay_off' | 'remove' | 'save' } — the customer's saved card. Turning autopay ON is only ever done on
 * Stripe's own page with the customer's consent words ('save' hands back that page's link — the existing save-card page).
 * Emailed-link sessions only (a forwarded pay link must never reach a card).
 */
export async function POST(request: Request) {
  const c = await requirePortalApi(request)
  if (c instanceof Response) return c
  const { admin, session } = c
  const body = (await request.json().catch(() => ({}))) as { action?: unknown }
  const op = await loadOnlinePayments(admin, session.orgId)
  if (!op.featureOn) return portalJson({ error: 'Not found' }, 404)
  if (body.action === 'autopay_off') return (await setAutopayOff(admin, session.orgId, session.customerId)) ? portalJson({ ok: true }) : portalJson({ error: 'No card on file.' }, 404)
  if (body.action === 'remove') return (await removeCardOnFile(admin, session.orgId, session.customerId, null)) ? portalJson({ ok: true }) : portalJson({ error: 'No card on file.' }, 404)
  if (body.action === 'save') {
    if (!op.ready || !op.settings.autopay) return portalJson({ error: 'Automatic payments are not available right now.' }, 409)
    if (await tooManyLinks(admin, session.orgId, { customerId: session.customerId })) return portalJson({ error: 'Too many tries. Please wait a few minutes.' }, 429)
    const link = await createPaymentLink(admin, session.orgId, { kind: 'save_card', customerId: session.customerId }, null)
    return portalJson({ url: link.url })
  }
  return portalJson({ error: 'Unknown action' }, 400)
}
