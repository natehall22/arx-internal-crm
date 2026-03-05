import React from 'react'
import { requireAuthApi } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'
import { validateRequiredAdders } from '@/lib/required-adders'
import { renderToBuffer } from '@react-pdf/renderer'
import { ProposalPDF } from '@/lib/pdf/ProposalPDF'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { profile } = await requireAuthApi()
  const supabase = createClient()
  const serviceSupabase = createServiceClient()

  const { data: estimate } = await supabase
    .from('estimates')
    .select('*, projects(*), customers(*)')
    .eq('id', params.id)
    .eq('org_id', profile.org_id)
    .single()

  if (!estimate) {
    return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
  }

  const { data: lines } = await supabase
    .from('estimate_lines')
    .select('*')
    .eq('estimate_id', params.id)
    .order('sort_order', { ascending: true })

  // Validate required adders
  const issues = validateRequiredAdders(lines || [], estimate.projects)
  if (issues.length > 0) {
    return NextResponse.json(
      { error: 'Required adders missing', issues },
      { status: 400 }
    )
  }

  // Get customer name
  const customerName = estimate.projects.customer_id
    ? (await supabase
        .from('customers')
        .select('name')
        .eq('id', estimate.projects.customer_id)
        .single()).data?.name
    : null

  // Generate PDF
  try {
    const pdfDoc = React.createElement(ProposalPDF, {
      estimate,
      lines: lines || [],
      customerName: customerName || undefined,
    }) as unknown as React.ReactElement

    const pdfBuffer = await renderToBuffer(pdfDoc)

    // Upload to Supabase Storage
    const storagePath = `org/${profile.org_id}/proposals/${params.id}.pdf`

    const { error: uploadError } = await serviceSupabase.storage
      .from('files')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (uploadError) {
      console.error('Upload error:', uploadError)
      return NextResponse.json(
        { error: 'Failed to upload PDF', details: uploadError.message },
        { status: 500 }
      )
    }

    // Update estimate with PDF path
    await supabase
      .from('estimates')
      .update({ proposal_pdf_path: storagePath })
      .eq('id', params.id)

    // Get signed URL
    const { data: urlData, error: urlError } = await serviceSupabase.storage
      .from('files')
      .createSignedUrl(storagePath, 3600)

    if (urlError || !urlData) {
      return NextResponse.json(
        { error: 'Failed to generate download URL' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      downloadUrl: urlData.signedUrl,
    })
  } catch (error: any) {
    console.error('PDF generation error:', error)
    return NextResponse.json(
      { error: 'Failed to generate PDF', details: error.message },
      { status: 500 }
    )
  }
}
