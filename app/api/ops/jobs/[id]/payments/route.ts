import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import type { JobPayment, JobPaymentSummary } from '@/lib/types/job-payments'
import { JOB_COLLECTION_COLUMNS } from '@/lib/job-collection'
import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { buildJobPaymentSummary } from '@/lib/job-payments'
import { recordJobPayment } from '@/lib/job-payment-record'
import { loadInvoiceTaxCentsByJob } from '@/lib/job-invoice-tax'

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
      .select(`id, ${JOB_COLLECTION_COLUMNS}`)
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

    const invoiceTax = await loadInvoiceTaxCentsByJob(adminClient, [params.id])
    const summary: JobPaymentSummary = buildJobPaymentSummary(
      { ...(job as unknown as Parameters<typeof buildJobPaymentSummary>[0]), invoice_tax_cents: invoiceTax.get(params.id) ?? 0 },
      (payments || []) as JobPayment[]
    )

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

    const body = await request.json()
    const { paid_at, amount_cents, payment_type, method, payer, note } = body

    // Validate required fields
    if (!paid_at || amount_cents === undefined || !payment_type || !method || !payer) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // The one job payment writer (append-only; outbox + payment email inside). It checks the job is this company's.
    const result = await recordJobPayment(adminClient, {
      orgId: profile.org_id,
      jobId: params.id,
      paidAt: paid_at,
      amountCents: amount_cents,
      paymentType: payment_type,
      method,
      payer,
      note: note || null,
      createdBy: profile.id,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    const payment = result.payment

    return NextResponse.json({ success: true, payment })

  } catch (error) {
    console.error('Error in POST /api/ops/jobs/[id]/payments:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
