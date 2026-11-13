import { NextResponse } from 'next/server'

import { sendPayLinkText } from '@/lib/customer-messages-db'
import { loadOnlinePayments } from '@/lib/online-payments/accounts'
import { createPaymentLink, tooManyLinks } from '@/lib/online-payments/links'
import { payLinkTextMessage } from '@/lib/pay-link-text'
import { activeCrewDay } from '@/lib/service-plans-access'
import { loadCrewVisit } from '@/lib/service-plans-db'
import { createServiceClient } from '@/lib/supabase/service'
import { oldestOpenInvoice } from '@/lib/visit-collections-db'

export const dynamic = 'force-dynamic'

/**
 * POST { mode: 'text' | 'qr' } — public (the crew's phone link): the pay link for the customer's oldest open invoice at THIS
 * visit. 'text' sends it to the customer from the server (the crew never sees the phone number; consent, opt-out, texting
 * hours and a 3-an-hour cap per invoice apply). 'qr' returns the link itself so the phone can show a QR code for the
 * customer to scan (20 links an hour per invoice). Only a visit of this crew, only today / yesterday.
 */
export async function POST(request: Request, { params }: { params: { token: string; id: string } }) {
  const admin = createServiceClient()
  const crew = await activeCrewDay(admin, params.token)
  if (!crew) return NextResponse.json({ error: 'This link is no longer active — ask the office for a new one.' }, { status: 404 })
  const visit = await loadCrewVisit(admin, crew, params.id)
  if (!visit || !visit.customerId) return NextResponse.json({ error: 'Visit not found' }, { status: 404 })
  const mode = ((await request.json().catch(() => ({}))) as { mode?: unknown }).mode
  if (mode !== 'text' && mode !== 'qr') return NextResponse.json({ error: 'Pick text or QR code' }, { status: 400 })
  if (!(await loadOnlinePayments(admin, crew.orgId)).ready) return NextResponse.json({ error: 'Paying by card isn’t set up yet. Take cash or a check.' }, { status: 409 })
  const invoice = await oldestOpenInvoice(admin, crew.orgId, visit.customerId)
  if (!invoice || invoice.balanceCents <= 0) return NextResponse.json({ error: 'This customer has nothing open to pay.' }, { status: 409 })

  if (mode === 'text') {
    const result = await sendPayLinkText(admin, crew.orgId, { invoiceId: invoice.id, customerId: visit.customerId, createdBy: null })
    return NextResponse.json({ status: result.status, message: payLinkTextMessage(result) }, { status: result.status === 'sent' ? 200 : result.status === 'too_many' ? 429 : 409 })
  }
  if (await tooManyLinks(admin, crew.orgId, { invoiceId: invoice.id })) return NextResponse.json({ error: 'Too many links for this invoice this hour.' }, { status: 429 })
  const link = await createPaymentLink(admin, crew.orgId, { kind: 'invoice', invoiceId: invoice.id }, null)
  // amountCents: what THIS link pays (the oldest open invoice's balance), so the phone never shows a different total.
  return NextResponse.json({ url: link.url, amountCents: invoice.balanceCents })
}
