import { NextRequest, NextResponse } from 'next/server'
import { tryOrgAppUrl } from '@/lib/company-links'
import { generateChangeOrderPdf } from '@/lib/contracts/generateChangeOrderPdf'
import { syncJobSaleForProjectOrJob } from '@/lib/job-commission-base'
import { buildChangeOrderSignedEmail } from '@/lib/contracts/customer-emails'
import { getDocumentBrand } from '@/lib/org-brand'
import { createServiceClient } from '@/lib/supabase/service'
import { customerSignedDocLinkForPage, customerSignedDocUrl } from '@/lib/files/files-object'
import { CANCELLED_JOB_STATUS } from '@/lib/job-status'
import { findBySigningTokenOnThisHost } from '@/lib/signing-fence'
import { cleanPrintName, cleanSignatureImage, signingEvidence } from '@/lib/signing-input'
import { completeEnvelope, loadSignedAttachments } from '@/lib/signing/complete'
import { consentCheck } from '@/lib/signing/consent'
import { sendSigningEmail } from '@/lib/signing/mail'
import { loadSigningSettings } from '@/lib/signing/settings-server'

type AdminClient = ReturnType<typeof createServiceClient>

/** True when the change order's job is cancelled: a cancelled job takes no more work, so no more money moves on it. */
async function jobIsCancelled(
  supabase: AdminClient,
  co: { org_id: string; job_id?: string | null; project_id?: string | null }
): Promise<boolean> {
  if (!co.job_id && !co.project_id) return false
  let query = supabase.from('production_jobs').select('id, status').eq('org_id', co.org_id)
  query = co.job_id ? query.eq('id', co.job_id) : query.eq('project_id', co.project_id as string)
  const { data } = await query
  const jobs = (data ?? []) as Array<{ status: string | null }>
  return jobs.length > 0 && jobs.every((j) => j.status === CANCELLED_JOB_STATUS)
}

/** The engine's completion for a signed change order that has its PDF; never throws, never blocks the signer's answer. */
async function finishEvidence(supabase: AdminClient, co: Record<string, any>) {
  if (!String(co.pdf_storage_path || co.pdf_url || '').trim()) return
  try {
    await completeEnvelope(supabase, { kind: 'change-order', docId: String(co.id), orgId: String(co.org_id) })
  } catch (error) {
    console.error('[Change Order Sign] engine completion error:', error)
  }
}

/** Already signed: the signed result (with the copy's link when the PDF exists), not an error — a double tap lands here. */
function alreadySigned(co: { pdf_url?: string | null; pdf_storage_path?: string | null }, token: string) {
  const hasPdf = !!String(co.pdf_storage_path || co.pdf_url || '').trim()
  return NextResponse.json({
    success: true,
    alreadySigned: true,
    pdfUrl: hasPdf ? customerSignedDocLinkForPage('change-order', token) : null,
  })
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient()
    const body = await request.json()
    const token = String(body?.token || '')
    const printNameInput = String(body?.printName || '').trim()
    const signatureInput = String(body?.signature || '')

    if (!token || !printNameInput || !signatureInput) {
      return NextResponse.json({ error: 'Token, print name, and signature are required' }, { status: 400 })
    }
    const printName = cleanPrintName(printNameInput)
    if (!printName) {
      return NextResponse.json({ error: 'Please enter your printed name.' }, { status: 400 })
    }
    const signature = cleanSignatureImage(signatureInput)
    if (!signature) {
      return NextResponse.json({ error: 'Please add your signature.' }, { status: 400 })
    }

    const changeOrder = await findBySigningTokenOnThisHost(supabase, 'change-order', token)

    if (!changeOrder) {
      return NextResponse.json({ error: 'Change order not found' }, { status: 404 })
    }

    // A signing link always has an expiry: none on file is treated as expired, never as "good forever".
    if (!changeOrder.token_expires_at || new Date(changeOrder.token_expires_at) < new Date()) {
      return NextResponse.json({ error: 'Change order signing link has expired' }, { status: 400 })
    }

    if (changeOrder.status === 'completed') {
      await finishEvidence(supabase, changeOrder)
      return alreadySigned(changeOrder, token)
    }
    if (changeOrder.status !== 'pending_customer') {
      return NextResponse.json({ error: 'This change order is not open for signing' }, { status: 400 })
    }

    if (await jobIsCancelled(supabase, changeOrder as { org_id: string; job_id?: string | null; project_id?: string | null })) {
      return NextResponse.json(
        { error: 'This job has been cancelled, so this change order can no longer be signed. Please contact the company.' },
        { status: 409 }
      )
    }

    // The e-sign consent step, when the company turned it on: refused server-side without it.
    const signingSettings = await loadSigningSettings(supabase, changeOrder.org_id)
    const consent = consentCheck(signingSettings.consentStep, body?.consent)
    if (!consent.ok) {
      return NextResponse.json({ error: consent.error, code: consent.code }, { status: 400 })
    }

    const nowIso = new Date().toISOString()
    const { ip: clientIp, userAgent: clientUserAgent } = signingEvidence(request.headers)
    const documentBrand = await getDocumentBrand(supabase, changeOrder.org_id)

    // ONE request can sign: the update only matches a change order that is still waiting and whose link is still live.
    const { data: claimed, error: updateError } = await supabase
      .from('job_change_orders')
      .update({
        customer_print_name: printName,
        customer_signature_data: signature,
        customer_signed_at: nowIso,
        customer_ip: clientIp,
        customer_user_agent: clientUserAgent,
        ...(consent.version ? { consent_version: consent.version, consent_at: nowIso } : {}),
        status: 'completed',
      })
      .eq('id', changeOrder.id)
      .eq('status', 'pending_customer')
      .gt('token_expires_at', nowIso)
      .select('id')

    if (updateError) {
      console.error('[Change Order Sign] update error:', updateError)
      return NextResponse.json({ error: 'Failed to sign change order' }, { status: 500 })
    }

    if (!claimed || claimed.length === 0) {
      const { data: now } = await supabase.from('job_change_orders').select('*').eq('id', changeOrder.id).maybeSingle()
      if (now?.status === 'completed') {
        await finishEvidence(supabase, now)
        return alreadySigned(now, token)
      }
      return NextResponse.json({ error: 'This change order is not open for signing' }, { status: 409 })
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

    // The signing engine's completion: events, SHA-256, certificate, filing, copies (idempotent; retried on the customer's next tap).
    if (pdfUrl) await finishEvidence(supabase, { ...changeOrder, status: 'completed', pdf_url: pdfUrl, pdf_storage_path: pdfStoragePath })

    // The customer's link to their signed copy goes through the token route, never the bucket's public URL.
    const customerPdfUrl = pdfUrl
      ? customerSignedDocUrl('change-order', token, await tryOrgAppUrl(changeOrder.org_id, 'signed change-order link'))
      : null

    if (changeOrder.customer_email) {
      const email = buildChangeOrderSignedEmail({
        brand: documentBrand,
        coNumber: changeOrder.co_number,
        customerPdfUrl,
      })
      // The certificate rides on the customer's copy only when the company turned `emails.signedCopy` on (same subject and body).
      const attachments = await loadSignedAttachments(supabase, { kind: 'change-order', docId: changeOrder.id, orgId: changeOrder.org_id })
      await sendSigningEmail({ to: changeOrder.customer_email, subject: email.subject, text: email.text, html: email.html, attachments }, changeOrder.org_id)
    }

    return NextResponse.json({
      success: true,
      // Relative fallback: the signing page still gets its download link with no app address configured.
      pdfUrl: pdfUrl ? customerPdfUrl ?? customerSignedDocLinkForPage('change-order', token) : null,
    })
  } catch (error) {
    console.error('[Change Order Sign] error:', error)
    return NextResponse.json({ error: 'Failed to sign change order' }, { status: 500 })
  }
}
