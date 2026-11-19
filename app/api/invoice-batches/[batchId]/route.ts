import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { CUSTOMER_PAYMENT_METHODS, type CustomerPaymentMethod } from '@/lib/invoices'
import { findBatch, loadBatchDocument, recordBatchPayment, sendInvoiceBatch } from '@/lib/invoice-batch-db'
import { orgFeatureOffResponse } from '@/lib/org-features-server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

async function gate(batchId: string) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  }
  const admin = createServiceClient()
  const off = await orgFeatureOffResponse(profile.org_id, 'masterInvoices')
  if (off) return { res: off } as const
  if (!(await callerCanAccessJobBilling(admin, profile))) return { res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const
  const batch = await findBatch(admin, profile.org_id, batchId)
  if (!batch) return { res: NextResponse.json({ error: 'Master invoice not found' }, { status: 404 }) } as const
  return { profile, admin, batch } as const
}

export async function GET(_req: Request, { params }: { params: { batchId: string } }) {
  const g = await gate(params.batchId)
  if ('res' in g) return g.res
  const doc = await loadBatchDocument(g.admin, g.profile.org_id, g.batch)
  if (!doc) return NextResponse.json({ error: 'This master invoice has no invoices' }, { status: 404 })
  return NextResponse.json({ batch: doc })
}

/** PATCH { action: 'send', email?, resend? } | { action: 'record_payment', amount_cents, paid_at, method, note?, client_key } */
export async function PATCH(request: Request, { params }: { params: { batchId: string } }) {
  const g = await gate(params.batchId)
  if ('res' in g) return g.res
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (body?.action === 'send') {
    const sent = await sendInvoiceBatch(g.admin, g.profile.org_id, g.batch, { to: typeof body.email === 'string' ? body.email : null, resend: body.resend === true })
    if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: sent.status })
    return NextResponse.json({ success: true, to: sent.to, alreadySent: sent.alreadySent === true })
  }
  if (body?.action === 'record_payment') {
    const method = (CUSTOMER_PAYMENT_METHODS as readonly string[]).includes(String(body.method)) ? (body.method as CustomerPaymentMethod) : ('' as CustomerPaymentMethod)
    const done = await recordBatchPayment(g.admin, g.profile.org_id, g.profile.id, g.batch, {
      amountCents: Number(body.amount_cents),
      paidAt: typeof body.paid_at === 'string' ? body.paid_at : '',
      method,
      note: typeof body.note === 'string' ? body.note : null,
      clientKey: typeof body.client_key === 'string' ? body.client_key : '',
    })
    if (!done.ok) return NextResponse.json({ error: done.error }, { status: done.status })
    return NextResponse.json({ success: true, parts: done.parts, alreadyRecorded: done.alreadyRecorded })
  }
  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
