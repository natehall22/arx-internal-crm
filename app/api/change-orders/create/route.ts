import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { generateChangeOrderPdf } from '@/lib/contracts/generateChangeOrderPdf'
import { syncJobSaleForProjectOrJob } from '@/lib/job-commission-base'
import nodemailer from 'nodemailer'
import { getCrmEmailFrom } from '@/lib/crm-email-from'
import { buildChangeOrderReadyEmail } from '@/lib/contracts/customer-emails'
import { getDocumentBrand } from '@/lib/org-brand'
import crypto from 'crypto'

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
      customerEmail,
      projectAddress,
      signingMode,
      isCommissionable,
    } = body

    const commissionable = isCommissionable !== false

    const isSendToCustomer = signingMode === 'send_to_customer'

    if (!projectId || !coNumber || !description || !customerPrintName || !repName || !repSignature) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }
    if (!isSendToCustomer && !customerSignature) {
      return NextResponse.json(
        { error: 'Customer signature is required for in-person signing' },
        { status: 400 }
      )
    }

    const signedAt = new Date().toISOString()
    // Company identity for the PDF letterhead and the customer email.
    const documentBrand = await getDocumentBrand(createServiceClient(), profile.org_id)
    const today = new Date().toISOString().split('T')[0]

    // Generate PDF for in-person mode only.
    let pdfUrl: string | null = null
    let pdfStoragePath: string | null = null
    let signingToken: string | null = null
    let tokenExpiresAt: string | null = null

    if (!isSendToCustomer) {
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
        customerSignature: customerSignature || '',
        repName,
        repSignature,
        originalContractDate,
      }, documentBrand)

      console.log('[Change Order] PDF generated, size:', pdfBuffer.length, 'bytes')

      // Storage RLS only allows paths under org/{org_id}/... (see 003_storage_buckets.sql).
      // User-scoped client uploads to change-orders/... fail silently; use service role + org path.
      const fileName = `${coNumber.replace(/-/g, '_')}_${Date.now()}.pdf`
      pdfStoragePath = `org/${profile.org_id}/change-orders/${projectId}/${fileName}`

      const serviceSupabase = createServiceClient()
      const { error: uploadError } = await serviceSupabase.storage
        .from('files')
        .upload(pdfStoragePath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        })

      if (uploadError) {
        console.error('[Change Order] Error uploading PDF:', uploadError.message)
      } else {
        // Stored as the storage path (never a public URL); readers link through lib/files/files-object.ts.
        pdfUrl = pdfStoragePath
        console.log('[Change Order] PDF uploaded:', pdfUrl)
      }
      } catch (pdfError: any) {
        console.error('[Change Order] PDF generation failed:', pdfError?.message || pdfError)
      }
    } else {
      signingToken = crypto.randomBytes(32).toString('hex')
      tokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
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
        customer_signature_data: isSendToCustomer ? '' : customerSignature,
        rep_name: repName,
        rep_signature_data: repSignature,
        signed_at: signedAt,
        status: isSendToCustomer ? 'pending_customer' : 'completed',
        signing_token: signingToken,
        token_expires_at: tokenExpiresAt,
        customer_email: customerEmail || null,
        sent_at: isSendToCustomer ? signedAt : null,
        customer_signed_at: isSendToCustomer ? null : signedAt,
        pdf_url: pdfUrl,
        pdf_storage_path: pdfStoragePath,
        original_contract_id: originalContractId || null,
        original_contract_date: originalContractDate || null,
        payment_method: paymentMethod || null,
        is_commissionable: commissionable,
        created_by: profile.id,
      })
      .select('id')
      .single()

    if (insertError) {
      console.error('[Change Order] Error inserting record:', insertError)
      // idx_job_change_orders_unique_co (project_id, co_number): the form was opened before
      // another CO landed, so its number AND its "original amount" are stale. Don't auto-renumber —
      // that would chain the new CO off the old contract total. Make them reload instead.
      if (insertError.code === '23505') {
        return NextResponse.json(
          {
            error: `${coNumber} already exists on this job — this page is out of date. Refresh the page and start the change order again so it builds on the current contract total.`,
          },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { error: 'Failed to save change order' },
        { status: 500 }
      )
    }

    console.log('[Change Order] Record created:', changeOrder.id)

    let signingUrl: string | null = null
    if (isSendToCustomer && signingToken) {
      const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin || '').replace(/\/$/, '')
      signingUrl = `${baseUrl}/change-orders/sign/${signingToken}`
    }
    if (isSendToCustomer && signingUrl && customerEmail) {
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

        const email = buildChangeOrderReadyEmail({
          brand: documentBrand,
          coNumber,
          customerName,
          signingUrl,
          projectAddress,
          updatedTotal,
          repName,
        })
        await transporter.sendMail({
          from: getCrmEmailFrom(),
          to: customerEmail,
          subject: email.subject,
          text: email.text,
          html: email.html,
        })
      } catch (emailError) {
        console.error('[Change Order] Failed to send signing email:', emailError)
      }
    }

    // Sync the job's sale amount + commission base now, only for COs that are signed immediately.
    // Remote (send_to_customer) COs aren't binding yet — that sync happens in /api/change-orders/sign
    // once the customer actually signs, so an unsigned CO can't move payroll numbers. Runs on the
    // service client: the recompute reads signed contracts + COs org-scoped, and a request-scoped
    // client could silently update zero rows under RLS.
    if (!isSendToCustomer) {
      const result = await syncJobSaleForProjectOrJob(createServiceClient(), {
        orgId: profile.org_id,
        jobId: jobId || null,
        projectId,
      })

      if (result?.status === 'error') {
        console.error('[Change Order] Error syncing job financials:', result.error)
      } else if (result?.status === 'skipped') {
        console.warn('[Change Order] Job sale amount not updated:', result.totals.reason)
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
      body: isSendToCustomer
        ? customerEmail
          ? `Change Order ${coNumber} created and emailed to the customer for signature. Updated total: $${updatedTotal.toLocaleString()}`
          : `Change Order ${coNumber} created with a signing link for the customer (no email on file). Updated total: $${updatedTotal.toLocaleString()}`
        : `Change Order ${coNumber} created. Updated total: $${updatedTotal.toLocaleString()}`,
    })

    return NextResponse.json({
      success: true,
      changeOrderId: changeOrder.id,
      pdfUrl,
      signingUrl,
    })
  } catch (error) {
    console.error('[Change Order] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create change order' },
      { status: 500 }
    )
  }
}
