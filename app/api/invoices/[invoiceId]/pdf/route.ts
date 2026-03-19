import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { canAccessJobBilling } from '@/lib/finance-access'

// GET - Return URL to printable invoice page
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

    // Verify invoice exists and belongs to user's org
    const { data: invoice } = await adminClient
      .from('job_invoices')
      .select(`
        id,
        production_jobs!inner(org_id)
      `)
      .eq('id', params.invoiceId)
      .single()

    if (!invoice || (invoice as any).production_jobs?.org_id !== profile.org_id) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Return URL to printable invoice page
    return NextResponse.json({ 
      pdf_url: `/invoices/${params.invoiceId}/print` 
    })

  } catch (error) {
    console.error('Error in GET /api/invoices/[invoiceId]/pdf:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
