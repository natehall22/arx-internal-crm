import { NextRequest, NextResponse } from 'next/server'
import { createRemoteChangeOrder } from '@/lib/change-orders-remote'
import { requireAuthApi } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { firstForeignRef } from '@/lib/supabase/org-db'
import { completeEnvelope } from '@/lib/signing/complete'
import { consentCheck } from '@/lib/signing/consent'
import { loadSigningSettings } from '@/lib/signing/settings-server'
import { generateChangeOrderPdf } from '@/lib/contracts/generateChangeOrderPdf'
import { syncJobSaleForProjectOrJob } from '@/lib/job-commission-base'
import { getDocumentBrand } from '@/lib/org-brand'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'

export async function POST(request: NextRequest) {
  try {
    const { authUser, profile } = await requireAuthApi()
    // Field roles (setter, canvasser, inside sales, call center) never touch contract money. The remote path writes with the
    // service client, so the old field-role RLS deny (202610290020) no longer stops them: check here, before any grant.
    if (await resolveSalesDocAccessBarred(createServiceClient(), authUser.id, profile)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
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
      consent: consentInput,
    } = body

    const commissionable = isCommissionable !== false

    const isSendToCustomer = signingMode === 'send_to_customer'

    if (!projectId || !coNumber || !description || !customerPrintName || !repName || !repSignature) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }
    // The project, job and original contract are stored on the change order: all must be this company's.
    const foreign = await firstForeignRef(createServiceClient(), profile.org_id, {
      projectId: ['projects', projectId],
      jobId: ['production_jobs', jobId],
      originalContractId: ['order_form_contracts', originalContractId],
    })
    if (foreign) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    if (!isSendToCustomer && !customerSignature) {
      return NextResponse.json(
        { error: 'Customer signature is required for in-person signing' },
        { status: 400 }
      )
    }

    // Remote signature: lib/change-orders-remote.ts is the one maker (also used by approved selection overages).
    if (isSendToCustomer) {
      const remote = await createRemoteChangeOrder(createServiceClient(), {
        orgId: profile.org_id,
        createdBy: profile.id,
        projectId,
        jobId: jobId || null,
        coNumber,
        description,
        originalAmount,
        updatedTotal,
        updatedRemaining,
        customerPrintName,
        customerName,
        customerEmail: customerEmail || null,
        projectAddress,
        repName,
        repSignature,
        originalContractId: originalContractId || null,
        originalContractDate: originalContractDate || null,
        paymentMethod: paymentMethod || null,
        isCommissionable: commissionable,
        activityUserId: profile.id,
      })
      if (!remote.ok) return NextResponse.json({ error: remote.error }, { status: remote.status })
      return NextResponse.json({ success: true, changeOrderId: remote.changeOrderId, pdfUrl: null, signingUrl: remote.signingUrl })
    }

    // The e-sign notice, when the company's consent step is on: the customer agrees on the rep's device before signing, and the
    // server refuses an in-person signature without it (the same rule as the customer's own link).
    const consent = consentCheck((await loadSigningSettings(createServiceClient(), profile.org_id)).consentStep, consentInput)
    if (!consent.ok) return NextResponse.json({ error: consent.error, code: consent.code }, { status: 400 })

    const signedAt = new Date().toISOString()
    // Company identity for the PDF letterhead and the customer email.
    const documentBrand = await getDocumentBrand(createServiceClient(), profile.org_id)
    const today = new Date().toISOString().split('T')[0]

    // In-person signing: the PDF is made now (a remote change order's PDF is made when the customer signs).
    let pdfUrl: string | null = null
    let pdfStoragePath: string | null = null

    {
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
        status: 'completed',
        customer_email: customerEmail || null,
        customer_signed_at: signedAt,
        ...(consent.version ? { consent_version: consent.version, consent_at: signedAt } : {}),
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

    // Sync the job's sale amount + commission base now, only for COs that are signed immediately.
    // Remote (send_to_customer) COs aren't binding yet — that sync happens in /api/change-orders/sign
    // once the customer actually signs, so an unsigned CO can't move payroll numbers. Runs on the
    // service client: the recompute reads signed contracts + COs org-scoped, and a request-scoped
    // client could silently update zero rows under RLS.
    {
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

    // Signed in person on the rep's device: the engine records it the same way (events, SHA-256, certificate). Never blocks the CO.
    if (pdfUrl) {
      try {
        await completeEnvelope(createServiceClient(), { kind: 'change-order', docId: changeOrder.id, orgId: profile.org_id, inPerson: true })
      } catch (engineError) {
        console.error('[Change Order] signing engine completion failed:', engineError)
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
      signingUrl: null,
    })
  } catch (error) {
    console.error('[Change Order] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create change order' },
      { status: 500 }
    )
  }
}
