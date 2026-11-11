/**
 * The approval record as a PDF (server only), rendered from the approval's SNAPSHOT — never from the live proposal — and
 * stored in the private `files` bucket as `org/<org>/quotes/<approval>.pdf`. The path goes in
 * `order_form_contracts.pdf_url` / `pdf_storage_path` (the same columns a signed contract uses), so the staff contract list,
 * the customer's token download (`customerSignedDocUrl`) and the confirmation email all link it the usual way.
 */
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import type { SupabaseClient } from '@supabase/supabase-js'

import { QuoteApprovalPDF, type QuoteApprovalPdfData } from '@/components/QuoteApprovalPDF'
import { getOrgBrand } from '@/lib/org-brand'
import type { ApprovalRow } from '@/lib/quotes/approve'

export function approvalPdfData(
  approval: Pick<ApprovalRow, 'snapshot' | 'typed_name' | 'approved_at' | 'approved_ip' | 'subtotal_cents' | 'discount_cents' | 'tax_cents' | 'total_cents' | 'deposit_cents'>,
  company: QuoteApprovalPdfData['company'],
  customer: { name: string; address: string }
): QuoteApprovalPdfData {
  const s = approval.snapshot
  // The names the customer approved (snapshot); the live proposal's only fills in for an approval made before the snapshot held them.
  const who = s.customer ?? customer
  return {
    company,
    number: s.proposalNumber,
    title: s.title,
    customerName: who.name,
    customerAddress: who.address,
    lines: s.lines.map((l) => ({ name: l.name, description: l.description ?? '', quantity: l.quantity ?? null, unit: l.unit ?? '', optional: l.optional, chosen: l.chosen, cents: l.cents })),
    subtotalCents: approval.subtotal_cents,
    discountCents: approval.discount_cents,
    taxLines: s.taxLines,
    taxCents: approval.tax_cents,
    totalCents: approval.total_cents,
    deposit: { cents: approval.deposit_cents, label: s.deposit.mode === 'percent' ? `Deposit (${s.deposit.percent}%)` : 'Deposit' },
    terms: s.terms,
    approval: { typedName: approval.typed_name, approvedAt: approval.approved_at, ip: approval.approved_ip },
  }
}

export async function renderApprovalPdf(data: QuoteApprovalPdfData): Promise<Buffer> {
  return renderToBuffer(React.createElement(QuoteApprovalPDF, { data }) as unknown as React.ReactElement)
}

/** Make + store the PDF and put its path on the contract. Safe to repeat (same path, upsert). Returns the storage path. */
export async function storeApprovalPdf(
  admin: SupabaseClient,
  orgId: string,
  approval: ApprovalRow,
  contractId: string,
  customer: { name: string; address: string }
): Promise<string> {
  const path = `org/${orgId}/quotes/${approval.id}.pdf`
  // A stored approval PDF is evidence: it is never overwritten. upsert:false makes the bucket refuse a second write; when the
  // file is already there (an earlier attempt stored it before the contract link was saved) it is reused as it is.
  const brand = await getOrgBrand(admin, orgId)
  const data = approvalPdfData(approval, { name: brand.name, phone: brand.phone ?? undefined, email: brand.email ?? undefined, address: brand.address ?? undefined }, customer)
  const buffer = await renderApprovalPdf(data)
  const { error } = await admin.storage.from('files').upload(path, buffer, { contentType: 'application/pdf', upsert: false })
  if (error && !/already exists|duplicate|resource already/i.test(`${error.message} ${(error as { statusCode?: string }).statusCode ?? ''}`)) throw new Error(`quote pdf upload: ${error.message}`)
  const { error: up } = await admin.from('order_form_contracts').update({ pdf_url: path, pdf_storage_path: path }).eq('id', contractId).eq('org_id', orgId)
  if (up) throw new Error(`quote pdf link: ${up.message}`)
  return path
}
