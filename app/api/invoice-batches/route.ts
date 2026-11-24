import { NextResponse } from 'next/server'

import { categoryScopeOf } from '@/lib/category-scope'
import { requireAuthApi } from '@/lib/auth'
import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { createInvoiceBatch, loadBatchSummaries, loadBillableJobs } from '@/lib/invoice-batch-db'
import { orgFeatureOffResponse } from '@/lib/org-features-server'
import { buildReportContext } from '@/lib/reporting/run'
import { orgDb } from '@/lib/supabase/org-db'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function gate() {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  }
  // Master invoices span customers and categories and are not split by category: not available while limited.
  if (categoryScopeOf(profile).limited) return { res: NextResponse.json({ error: 'Not found' }, { status: 404 }) } as const
  const admin = createServiceClient()
  const off = await orgFeatureOffResponse(profile.org_id, 'masterInvoices')
  if (off) return { res: off } as const
  if (!(await callerCanAccessJobBilling(admin, profile))) return { res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const
  return { profile, admin } as const
}

/**
 * GET /api/invoice-batches[?customerId=] — the company's master invoices (billing gate: money:record). Like the invoice list,
 * what has been paid so far is shown only to people with reports:financials; others see what each still owes.
 */
export async function GET(request: Request) {
  const g = await gate()
  if ('res' in g) return g.res
  const sp = new URL(request.url).searchParams
  const customerId = sp.get('customerId')
  if (customerId && !UUID.test(customerId)) return NextResponse.json({ error: 'Bad customer' }, { status: 400 })
  const [all, ctx] = await Promise.all([loadBatchSummaries(g.admin, g.profile.org_id, { customerId }), buildReportContext(g.admin, g.profile)])
  const batches = ctx.finance ? all : all.filter((b) => b.balanceCents > 0).map((b) => ({ ...b, paidCents: 0, totalCents: b.balanceCents }))
  // `waiting=1` (the Money tab card): how many finished jobs wait to be billed, in the same single request (one batched read, no per-job calls).
  const waiting = customerId && sp.get('waiting') === '1' ? (await loadBillableJobs(g.admin, g.profile.org_id, customerId)).jobs.length : undefined
  return NextResponse.json({ batches, ...(waiting != null ? { waiting } : {}) })
}

/** POST /api/invoice-batches { customerId, jobIds, publicNote? } — "Bill finished jobs": drafts only, nothing is sent. */
export async function POST(request: Request) {
  const g = await gate()
  if ('res' in g) return g.res
  const body = (await request.json().catch(() => null)) as { customerId?: unknown; jobIds?: unknown; publicNote?: unknown; useBillable?: unknown } | null
  const customerId = typeof body?.customerId === 'string' ? body.customerId : ''
  const jobIds = Array.isArray(body?.jobIds) ? (body!.jobIds as unknown[]).filter((x): x is string => typeof x === 'string' && UUID.test(x)) : []
  if (!UUID.test(customerId)) return NextResponse.json({ error: 'Pick a customer' }, { status: 400 })
  const { data: customer } = await orgDb(g.admin, g.profile.org_id).from('customers').select('id').eq('id', customerId).maybeSingle()
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  const useBillable = Array.isArray(body?.useBillable) ? (body!.useBillable as unknown[]).filter((x): x is string => typeof x === 'string' && UUID.test(x)) : []
  const made = await createInvoiceBatch(g.admin, g.profile.org_id, g.profile.id, { customerId, jobIds, publicNote: typeof body?.publicNote === 'string' ? body.publicNote : null, useBillable })
  if (!made.ok) return NextResponse.json({ error: made.error, ...('code' in made && made.code ? { code: made.code, drafts: made.drafts } : {}) }, { status: made.status })
  return NextResponse.json({ success: true, batchId: made.batchId, number: made.number })
}
