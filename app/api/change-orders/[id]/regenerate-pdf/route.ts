import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { generateChangeOrderPdf } from '@/lib/contracts/generateChangeOrderPdf'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const service = createServiceClient()
    const id = params.id

    const { data: co, error } = await service
      .from('job_change_orders')
      .select('*')
      .eq('id', id)
      .eq('org_id', profile.org_id)
      .single()

    if (error || !co) {
      return NextResponse.json({ error: 'Change order not found' }, { status: 404 })
    }

    if (co.status !== 'completed') {
      return NextResponse.json(
        { error: 'The change order must be fully signed before a PDF can be generated.' },
        { status: 400 }
      )
    }

    if (!String(co.customer_signature_data || '').trim() || !String(co.rep_signature_data || '').trim()) {
      return NextResponse.json(
        { error: 'This record is missing signature data required for the PDF.' },
        { status: 400 }
      )
    }

    const { data: project } = await service
      .from('projects')
      .select('address_text')
      .eq('id', co.project_id)
      .maybeSingle()

    const signedAt = co.customer_signed_at || co.signed_at

    const pdfBuffer = await generateChangeOrderPdf({
      coNumber: co.co_number,
      date: signedAt,
      customerName: co.customer_print_name || 'Customer',
      projectAddress: project?.address_text || '',
      originalAmount: Number(co.original_amount || 0),
      updatedTotal: Number(co.updated_total || 0),
      updatedRemaining: Number(co.updated_remaining || 0),
      description: co.description || '',
      customerPrintName: co.customer_print_name || '',
      customerSignature: co.customer_signature_data || '',
      repName: co.rep_name || '',
      repSignature: co.rep_signature_data || '',
      originalContractDate: co.original_contract_date || null,
    })

    const fileName = `${String(co.co_number || 'co').replace(/-/g, '_')}_regen_${Date.now()}.pdf`
    const pdfStoragePath = `org/${co.org_id}/change-orders/${co.project_id}/${fileName}`

    const { error: uploadError } = await service.storage.from('files').upload(pdfStoragePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    })

    if (uploadError) {
      console.error('[Change Order Regenerate] upload:', uploadError)
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }

    const pdfUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/files/${pdfStoragePath}`

    const { error: updErr } = await service
      .from('job_change_orders')
      .update({ pdf_url: pdfUrl, pdf_storage_path: pdfStoragePath })
      .eq('id', co.id)

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, pdfUrl })
  } catch (e) {
    console.error('[Change Order Regenerate]', e)
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 })
  }
}
