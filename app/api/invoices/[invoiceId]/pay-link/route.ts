import { NextResponse } from 'next/server'

import { emailInvoicePayLink } from '@/lib/invoice-email'
import { finalizeAndSendInvoice, findOrgInvoice } from '@/lib/invoices'
import { orgDb } from '@/lib/supabase/org-db'
import type { JobInvoice } from '@/lib/types/invoices'
import { requireOnlinePaymentsCaller } from '@/lib/online-payments/access'
import { loadOnlinePayments } from '@/lib/online-payments/accounts'
import { payableCents } from '@/lib/online-payments/checkout'
import { createPaymentLink } from '@/lib/online-payments/links'

export const dynamic = 'force-dynamic'

/**
 * POST { email?: boolean, to?: string } — a customer pay link for this invoice (deposit, job or service invoice). Billing
 * staff. A draft JOB invoice is issued first (a link to an unissued invoice would show nothing to pay). Returns { url }
 * to copy / text; with email: true it is also emailed with the invoice.
 */
export async function POST(request: Request, { params }: { params: { invoiceId: string } }) {
  const a = await requireOnlinePaymentsCaller('billing')
  if (a.error) return a.error
  const orgId = a.profile.org_id
  const op = await loadOnlinePayments(a.admin, orgId)
  if (!op.featureOn) return NextResponse.json({ error: 'Online payments are off for this company' }, { status: 404 })
  if (!op.ready) return NextResponse.json({ error: 'Connect your Stripe account first (Settings → Online payments)' }, { status: 409 })
  const found = await findOrgInvoice(a.admin, params.invoiceId, orgId)
  if (!found) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (found.status === 'void') return NextResponse.json({ error: 'This invoice is void' }, { status: 409 })
  const pay = await payableCents(a.admin, orgId, found.id)
  if (pay.balanceCents <= 0) return NextResponse.json({ error: 'This invoice is already paid' }, { status: 409 })
  const body = (await request.json().catch(() => ({}))) as { email?: unknown; to?: unknown }
  const to = typeof body.to === 'string' && body.to.trim() ? body.to.trim() : null

  const load = async () => {
    const { data } = await orgDb(a.admin, orgId).from('job_invoices').select('*').eq('id', found.id).maybeSingle()
    return data as JobInvoice | null
  }
  let invoice = await load()
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (invoice.status === 'draft' && invoice.job_id) {
    try {
      invoice = await finalizeAndSendInvoice(a.admin, invoice.id, to ?? '')
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 })
    }
  }
  const link = await createPaymentLink(a.admin, orgId, { kind: 'invoice', invoiceId: invoice.id }, a.profile.id)
  if (body.email === true) {
    const sent = await emailInvoicePayLink(a.admin, orgId, invoice, link.url, to)
    if (!sent.ok) return NextResponse.json({ error: sent.error, url: link.url }, { status: sent.status })
    return NextResponse.json({ url: link.url, emailedTo: sent.to })
  }
  return NextResponse.json({ url: link.url })
}
