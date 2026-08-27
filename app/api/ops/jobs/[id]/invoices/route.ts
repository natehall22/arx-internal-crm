import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { 
  createInvoiceForJob, 
  getInvoicesForJob,
  createDepositInvoiceV2,
  createFinalInvoice,
  createCustomAmountInvoice,
  getDepositInfo,
} from '@/lib/invoices'

// GET - List all invoices for a job
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
    const { data: job } = await adminClient
      .from('production_jobs')
      .select('id')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const invoices = await getInvoicesForJob(adminClient, params.id)
    const depositInfo = await getDepositInfo(adminClient, params.id)
    return NextResponse.json({ invoices, depositInfo })

  } catch (error) {
    console.error('Error in GET /api/ops/jobs/[id]/invoices:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create a new invoice for a job
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
    const { data: job } = await adminClient
      .from('production_jobs')
      .select('id')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const body = await request.json()
    const { invoice_kind = 'standard', amount_cents: rawAmountCents, line_description: rawLineDescription } = body

    let invoice

    switch (invoice_kind) {
      case 'deposit':
        invoice = await createDepositInvoiceV2(
          adminClient,
          params.id,
          profile.id
        )
        break

      case 'final':
        invoice = await createFinalInvoice(
          adminClient,
          params.id,
          profile.id
        )
        break

      case 'custom': {
        const amountCents =
          typeof rawAmountCents === 'number'
            ? Math.round(rawAmountCents)
            : Math.round(parseFloat(String(rawAmountCents ?? '')))
        const lineDescription =
          typeof rawLineDescription === 'string' ? rawLineDescription : undefined
        if (!Number.isFinite(amountCents) || amountCents <= 0) {
          return NextResponse.json(
            { error: 'Valid amount_cents greater than zero is required' },
            { status: 400 }
          )
        }
        invoice = await createCustomAmountInvoice(
          adminClient,
          params.id,
          profile.id,
          amountCents,
          lineDescription
        )
        break
      }

      case 'standard':
      default:
        invoice = await createInvoiceForJob(
          adminClient,
          params.id,
          profile.id,
          true // default from job total
        )
        break
    }

    return NextResponse.json({ success: true, invoice })

  } catch (error) {
    console.error('Error in POST /api/ops/jobs/[id]/invoices:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
