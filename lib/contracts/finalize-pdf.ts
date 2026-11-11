/**
 * The signed contract's PDF, made from what the row stores — the ONE place it is made.
 *
 * A signature is saved first (the atomic claim in /api/contracts/sign), so a PDF that fails to generate or upload never
 * costs the customer their signature: the row stays `completed` with no `pdf_url` ("PDF pending") and this runs again —
 * from the customer's next tap on the same link, or the office's Generate PDF button. Running it twice is safe: the
 * result is only written while `pdf_url` is still empty, so a PDF that already exists is never replaced.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { getDocumentBrand } from '@/lib/org-brand'

export type FinalizeContractPdfResult = {
  /** Storage path of the contract's PDF (existing or just made); null when it could not be made. */
  path: string | null
  /** True only when THIS call stored the PDF. */
  created: boolean
  error: string | null
}

export async function ensureContractPdf(admin: SupabaseClient, contractId: string, orgId: string): Promise<FinalizeContractPdfResult> {
  const { data: row, error: readError } = await admin.from('order_form_contracts').select('*').eq('id', contractId).eq('org_id', orgId).maybeSingle()
  if (readError || !row) return { path: null, created: false, error: 'Contract not found' }
  const contract = row as Record<string, any>
  if (contract.status !== 'completed' && contract.status !== 'voided') {
    return { path: null, created: false, error: 'The contract is not signed yet' }
  }
  const existing = String(contract.pdf_storage_path || contract.pdf_url || '').trim()
  if (existing) return { path: existing, created: false, error: null }
  if (!contract.customer_signature_data || !contract.customer_signed_at) {
    return { path: null, created: false, error: 'The contract has no customer signature to print' }
  }

  try {
    const documentBrand = await getDocumentBrand(admin, orgId)
    // Dynamic import: @react-pdf/renderer must not load in the edge runtime.
    const { generateContractPdf } = await import('@/lib/contracts/generatePdf')
    const pdfBuffer = await generateContractPdf(contract as never, documentBrand)

    const type = contract.agreement_type || 'installation'
    const prefix = type === 'contingency' ? 'contingency' : type === 'repair' ? 'repair_agreement' : 'contract'
    const path = `org/${contract.org_id}/contracts/${prefix}_${contract.id}_${Date.now()}.pdf`

    // `files` bucket only; the path is stored, never a public URL (readers link through lib/files/files-object.ts).
    const { error: uploadError } = await admin.storage.from('files').upload(path, pdfBuffer, { contentType: 'application/pdf', upsert: false })
    if (uploadError) return { path: null, created: false, error: `Storage upload failed: ${uploadError.message}` }

    const { data: saved, error: saveError } = await admin
      .from('order_form_contracts')
      .update({ pdf_url: path, pdf_storage_path: path })
      .eq('id', contract.id)
      .eq('org_id', orgId)
      .is('pdf_url', null)
      .select('id')
    if (saveError) return { path: null, created: false, error: `Saving the PDF path failed: ${saveError.message}` }
    if (!saved || saved.length === 0) {
      // Another request finished first; its PDF is the contract's. (Ours stays in storage, unused: nothing is ever deleted.)
      const { data: current } = await admin.from('order_form_contracts').select('pdf_storage_path, pdf_url').eq('id', contract.id).eq('org_id', orgId).maybeSingle()
      const winner = String((current as any)?.pdf_storage_path || (current as any)?.pdf_url || '').trim()
      return { path: winner || path, created: false, error: null }
    }

    // The project's contract link, when the project was made before the PDF existed.
    if (contract.opportunity_id) {
      await admin
        .from('projects')
        .update({ contract_pdf_path: path, contract_uploaded_at: contract.customer_signed_at })
        .eq('org_id', contract.org_id)
        .eq('opportunity_id', contract.opportunity_id)
        .is('contract_pdf_path', null)
    }
    return { path, created: true, error: null }
  } catch (error) {
    return { path: null, created: false, error: error instanceof Error ? error.message : 'Unknown PDF generation error' }
  }
}
