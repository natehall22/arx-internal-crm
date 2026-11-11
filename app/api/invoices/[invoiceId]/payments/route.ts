import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { applyPaymentToInvoice, computeInvoiceBalance, findOrgInvoice } from '@/lib/invoices'
import { callerCanAccessJobBilling } from '@/lib/finance-access'

// GET - Get invoice balance and applied payments
export async function GET(
  request: Request,
  { params }: { params: { invoiceId: string } }
) {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

    if (!(await callerCanAccessJobBilling(adminClient, profile))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const invoiceCheck = await findOrgInvoice(adminClient, params.invoiceId, profile.org_id)
    if (!invoiceCheck) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const balance = await computeInvoiceBalance(adminClient, params.invoiceId)

    // Get applied payments with details
    const { data: applications } = await adminClient
      .from('invoice_payments')
      .select(`
        *,
        job_payment:job_payments(id, paid_at, amount_cents, payment_type, method, payer)
      `)
      .eq('invoice_id', params.invoiceId)
      .order('created_at', { ascending: true })

    // Get available payments (job payments not fully applied). An invoice without a job has none to pick from: its
    // payments are recorded straight onto it (record_payment on /api/invoices/[id]).
    const { data: jobPayments } = invoiceCheck.job_id
      ? await adminClient
          // org-scope-ok: job_payments gained org_id only for payments without a job (202611110060); job_id is the parent job of the invoice findOrgInvoice verified in the caller's company
          .from('job_payments')
          .select('*')
          .eq('job_id', invoiceCheck.job_id)
          .gt('amount_cents', 0)
          .order('paid_at', { ascending: true })
      : { data: [] as Array<{ id: string; amount_cents: number }> }

    // Calculate remaining amount for each payment
    const availablePayments = []
    for (const payment of jobPayments || []) {
      const { data: applied } = await adminClient
        .from('invoice_payments')
        .select('applied_cents')
        .eq('job_payment_id', payment.id)

      const totalApplied = (applied || []).reduce((sum, a) => sum + a.applied_cents, 0)
      const remaining = payment.amount_cents - totalApplied

      if (remaining > 0) {
        availablePayments.push({
          ...payment,
          total_applied: totalApplied,
          remaining_cents: remaining,
        })
      }
    }

    return NextResponse.json({
      balance,
      applications: applications || [],
      available_payments: availablePayments,
    })

  } catch (error) {
    console.error('Error in GET /api/invoices/[invoiceId]/payments:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Apply a payment to the invoice
export async function POST(
  request: Request,
  { params }: { params: { invoiceId: string } }
) {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

    if (!(await callerCanAccessJobBilling(adminClient, profile))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const invoiceCheck = await findOrgInvoice(adminClient, params.invoiceId, profile.org_id)
    if (!invoiceCheck) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const body = await request.json()
    const { job_payment_id, applied_cents } = body

    if (!job_payment_id || !applied_cents) {
      return NextResponse.json({ error: 'job_payment_id and applied_cents required' }, { status: 400 })
    }

    const application = await applyPaymentToInvoice(
      adminClient,
      profile.org_id,
      params.invoiceId,
      job_payment_id,
      applied_cents,
      profile.id
    )

    const balance = await computeInvoiceBalance(adminClient, params.invoiceId)

    return NextResponse.json({ success: true, application, balance })

  } catch (error) {
    console.error('Error in POST /api/invoices/[invoiceId]/payments:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
