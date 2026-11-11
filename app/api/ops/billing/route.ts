import { NextResponse } from 'next/server'

import { billingRouteAuth } from '@/lib/service-billing-access'
import { createServiceInvoices, loadReadyToBill, MAX_INVOICES_PER_REQUEST } from '@/lib/service-billing-db'
import { BILLING_GROUPINGS, type BillingGrouping } from '@/lib/service-billing'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function lookbackParam(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/**
 * GET /api/ops/billing?lookback=<days> — done service visits not yet billed (units), plus what the screen needs to group
 * and preview them in the browser (customers, addresses, the company's sales tax). Grouping and totals run on the same
 * pure rules the server uses to make the invoices (lib/service-billing.ts).
 */
export async function GET(request: Request) {
  const ctx = await billingRouteAuth()
  if (ctx instanceof Response) return ctx
  const lookbackDays = lookbackParam(new URL(request.url).searchParams.get('lookback'))
  const data = await loadReadyToBill(ctx.admin, ctx.orgId, { lookbackDays })
  if (!data.ready) return NextResponse.json({ error: data.error, code: 'not_ready' }, { status: 503 })
  return NextResponse.json({ ...data, maxPerRequest: MAX_INVOICES_PER_REQUEST })
}

/**
 * POST /api/ops/billing { keys, grouping, includeCurrentMonth, lookbackDays?, send } — make those invoices (≤ 25 per call;
 * the screen sends a big batch in pieces). Safe to repeat: anything already billed is skipped and reported.
 */
export async function POST(request: Request) {
  const ctx = await billingRouteAuth()
  if (ctx instanceof Response) return ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || !Array.isArray(body.keys)) return NextResponse.json({ error: 'Pick at least one invoice to make' }, { status: 400 })
  const grouping = (BILLING_GROUPINGS as readonly unknown[]).includes(body.grouping) ? (body.grouping as BillingGrouping) : null
  if (!grouping) return NextResponse.json({ error: 'Pick how to group the invoices' }, { status: 400 })
  const result = await createServiceInvoices(ctx.admin, ctx.orgId, ctx.userId, {
    keys: body.keys.filter((k): k is string => typeof k === 'string'),
    grouping,
    includeCurrentMonth: body.includeCurrentMonth === true,
    lookbackDays: lookbackParam(body.lookbackDays),
    send: body.send === true,
  })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result)
}
