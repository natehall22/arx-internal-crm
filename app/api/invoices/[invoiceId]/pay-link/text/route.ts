import { NextResponse } from 'next/server'

import { sendPayLinkText } from '@/lib/customer-messages-db'
import { findOrgInvoice } from '@/lib/invoices'
import { loadOnlinePayments } from '@/lib/online-payments/accounts'
import { requireOnlinePaymentsCaller } from '@/lib/online-payments/access'
import { invoiceCustomerId, payableCents } from '@/lib/online-payments/checkout'
import { payLinkTextMessage } from '@/lib/pay-link-text'

export const dynamic = 'force-dynamic'

/**
 * POST — text the customer a pay link for this invoice (billing staff). The same helper the crew page uses
 * (lib/customer-messages-db.ts sendPayLinkText): consent, opt-out, texting hours and caps apply. Never returns the link or
 * the phone number; when the text cannot go, the answer says why in plain words and staff use Copy / Email.
 */
export async function POST(request: Request, { params }: { params: { invoiceId: string } }) {
  const a = await requireOnlinePaymentsCaller('billing', request)
  if (a.error) return a.error
  const orgId = a.profile.org_id
  const op = await loadOnlinePayments(a.admin, orgId)
  if (!op.featureOn) return NextResponse.json({ error: 'Online payments are off for this company' }, { status: 404 })
  if (!op.ready) return NextResponse.json({ error: 'Connect your Stripe account first (Settings → Online payments)' }, { status: 409 })
  const found = await findOrgInvoice(a.admin, params.invoiceId, orgId)
  if (!found) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (found.status === 'void') return NextResponse.json({ error: 'This invoice is void' }, { status: 409 })
  if (found.status === 'draft') return NextResponse.json({ error: 'Send the invoice first, then text the pay link.' }, { status: 409 })
  if ((await payableCents(a.admin, orgId, found.id)).balanceCents <= 0) return NextResponse.json({ error: 'This invoice is already paid' }, { status: 409 })
  const customerId = await invoiceCustomerId(a.admin, orgId, found)
  if (!customerId) return NextResponse.json({ error: 'This invoice has no customer to text.' }, { status: 409 })
  const result = await sendPayLinkText(a.admin, orgId, { invoiceId: found.id, customerId, createdBy: a.profile.id })
  const message = payLinkTextMessage(result)
  return NextResponse.json({ status: result.status, message }, { status: result.status === 'sent' ? 200 : result.status === 'too_many' ? 429 : 409 })
}
