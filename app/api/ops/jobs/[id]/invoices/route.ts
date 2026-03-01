import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { 
  createInvoiceForJob, 
  getInvoicesForJob,
  createDepositInvoice,
} from '@/lib/invoices'

// GET - List all invoices for a job
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
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
    return NextResponse.json({ invoices })

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
    const { 
      default_from_job_total = true,
      invoice_type,
      deposit_payment_id,
      deposit_amount_cents,
    } = body

    let invoice

    // Handle deposit invoice creation
    if (invoice_type === 'deposit' && deposit_payment_id && deposit_amount_cents) {
      invoice = await createDepositInvoice(
        adminClient,
        params.id,
        user.id,
        deposit_payment_id,
        deposit_amount_cents
      )
    } else {
      // Standard invoice creation
      invoice = await createInvoiceForJob(
        adminClient,
        params.id,
        user.id,
        default_from_job_total
      )
    }

    return NextResponse.json({ success: true, invoice })

  } catch (error) {
    console.error('Error in POST /api/ops/jobs/[id]/invoices:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
