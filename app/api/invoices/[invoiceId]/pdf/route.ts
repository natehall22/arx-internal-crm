import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { findOrgInvoice } from '@/lib/invoices'

// GET - Return URL to printable invoice page
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

    if (!(await findOrgInvoice(adminClient, params.invoiceId, profile.org_id))) {
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
