import { NextResponse } from 'next/server'

import { billingRouteAuth } from '@/lib/service-billing-access'
import { loadCustomerCatalog } from '@/lib/one-off-invoice'
import { defaultTaxRates } from '@/lib/sales-tax'
import { loadOrgSalesTax } from '@/lib/sales-tax-server'
import { orgDb } from '@/lib/supabase/org-db'

export const dynamic = 'force-dynamic'

/** GET /api/customers/[id]/invoices/new — what the New invoice sheet offers: this customer's price-book items, their properties, whether sales tax is on. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const ctx = await billingRouteAuth()
  if (ctx instanceof Response) return ctx
  const db = orgDb(ctx.admin, ctx.orgId)
  const { data: customer } = await db.from('customers').select('id').eq('id', params.id).maybeSingle()
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  const [items, props, tax] = await Promise.all([
    loadCustomerCatalog(ctx.admin, ctx.orgId, params.id),
    db.from('properties').select('id, address_text').eq('customer_id', params.id).order('address_text').limit(100),
    loadOrgSalesTax(ctx.admin, ctx.orgId),
  ])
  const properties = ((props.data ?? []) as Array<{ id: string; address_text: string | null }>).map((p) => ({ id: p.id, address: p.address_text ?? 'Property' }))
  return NextResponse.json({ items, properties, salesTaxOn: !!tax?.enabled && defaultTaxRates(tax).length > 0 })
}
