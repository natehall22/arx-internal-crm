import { NextResponse } from 'next/server'

import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { requireAuthApi } from '@/lib/auth'
import { isMissingColumn } from '@/lib/supabase/errors'
import { orgDb } from '@/lib/supabase/org-db'
import { parsePaymentTerms } from '@/lib/payment-terms'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/** PATCH { terms: 'due_on_receipt' | 'net_15' | 'net_30' | null } — a customer's own payment terms (null = the company default). Billing staff. Invoices already issued keep their due day. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createServiceClient()
  if (!(await callerCanAccessJobBilling(admin, profile))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await request.json().catch(() => null)) as { terms?: unknown } | null
  if (!body || !('terms' in body)) return NextResponse.json({ error: 'Pick the terms' }, { status: 400 })
  const terms = body.terms === null || body.terms === '' ? null : parsePaymentTerms(body.terms)
  if (body.terms !== null && body.terms !== '' && !terms) return NextResponse.json({ error: 'Pick Due on receipt, Net 15 or Net 30' }, { status: 400 })
  const { data, error } = await orgDb(admin, profile.org_id).from('customers').update({ payment_terms: terms }).eq('id', params.id).select('id').maybeSingle()
  if (error) {
    if (isMissingColumn(error, 'payment_terms')) return NextResponse.json({ error: 'Payment terms need a database update first (migration 202611300010).' }, { status: 409 })
    return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  return NextResponse.json({ ok: true, terms })
}
