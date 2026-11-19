import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { loadBillableJobs } from '@/lib/invoice-batch-db'
import { orgFeatureOffResponse } from '@/lib/org-features-server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/** GET /api/invoice-batches/billable?customerId= — the customer's finished, not-yet-billed jobs ("Bill finished jobs"). */
export async function GET(request: Request) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const off = await orgFeatureOffResponse(profile.org_id, 'masterInvoices')
  if (off) return off
  const admin = createServiceClient()
  if (!(await callerCanAccessJobBilling(admin, profile))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const customerId = new URL(request.url).searchParams.get('customerId') ?? ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerId)) return NextResponse.json({ error: 'Pick a customer' }, { status: 400 })
  return NextResponse.json(await loadBillableJobs(admin, profile.org_id, customerId))
}
