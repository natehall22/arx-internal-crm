import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { JobPaymentSummary } from '@/lib/types/job-payments'
import { enqueuePaymentRecorded } from '@/lib/integrations'
import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { getJobPaymentSummary } from '@/lib/job-payments'
import { notifyAdminOpsOfJobPayment } from '@/lib/job-payment-email'

// GET - Get all payments for a job with summary
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
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

    // Verify job exists and belongs to user's org
    const { data: job, error: jobError } = await adminClient
      .from('production_jobs')
      .select('id, sale_amount')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Fetch payments
    const { data: payments, error: paymentsError } = await adminClient
      .from('job_payments')
      .select('*')
      .eq('job_id', params.id)
      .order('paid_at', { ascending: true })

    if (paymentsError) {
      console.error('Error fetching payments:', paymentsError)
      return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 })
    }

    const paymentList = payments || []
    const saleAmountCents = Math.round((job.sale_amount || 0) * 100)
    const collectedCents = paymentList.reduce((sum, p) => sum + p.amount_cents, 0)
    const remainingCents = saleAmountCents - collectedCents

    const summary: JobPaymentSummary = {
      payments: paymentList,
      collected_cents: collectedCents,
      collected_dollars: collectedCents / 100,
      sale_amount_cents: saleAmountCents,
      sale_amount_dollars: saleAmountCents / 100,
      remaining_cents: remainingCents,
      remaining_dollars: remainingCents / 100,
      payment_count: paymentList.length,
    }

    return NextResponse.json(summary)

  } catch (error) {
    console.error('Error in GET /api/ops/jobs/[id]/payments:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Add a new payment
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
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

    // Verify job exists and belongs to user's org
    const { data: job, error: jobError } = await adminClient
      .from('production_jobs')
      .select('id, customer_id, job_number, address_text')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const body = await request.json()
    const { paid_at, amount_cents, payment_type, method, payer, note } = body

    // Validate required fields
    if (!paid_at || amount_cents === undefined || !payment_type || !method || !payer) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Insert payment (append-only, no updates allowed)
    const { data: payment, error: insertError } = await adminClient
      .from('job_payments')
      .insert({
        job_id: params.id,
        paid_at,
        amount_cents,
        payment_type,
        method,
        payer,
        note: note || null,
        created_by: profile.id,
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error inserting payment:', insertError)
      return NextResponse.json({ error: 'Failed to add payment' }, { status: 500 })
    }

    // Enqueue integration event for payment
    enqueuePaymentRecorded(adminClient, profile.org_id, payment.id, {
      job_id: params.id,
      customer_id: job.customer_id,
      amount_cents,
      paid_at,
      payment_type,
      method,
      payer,
    }).catch(err => console.error('Failed to enqueue payment event:', err))

    // Email admin + operations (non-blocking)
    getJobPaymentSummary(adminClient, params.id)
      .then((summary) => {
        if (!summary) return
        return notifyAdminOpsOfJobPayment(adminClient, {
          orgId: profile.org_id,
          jobId: params.id,
          jobNumber: job.job_number || params.id,
          addressText: job.address_text || '',
          amountCents: amount_cents,
          payer: String(payer),
          method: String(method),
          paidAt: String(paid_at),
          collectedCents: summary.collected_cents,
          remainingCents: summary.remaining_cents,
          saleAmountCents: summary.sale_amount_cents,
        })
      })
      .catch((err) => console.error('notifyAdminOpsOfJobPayment failed:', err))

    return NextResponse.json({ success: true, payment })

  } catch (error) {
    console.error('Error in POST /api/ops/jobs/[id]/payments:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
