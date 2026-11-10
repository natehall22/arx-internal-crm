import { NextRequest, NextResponse } from 'next/server'
import { tryOrgAppUrl } from '@/lib/company-links'
import { generateChangeOrderPdf } from '@/lib/contracts/generateChangeOrderPdf'
import { syncJobSaleForProjectOrJob } from '@/lib/job-commission-base'
import nodemailer from 'nodemailer'
import { getCrmEmailFrom } from '@/lib/crm-email-from'
import { buildChangeOrderSignedEmail } from '@/lib/contracts/customer-emails'
import { getDocumentBrand } from '@/lib/org-brand'
import { createServiceClient } from '@/lib/supabase/service'
import { customerSignedDocUrl } from '@/lib/files/files-object'

export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient()
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
    const documentBrand = await getDocumentBrand(supabase, changeOrder.org_id)

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

    {
      const jobSync = await syncJobSaleForProjectOrJob(supabase, {
        orgId: changeOrder.org_id,
        jobId: changeOrder.job_id ?? null,
        projectId: changeOrder.project_id ?? null,
      })
      if (jobSync?.status === 'error') {
        console.error('[Change Order Sign] job sync error:', jobSync.error)
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
      }, documentBrand)

      const fileName = `${String(changeOrder.co_number || 'co').replace(/-/g, '_')}_${Date.now()}.pdf`
      pdfStoragePath = `org/${changeOrder.org_id}/change-orders/${changeOrder.project_id}/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('files')
        .upload(pdfStoragePath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        })

      if (!uploadError) {
        // Stored as the storage path (never a public URL); readers link through lib/files/files-object.ts.
        pdfUrl = pdfStoragePath
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

    // The customer's link to their signed copy goes through the token route, never the bucket's public URL.
    const customerPdfUrl = pdfUrl
      ? customerSignedDocUrl('change-order', String(changeOrder.signing_token), await tryOrgAppUrl(supabase, changeOrder.org_id, 'signed change-order link'))
      : null

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

        const email = buildChangeOrderSignedEmail({
          brand: documentBrand,
          coNumber: changeOrder.co_number,
          customerPdfUrl,
        })
        await transporter.sendMail({
          from: getCrmEmailFrom(),
          to: changeOrder.customer_email,
          subject: email.subject,
          text: email.text,
          html: email.html,
        })
      } catch (emailError) {
        console.error('[Change Order Sign] email error:', emailError)
      }
    }

    return NextResponse.json({ success: true, pdfUrl: customerPdfUrl })
  } catch (error) {
    console.error('[Change Order Sign] error:', error)
    return NextResponse.json({ error: 'Failed to sign change order' }, { status: 500 })
  }
}
