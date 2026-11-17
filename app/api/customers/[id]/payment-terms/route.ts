import { NextResponse } from 'next/server'

import { billingRouteAuth } from '@/lib/service-billing-access'
import { isMissingColumn } from '@/lib/supabase/errors'
import { orgDb } from '@/lib/supabase/org-db'
import { parsePaymentTerms } from '@/lib/payment-terms'

export const dynamic = 'force-dynamic'

/** PATCH { terms: 'due_on_receipt' | 'net_15' | 'net_30' | null } — a customer's own payment terms (null = the company default). Same gate as the invoice list (service plans on, money:record). Invoices already issued keep their due day. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const ctx = await billingRouteAuth() // same gate as the customer's invoice routes: service plans on + money:record
  if (ctx instanceof Response) return ctx
  const body = (await request.json().catch(() => null)) as { terms?: unknown } | null
  if (!body || !('terms' in body)) return NextResponse.json({ error: 'Pick the terms' }, { status: 400 })
  const terms = body.terms === null || body.terms === '' ? null : parsePaymentTerms(body.terms)
  if (body.terms !== null && body.terms !== '' && !terms) return NextResponse.json({ error: 'Pick Due on receipt, Net 15 or Net 30' }, { status: 400 })
  const { data, error } = await orgDb(ctx.admin, ctx.orgId).from('customers').update({ payment_terms: terms }).eq('id', params.id).select('id').maybeSingle()
  if (error) {
    if (isMissingColumn(error, 'payment_terms')) return NextResponse.json({ error: 'Payment terms need a database update first (migration 202611300050).' }, { status: 409 })
    return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  return NextResponse.json({ ok: true, terms })
}
