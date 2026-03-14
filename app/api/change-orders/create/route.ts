import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { generateChangeOrderPdf } from '@/lib/contracts/generateChangeOrderPdf'
import nodemailer from 'nodemailer'
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
    } = body

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
    if (isSendToCustomer && !customerEmail) {
      return NextResponse.json(
        { error: 'Customer email is required to send for signature' },
        { status: 400 }
      )
    }

    const signedAt = new Date().toISOString()
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

    let signingUrl: string | null = null
    if (isSendToCustomer && signingToken && customerEmail) {
      const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin || '').replace(/\/$/, '')
      signingUrl = `${baseUrl}/change-orders/sign/${signingToken}`
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
          from: 'info@arxroofing.com',
          to: customerEmail,
          subject: `Please sign Change Order ${coNumber}`,
          text: `Hi ${customerName},\n\nYour change order is ready for signature.\n\nPlease review and sign here:\n${signingUrl}\n\nProject: ${projectAddress}\nUpdated Total: $${Number(updatedTotal || 0).toLocaleString()}\n\nIf you have questions, call 704-313-8834.\n\n- ${repName}, ARX Roofing & Exteriors`,
          html: `<p>Hi ${customerName},</p><p>Your change order is ready for signature.</p><p><a href="${signingUrl}">Review & Sign Change Order</a></p><p><strong>Project:</strong> ${projectAddress}<br/><strong>Updated Total:</strong> $${Number(updatedTotal || 0).toLocaleString()}</p><p>If you have questions, call 704-313-8834.</p><p>- ${repName}, ARX Roofing & Exteriors</p>`,
        })
      } catch (emailError) {
        console.error('[Change Order] Failed to send signing email:', emailError)
      }
    }

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
      body: isSendToCustomer
        ? `Change Order ${coNumber} created and sent for customer signature. Updated total: $${updatedTotal.toLocaleString()}`
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
