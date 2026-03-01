import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { applyPaymentToInvoice, computeInvoiceBalance } from '@/lib/invoices'

// GET - Get invoice balance and applied payments
export async function GET(
  request: Request,
  { params }: { params: { invoiceId: string } }
) {
  try {
    const supabase = createClient()
    const adminClient = createServiceClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Verify invoice belongs to user's org
    const { data: invoiceCheck } = await adminClient
      .from('job_invoices')
      .select('id, job_id, production_jobs!inner(org_id)')
      .eq('id', params.invoiceId)
      .single()

    if (!invoiceCheck || (invoiceCheck as any).production_jobs?.org_id !== profile.org_id) {
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

    // Get available payments (job payments not fully applied)
    const { data: jobPayments } = await adminClient
      .from('job_payments')
      .select('*')
      .eq('job_id', invoiceCheck.job_id)
      .gt('amount_cents', 0)
      .order('paid_at', { ascending: true })

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
    const supabase = createClient()
    const adminClient = createServiceClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Verify invoice belongs to user's org
    const { data: invoiceCheck } = await adminClient
      .from('job_invoices')
      .select('id, production_jobs!inner(org_id)')
      .eq('id', params.invoiceId)
      .single()

    if (!invoiceCheck || (invoiceCheck as any).production_jobs?.org_id !== profile.org_id) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const body = await request.json()
    const { job_payment_id, applied_cents } = body

    if (!job_payment_id || !applied_cents) {
      return NextResponse.json({ error: 'job_payment_id and applied_cents required' }, { status: 400 })
    }

    const application = await applyPaymentToInvoice(
      adminClient,
      params.invoiceId,
      job_payment_id,
      applied_cents,
      user.id
    )

    const balance = await computeInvoiceBalance(adminClient, params.invoiceId)

    return NextResponse.json({ success: true, application, balance })

  } catch (error) {
    console.error('Error in POST /api/invoices/[invoiceId]/payments:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
