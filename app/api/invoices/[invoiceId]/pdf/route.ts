import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

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
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
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
