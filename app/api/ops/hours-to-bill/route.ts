import { NextResponse } from 'next/server'

import { hourlyRouteAuth } from '@/lib/hourly-billing-access'
import { approveHours, loadHoursToBill, parseApproveRequest } from '@/lib/hourly-billing-db'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/ops/hours-to-bill?lookback=<days> — every job / visit billed by the hour with its days: what the clock says
 * each day bills after the company's rules (and why), what is already approved and on which invoice.
 */
export async function GET(request: Request) {
  const ctx = await hourlyRouteAuth('bill')
  if (ctx instanceof Response) return ctx
  const n = Number(new URL(request.url).searchParams.get('lookback'))
  const data = await loadHoursToBill(ctx.admin, ctx.orgId, { lookbackDays: Number.isFinite(n) && n > 0 ? n : undefined })
  if (!data.ready) return NextResponse.json({ error: data.error, code: 'not_ready' }, { status: 503 })
  return NextResponse.json(data)
}

/**
 * POST /api/ops/hours-to-bill { target: { kind: 'job'|'visit', id }, days: [{ date, edit?: { lines, reason } }], send? }
 * — approve those days and put them on ONE new draft invoice (job invoice, or the customer's for a visit). Recomputed on
 * the server; prices never come from the browser. Safe to repeat: a day already approved is refused (409).
 */
export async function POST(request: Request) {
  const ctx = await hourlyRouteAuth('bill')
  if (ctx instanceof Response) return ctx
  const parsed = parseApproveRequest(await request.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const result = await approveHours(ctx.admin, ctx.orgId, ctx.userId, parsed.req)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result)
}
