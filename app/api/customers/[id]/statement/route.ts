import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { emailCustomerStatement, loadCustomerStatement } from '@/lib/customer-statement'
import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/** POST /api/customers/[id]/statement — email the customer their statement (open invoices + recent payments). Billing staff (money:record). */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createServiceClient()
  if (!(await callerCanAccessJobBilling(admin, profile))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const statement = await loadCustomerStatement(admin, profile.org_id, params.id)
  if (!statement) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  const sent = await emailCustomerStatement(admin, profile.org_id, statement)
  if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: sent.status })
  return NextResponse.json({ ok: true, to: sent.to })
}
