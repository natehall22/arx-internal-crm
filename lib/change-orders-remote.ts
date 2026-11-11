/**
 * A change order sent to the customer for remote signature — the ONE place that makes one. `POST /api/change-orders/create`
 * (the "Send to customer" choice in the Change order form) and an approved selection overage (project tools) both call it;
 * the customer signs it on the existing `/change-orders/sign/[token]` page, and `POST /api/change-orders/sign` does the rest
 * (signed PDF, sale amount + commission base sync). Nothing here changes the job's money: an unsigned change order is not
 * binding, so the sync stays in the signing route.
 */
import nodemailer from 'nodemailer'
import type { SupabaseClient } from '@supabase/supabase-js'

import { orgAppUrl } from '@/lib/company-links'
import { getCrmEmailFrom } from '@/lib/crm-email-from'
import { buildChangeOrderReadyEmail } from '@/lib/contracts/customer-emails'
import { getDocumentBrand } from '@/lib/org-brand'
import { newSigningTokenColumns } from '@/lib/signing-tokens'
import { orgDb } from '@/lib/supabase/org-db'

export type RemoteChangeOrderInput = {
  orgId: string
  createdBy: string | null
  projectId: string
  jobId: string | null
  coNumber: string
  description: string
  originalAmount: number
  updatedTotal: number
  updatedRemaining: number
  customerPrintName: string
  customerName: string
  customerEmail: string | null
  projectAddress: string
  repName: string
  /** PNG data URL of the rep's signature (drawn, or the typed name drawn on a canvas). */
  repSignature: string
  originalContractId: string | null
  originalContractDate: string | null
  paymentMethod: string | null
  isCommissionable: boolean
  /** Who the job-feed note is written as. */
  activityUserId: string | null
}

export type RemoteChangeOrderResult =
  | { ok: true; changeOrderId: string; signingUrl: string; signingToken: string; emailed: boolean }
  | { ok: false; error: string; status: number }

export async function createRemoteChangeOrder(admin: SupabaseClient, input: RemoteChangeOrderInput): Promise<RemoteChangeOrderResult> {
  const signedAt = new Date().toISOString()
  // The token goes into the link once; the row keeps its hash (and an encrypted copy for "Copy link").
  const { token: signingToken, columns: signingTokenColumns } = newSigningTokenColumns('change-order')
  const tokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const documentBrand = await getDocumentBrand(admin, input.orgId)

  // Checked before the row is written: a change order sent for signature needs a working signing link.
  const appUrl = await orgAppUrl(input.orgId)

  const db = orgDb(admin, input.orgId)
  const { data: changeOrder, error: insertError } = await db
    .from('job_change_orders')
    .insert({
      project_id: input.projectId,
      job_id: input.jobId || null,
      co_number: input.coNumber,
      original_amount: input.originalAmount,
      updated_total: input.updatedTotal,
      updated_remaining: input.updatedRemaining,
      description: input.description,
      customer_print_name: input.customerPrintName,
      customer_signature_data: '',
      rep_name: input.repName,
      rep_signature_data: input.repSignature,
      signed_at: signedAt,
      status: 'pending_customer',
      ...signingTokenColumns,
      token_expires_at: tokenExpiresAt,
      customer_email: input.customerEmail || null,
      sent_at: signedAt,
      customer_signed_at: null,
      pdf_url: null,
      pdf_storage_path: null,
      original_contract_id: input.originalContractId || null,
      original_contract_date: input.originalContractDate || null,
      payment_method: input.paymentMethod || null,
      is_commissionable: input.isCommissionable,
      created_by: input.createdBy,
    })
    .select('id')
    .single()

  if (insertError || !changeOrder) {
    console.error('[Change Order] Error inserting record:', insertError)
    // idx_job_change_orders_unique_co (project_id, co_number): the form was opened before another CO landed, so its number
    // AND its "original amount" are stale. Don't auto-renumber — that would chain the new CO off the old contract total.
    if (insertError?.code === '23505') {
      return {
        ok: false,
        status: 409,
        error: `${input.coNumber} already exists on this job — this page is out of date. Refresh the page and start the change order again so it builds on the current contract total.`,
      }
    }
    return { ok: false, status: 500, error: 'Failed to save change order' }
  }

  const signingUrl = `${appUrl}/change-orders/sign/${signingToken}`
  let emailed = false
  if (input.customerEmail) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: false,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      })
      const email = buildChangeOrderReadyEmail({
        brand: documentBrand,
        coNumber: input.coNumber,
        customerName: input.customerName,
        signingUrl,
        projectAddress: input.projectAddress,
        updatedTotal: input.updatedTotal,
        repName: input.repName,
      })
      await transporter.sendMail({ from: getCrmEmailFrom(), to: input.customerEmail, subject: email.subject, text: email.text, html: email.html })
      emailed = true
    } catch (emailError) {
      console.error('[Change Order] Failed to send signing email:', emailError)
    }
  }

  await db.from('activities').insert({
    project_id: input.projectId,
    user_id: input.activityUserId,
    type: 'status_change',
    body: emailed
      ? `Change Order ${input.coNumber} created and emailed to the customer for signature. Updated total: $${input.updatedTotal.toLocaleString()}`
      : `Change Order ${input.coNumber} created with a signing link for the customer (no email on file). Updated total: $${input.updatedTotal.toLocaleString()}`,
  })

  return { ok: true, changeOrderId: changeOrder.id as string, signingUrl, signingToken, emailed }
}
