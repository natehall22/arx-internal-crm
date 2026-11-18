import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { buildReportContext } from '@/lib/reporting/run'
import { ymdInZone } from '@/lib/service-plans'
import { loadAllInvoices } from '@/lib/service-billing-db'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/invoices — every invoice of the company (job and service, any status) for Billing → All invoices.
 * Same gate as the rest of billing (money:record). Paid invoices, drafts and voids are company revenue history: they are listed only for
 * people with reports:financials (`fullHistory`). Someone with money:record alone sees the open invoices and what each still owes, as the
 * Unpaid list does (and no paid-so-far amounts). `canExport` says whether the CSV button shows (reports:financials + export).
 */
export async function GET() {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createServiceClient()
  if (!(await callerCanAccessJobBilling(admin, profile))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const today = ymdInZone(new Date(), await loadOrgTimeZone(admin, profile.org_id))
  const [loaded, ctx] = await Promise.all([loadAllInvoices(admin, profile.org_id, { today }), buildReportContext(admin, profile)])
  const all = loaded?.rows ?? []
  const rows = ctx.finance ? all : all.filter((r) => r.balanceCents > 0).map((r) => ({ ...r, paidCents: 0 }))
  return NextResponse.json({ rows, capped: loaded?.capped ?? false, today, fullHistory: ctx.finance, canExport: ctx.finance && ctx.canExport })
}
