import { customerInScope } from '@/lib/category-scope'
import { NextResponse } from 'next/server'

import { billingRouteAuth } from '@/lib/service-billing-access'
import { emailCustomerStatement, loadCustomerStatement } from '@/lib/customer-statement'

export const dynamic = 'force-dynamic'

/** POST /api/customers/[id]/statement — email the customer their statement (open invoices + recent payments). Billing staff (money:record). */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const ctx = await billingRouteAuth()
  if (ctx instanceof Response) return ctx
  if (!(await customerInScope(ctx.admin, ctx.orgId, ctx.scope, params.id))) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  const statement = await loadCustomerStatement(ctx.admin, ctx.orgId, params.id)
  if (!statement) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  const sent = await emailCustomerStatement(ctx.admin, ctx.orgId, statement)
  if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: sent.status })
  return NextResponse.json({ ok: true, to: sent.to })
}
