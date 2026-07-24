import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateChangeOrderPdf } from '@/lib/contracts/generateChangeOrderPdf'
import { applyChangeOrderToJob } from '@/lib/change-orders/apply-change-order-to-job'
import nodemailer from 'nodemailer'
import { getCrmEmailFrom } from '@/lib/crm-email-from'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getAdminClient()
    const body = await request.json()
    const token = String(body.token || '')
    const printName = String(body.printName || '').trim()
    const signature = String(body.signature || '')

    if (!token || !printName || !signature) {
      return NextResponse.json({ error: 'Token, print name, and signature are required' }, { status: 400 })
    }

    const { data: changeOrder, error: fetchError } = await supabase
      .from('job_change_orders')
      .select('*')
      .eq('signing_token', token)
      .single()

    if (fetchError || !changeOrder) {
      return NextResponse.json({ error: 'Change order not found' }, { status: 404 })
    }

    if (changeOrder.token_expires_at && new Date(changeOrder.token_expires_at) < new Date()) {
      return NextResponse.json({ error: 'Change order signing link has expired' }, { status: 400 })
    }

    if (changeOrder.status === 'completed') {
      return NextResponse.json({ error: 'Change order already signed' }, { status: 400 })
    }

    const nowIso = new Date().toISOString()

    const { error: updateError } = await supabase
      .from('job_change_orders')
      .update({
        customer_print_name: printName,
        customer_signature_data: signature,
        customer_signed_at: nowIso,
        status: 'completed',
      })
      .eq('id', changeOrder.id)

    if (updateError) {
      console.error('[Change Order Sign] update error:', updateError)
      return NextResponse.json({ error: 'Failed to sign change order' }, { status: 500 })
    }

    if (changeOrder.job_id) {
      const { error: jobSyncError } = await applyChangeOrderToJob(supabase, {
        orgId: changeOrder.org_id,
        jobId: changeOrder.job_id,
        originalAmount: Number(changeOrder.original_amount) || 0,
        updatedTotal: Number(changeOrder.updated_total) || 0,
        isCommissionable: changeOrder.is_commissionable !== false,
      })
      if (jobSyncError) {
        console.error('[Change Order Sign] job sync error:', jobSyncError)
      }
    }

    let pdfUrl: string | null = null
    let pdfStoragePath: string | null = null

    try {
      let projectAddress = ''
      const { data: project } = await supabase
        .from('projects')
        .select('address_text')
        .eq('id', changeOrder.project_id)
        .maybeSingle()
      projectAddress = project?.address_text || ''

      const pdfBuffer = await generateChangeOrderPdf({
        coNumber: changeOrder.co_number,
        date: nowIso,
        customerName: changeOrder.customer_print_name || printName,
        projectAddress,
        originalAmount: Number(changeOrder.original_amount || 0),
        updatedTotal: Number(changeOrder.updated_total || 0),
        updatedRemaining: Number(changeOrder.updated_remaining || 0),
        description: changeOrder.description || '',
        customerPrintName: printName,
        customerSignature: signature,
        repName: changeOrder.rep_name || '',
        repSignature: changeOrder.rep_signature_data || '',
        originalContractDate: changeOrder.original_contract_date || null,
      })

      const fileName = `${String(changeOrder.co_number || 'co').replace(/-/g, '_')}_${Date.now()}.pdf`
      pdfStoragePath = `org/${changeOrder.org_id}/change-orders/${changeOrder.project_id}/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('files')
        .upload(pdfStoragePath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        })

      if (!uploadError) {
        pdfUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/files/${pdfStoragePath}`
        await supabase
          .from('job_change_orders')
          .update({ pdf_url: pdfUrl, pdf_storage_path: pdfStoragePath })
          .eq('id', changeOrder.id)
      } else {
        console.error('[Change Order Sign] upload error:', uploadError)
      }
    } catch (pdfError) {
      console.error('[Change Order Sign] pdf generation error:', pdfError)
    }

    if (changeOrder.customer_email) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 587),
          secure: false,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        })

        await transporter.sendMail({
          from: getCrmEmailFrom(),
          to: changeOrder.customer_email,
          subject: `Signed Change Order ${changeOrder.co_number}`,
          text: `Thank you for signing your change order.\n\n${pdfUrl ? `Signed copy: ${pdfUrl}\n\n` : ''}ARX Roofing & Exteriors`,
          html: `<p>Thank you for signing your change order.</p>${pdfUrl ? `<p><a href="${pdfUrl}">Download signed copy</a></p>` : ''}<p>ARX Roofing & Exteriors</p>`,
        })
      } catch (emailError) {
        console.error('[Change Order Sign] email error:', emailError)
      }
    }

    return NextResponse.json({ success: true, pdfUrl })
  } catch (error) {
    console.error('[Change Order Sign] error:', error)
    return NextResponse.json({ error: 'Failed to sign change order' }, { status: 500 })
  }
}
