import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { InvoicePDF } from '@/lib/pdf/InvoicePDF'

// GET - Download/view invoice PDF
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

    // Get invoice with job info
    const { data: invoice } = await adminClient
      .from('job_invoices')
      .select(`
        *,
        production_jobs!inner(
          org_id,
          job_number,
          address_text,
          customer:customers(name, email, phone, address_text),
          project:projects(address_text)
        )
      `)
      .eq('id', params.invoiceId)
      .single()

    if (!invoice || (invoice as any).production_jobs?.org_id !== profile.org_id) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // If PDF already exists, return signed URL
    if (invoice.pdf_path) {
      const { data: signedUrl } = await adminClient.storage
        .from('files')
        .createSignedUrl(invoice.pdf_path, 3600)

      if (signedUrl?.signedUrl) {
        return NextResponse.json({ pdf_url: signedUrl.signedUrl })
      }
    }

    // Generate PDF if not exists
    const pdfUrl = await generateAndStoreInvoicePdf(adminClient, invoice, profile.org_id)
    return NextResponse.json({ pdf_url: pdfUrl })

  } catch (error) {
    console.error('Error in GET /api/invoices/[invoiceId]/pdf:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST - Generate/regenerate invoice PDF
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

    // Get invoice with all details
    const { data: invoice } = await adminClient
      .from('job_invoices')
      .select(`
        *,
        production_jobs!inner(
          org_id,
          job_number,
          address_text,
          customer:customers(name, email, phone, address_text),
          project:projects(address_text)
        )
      `)
      .eq('id', params.invoiceId)
      .single()

    if (!invoice || (invoice as any).production_jobs?.org_id !== profile.org_id) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const pdfUrl = await generateAndStoreInvoicePdf(adminClient, invoice, profile.org_id)
    return NextResponse.json({ success: true, pdf_url: pdfUrl })

  } catch (error) {
    console.error('Error in POST /api/invoices/[invoiceId]/pdf:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function generateAndStoreInvoicePdf(
  supabase: any,
  invoice: any,
  orgId: string
): Promise<string> {
  // Get line items
  const { data: items, error: itemsError } = await supabase
    .from('job_invoice_items')
    .select('*')
    .eq('invoice_id', invoice.id)
    .order('sort_order', { ascending: true })

  if (itemsError) {
    console.error('Error fetching invoice items:', itemsError)
  }

  // Get applied payments
  const { data: applications } = await supabase
    .from('invoice_payments')
    .select('applied_cents')
    .eq('invoice_id', invoice.id)

  const appliedCents = (applications || []).reduce(
    (sum: number, a: any) => sum + a.applied_cents,
    0
  )

  // Get org settings for company info
  const { data: org } = await supabase
    .from('orgs')
    .select('name, address, city, state, zip, phone, email')
    .eq('id', orgId)
    .single()

  const job = invoice.production_jobs
  const customer = Array.isArray(job.customer) ? job.customer[0] : job.customer
  const project = Array.isArray(job.project) ? job.project[0] : job.project

  // Build company address
  const companyAddress = [
    org?.address,
    org?.city && org?.state ? `${org.city}, ${org.state} ${org.zip || ''}`.trim() : null,
  ]
    .filter(Boolean)
    .join('\n')

  // Build customer address
  const customerAddress = customer?.address_text || project?.address_text || job.address_text || ''

  // Generate PDF
  const pdfDoc = React.createElement(InvoicePDF, {
    invoice,
    items: items || [],
    appliedCents,
    customer: {
      name: customer?.name || 'Customer',
      address: customerAddress,
      email: customer?.email,
      phone: customer?.phone,
    },
    company: {
      name: org?.name || 'ARX Roofing & Exteriors, LLC',
      address: companyAddress || '123 Main Street\nCity, State 12345',
      phone: org?.phone,
      email: org?.email,
    },
  })

  // @ts-expect-error - InvoicePDF returns a Document which is compatible with renderToBuffer
  const pdfBuffer = await renderToBuffer(pdfDoc)

  // Upload to storage
  const storagePath = `org/${orgId}/invoices/${invoice.id}.pdf`

  // Try to upload to storage - if bucket doesn't exist, we'll still return a data URL
  const { error: uploadError } = await supabase.storage
    .from('files')
    .upload(storagePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    })

  if (uploadError) {
    console.error('Upload error:', uploadError)
    // If bucket doesn't exist, return base64 data URL instead
    if (uploadError.message?.includes('Bucket not found') || uploadError.message?.includes('bucket')) {
      const base64 = Buffer.from(pdfBuffer).toString('base64')
      return `data:application/pdf;base64,${base64}`
    }
    throw new Error(`Failed to upload PDF: ${uploadError.message}`)
  }

  // Update invoice with PDF path
  await supabase
    .from('job_invoices')
    .update({ pdf_path: storagePath })
    .eq('id', invoice.id)

  // Get signed URL
  const { data: signedUrl } = await supabase.storage
    .from('files')
    .createSignedUrl(storagePath, 3600)

  return signedUrl?.signedUrl || ''
}
