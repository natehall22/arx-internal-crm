import { NextResponse } from 'next/server'

import { billingRouteAuth } from '@/lib/service-billing-access'
import { createOneOffInvoice, parseOneOffBody } from '@/lib/one-off-invoice'
import { loadTermsChoice } from '@/lib/payment-terms'
import { loadAddresses, loadCustomerServiceInvoices } from '@/lib/service-billing-db'
import { orgDb } from '@/lib/supabase/org-db'

export const dynamic = 'force-dynamic'

/** GET /api/customers/[id]/invoices — the customer's service invoices (invoices without a job), newest first. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const ctx = await billingRouteAuth()
  if (ctx instanceof Response) return ctx
  const { data: customer } = await orgDb(ctx.admin, ctx.orgId).from('customers').select('id, email').eq('id', params.id).maybeSingle()
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  const invoices = await loadCustomerServiceInvoices(ctx.admin, ctx.orgId, params.id)
  if (!invoices) return NextResponse.json({ invoices: [], ready: false })
  // Which property each invoice is for (a commercial customer has many): property id → address, company-scoped.
  const propertyIds = Array.from(new Set(invoices.map((i) => i.property_id).filter((x): x is string => !!x)))
  const addresses = propertyIds.length ? await loadAddresses(ctx.admin, ctx.orgId, propertyIds) : {}
  return NextResponse.json({ invoices, addresses, ready: true, terms: await loadTermsChoice(ctx.admin, ctx.orgId, params.id), customerEmail: (customer as { email?: string | null }).email ?? null })
}

/**
 * POST /api/customers/[id]/invoices { lines: [{ itemId, optionKey?, qty, priceCents? } | { description, qty, priceCents, taxable? }], propertyId?, publicNote? }
 * — a one-off DRAFT invoice for this customer through createServiceInvoiceFromLines (the one invoice writer). Same gate as the list.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const ctx = await billingRouteAuth()
  if (ctx instanceof Response) return ctx
  const { data: customer } = await orgDb(ctx.admin, ctx.orgId).from('customers').select('id').eq('id', params.id).maybeSingle()
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  const parsed = parseOneOffBody(await request.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  try {
    return NextResponse.json({ invoiceId: (await createOneOffInvoice(ctx.admin, ctx.orgId, ctx.userId, params.id, parsed.value)).invoiceId }, { status: 201 })
  } catch (e) {
    const message = e instanceof Error ? e.message : ''
    // Our own sentences (price book / property); anything else is logged and kept generic.
    if (/price-book item|Pick a size|not offered|not this customer/.test(message)) return NextResponse.json({ error: message }, { status: 400 })
    console.error('customer invoice create failed', e)
    return NextResponse.json({ error: 'Could not make the invoice' }, { status: 500 })
  }
}
