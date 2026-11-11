import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { orgDb } from '@/lib/supabase/org-db'
import { isMissingColumn } from '@/lib/supabase/errors'
import { parseTaxExemptionPatch } from '@/lib/sales-tax'

export const dynamic = 'force-dynamic'

/**
 * Mark a customer sales-tax exempt (or not). Billing people only (the same gate as invoices and payments): exempting
 * a customer changes what they are charged, so reps cannot do it. The certificate is a document already filed on this
 * customer (documents.customer_id). New quotes and invoices read it through lib/sales-tax-server.ts; quotes and
 * invoices already sent keep the tax they were sent with.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createServiceClient()
  if (!(await callerCanAccessJobBilling(admin, profile))) {
    return NextResponse.json({ error: 'Only billing staff can change tax exemption' }, { status: 403 })
  }
  const parsed = parseTaxExemptionPatch(await request.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const db = orgDb(admin, profile.org_id)
  const { data: customer } = await db.from('customers').select('id').eq('id', params.id).maybeSingle()
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  if (parsed.value.tax_exempt_document_id) {
    const { data: doc } = await db
      .from('documents')
      .select('id')
      .eq('id', parsed.value.tax_exempt_document_id)
      .eq('customer_id', params.id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!doc) return NextResponse.json({ error: 'That certificate is not a file on this customer' }, { status: 400 })
  }

  const { data, error } = await db
    .from('customers')
    .update(parsed.value)
    .eq('id', params.id)
    .select('id, tax_exempt, tax_exempt_reason, tax_exempt_certificate_number, tax_exempt_document_id')
    .maybeSingle()
  if (error) {
    if (isMissingColumn(error, 'tax_exempt')) {
      return NextResponse.json({ error: 'Tax exemption needs a database update first (migration 202611110040).' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  }
  return NextResponse.json({ customer: data })
}
