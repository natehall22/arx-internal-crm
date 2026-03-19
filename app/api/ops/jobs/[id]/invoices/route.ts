import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { canAccessJobBilling } from '@/lib/finance-access'
import { 
  createInvoiceForJob, 
  getInvoicesForJob,
  createDepositInvoiceV2,
  createFinalInvoice,
  getDepositInfo,
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
      .select('org_id, role, custom_role_id, custom_role:custom_roles(name, display_name)')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const customRole = Array.isArray((profile as any).custom_role)
      ? (profile as any).custom_role[0]
      : (profile as any).custom_role

    if (!canAccessJobBilling({
      role: (profile as any).role,
      customRoleName: customRole?.name,
      customRoleDisplayName: customRole?.display_name,
    })) {
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
    const supabase = createClient()
    const adminClient = createServiceClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role, custom_role_id, custom_role:custom_roles(name, display_name)')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const customRole = Array.isArray((profile as any).custom_role)
      ? (profile as any).custom_role[0]
      : (profile as any).custom_role

    if (!canAccessJobBilling({
      role: (profile as any).role,
      customRoleName: customRole?.name,
      customRoleDisplayName: customRole?.display_name,
    })) {
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
    const { invoice_kind = 'standard' } = body

    let invoice

    switch (invoice_kind) {
      case 'deposit':
        invoice = await createDepositInvoiceV2(
          adminClient,
          params.id,
          user.id
        )
        break

      case 'final':
        invoice = await createFinalInvoice(
          adminClient,
          params.id,
          user.id
        )
        break

      case 'standard':
      default:
        invoice = await createInvoiceForJob(
          adminClient,
          params.id,
          user.id,
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
