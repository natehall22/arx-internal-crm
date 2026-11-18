import { NextResponse, type NextRequest } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { filterInvoiceRows, invoiceRowsToResult } from '@/lib/invoice-list'
import { buildReportContext, resultToCsv } from '@/lib/reporting/run'
import { ymdInZone } from '@/lib/service-plans'
import { loadAllInvoices } from '@/lib/service-billing-db'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/invoices/export?status=&period=&customer=&q= — the all-invoices list (same filters as the screen, one shared
 * rule: lib/invoice-list.ts) as CSV, written by the Reports CSV writer (formula-safe). Needs money:record to see invoices AND
 * the Reports export gate: reports:financials + export (an invoice export is company revenue).
 */
export async function GET(request: NextRequest) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createServiceClient()
  if (!(await callerCanAccessJobBilling(admin, profile))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const ctx = await buildReportContext(admin, profile)
  if (!ctx.finance || !ctx.canExport) return NextResponse.json({ error: 'Not authorized to export' }, { status: 403 })
  const p = request.nextUrl.searchParams
  const today = ymdInZone(new Date(), await loadOrgTimeZone(admin, profile.org_id))
  const loaded = await loadAllInvoices(admin, profile.org_id, { today })
  const rows = filterInvoiceRows(loaded?.rows ?? [], { status: p.get('status') ?? '', period: p.get('period') ?? '', customer: p.get('customer') ?? '', q: p.get('q') ?? '' }, today)
  return new NextResponse(resultToCsv(invoiceRowsToResult(rows)), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="invoices-${today}.csv"`, 'Cache-Control': 'no-store' },
  })
}
