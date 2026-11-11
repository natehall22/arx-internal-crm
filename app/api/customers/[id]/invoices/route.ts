import { NextResponse } from 'next/server'

import { billingRouteAuth } from '@/lib/service-billing-access'
import { loadCustomerServiceInvoices } from '@/lib/service-billing-db'
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
  return NextResponse.json({ invoices, ready: true, customerEmail: (customer as { email?: string | null }).email ?? null })
}
