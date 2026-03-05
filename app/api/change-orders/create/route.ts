import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { generateChangeOrderPdf } from '@/lib/contracts/generateChangeOrderPdf'

export async function POST(request: NextRequest) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createClient()
    const body = await request.json()

    const {
      projectId,
      jobId,
      coNumber,
      description,
      originalAmount,
      updatedTotal,
      updatedRemaining,
      customerPrintName,
      customerSignature,
      repName,
      repSignature,
      originalContractId,
      originalContractDate,
      paymentMethod,
      customerName,
      projectAddress,
    } = body

    if (!projectId || !coNumber || !description || !customerPrintName || !customerSignature || !repName || !repSignature) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const signedAt = new Date().toISOString()
    const today = new Date().toISOString().split('T')[0]

    // Generate PDF
    let pdfUrl: string | null = null
    let pdfStoragePath: string | null = null

    try {
      console.log('[Change Order] Starting PDF generation for:', coNumber)
      
      const pdfBuffer = await generateChangeOrderPdf({
        coNumber,
        date: signedAt,
        customerName,
        projectAddress,
        originalAmount,
        updatedTotal,
        updatedRemaining,
        description,
        customerPrintName,
        customerSignature,
        repName,
        repSignature,
        originalContractDate,
      })

      console.log('[Change Order] PDF generated, size:', pdfBuffer.length, 'bytes')

      // Use same storage bucket as Installation Agreement (files bucket)
      const fileName = `${coNumber.replace(/-/g, '_')}_${Date.now()}.pdf`
      pdfStoragePath = `change-orders/${projectId}/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('files')
        .upload(pdfStoragePath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        })

      if (uploadError) {
        console.error('[Change Order] Error uploading PDF:', uploadError.message)
      } else {
        pdfUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/files/${pdfStoragePath}`
        console.log('[Change Order] PDF uploaded:', pdfUrl)
      }
    } catch (pdfError: any) {
      console.error('[Change Order] PDF generation failed:', pdfError?.message || pdfError)
    }

    // Insert change order record
    const { data: changeOrder, error: insertError } = await supabase
      .from('job_change_orders')
      .insert({
        org_id: profile.org_id,
        project_id: projectId,
        job_id: jobId || null,
        co_number: coNumber,
        original_amount: originalAmount,
        updated_total: updatedTotal,
        updated_remaining: updatedRemaining,
        description,
        customer_print_name: customerPrintName,
        customer_signature_data: customerSignature,
        rep_name: repName,
        rep_signature_data: repSignature,
        signed_at: signedAt,
        pdf_url: pdfUrl,
        pdf_storage_path: pdfStoragePath,
        original_contract_id: originalContractId || null,
        original_contract_date: originalContractDate || null,
        payment_method: paymentMethod || null,
        created_by: profile.id,
      })
      .select('id')
      .single()

    if (insertError) {
      console.error('[Change Order] Error inserting record:', insertError)
      return NextResponse.json(
        { error: 'Failed to save change order' },
        { status: 500 }
      )
    }

    console.log('[Change Order] Record created:', changeOrder.id)

    // Update project's sale amount if there's a linked production job
    if (jobId) {
      const { error: jobUpdateError } = await supabase
        .from('production_jobs')
        .update({ sale_amount: updatedTotal })
        .eq('id', jobId)

      if (jobUpdateError) {
        console.error('[Change Order] Error updating job sale_amount:', jobUpdateError)
      } else {
        console.log('[Change Order] Updated job sale_amount to:', updatedTotal)
      }
    }

    // Note: Change orders are stored in job_change_orders table with pdf_url
    // They are displayed in the Change Orders section on the project page
    // No need to duplicate in job_files table

    // Log activity
    await supabase.from('activities').insert({
      org_id: profile.org_id,
      project_id: projectId,
      user_id: profile.id,
      type: 'status_change',
      body: `Change Order ${coNumber} created. Updated total: $${updatedTotal.toLocaleString()}`,
    })

    return NextResponse.json({
      success: true,
      changeOrderId: changeOrder.id,
      pdfUrl,
    })
  } catch (error) {
    console.error('[Change Order] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create change order' },
      { status: 500 }
    )
  }
}
