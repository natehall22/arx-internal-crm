import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Where an approval's PDF is stored, or null: the contract's pdf (a quote with one-time work) or, for a plan-only approval
 * (no contract), `quote_approvals.pdf_path`. A missing column (migration not applied) reads as "no PDF".
 */
export async function approvalPdfPath(admin: SupabaseClient, orgId: string, approval: { id: string; contract_id: string | null }): Promise<string | null> {
  if (approval.contract_id) {
    const { data } = await admin.from('order_form_contracts').select('pdf_url').eq('id', approval.contract_id).eq('org_id', orgId).maybeSingle()
    return (data as { pdf_url?: string | null } | null)?.pdf_url ?? null
  }
  const { data, error } = await admin.from('quote_approvals').select('pdf_path').eq('id', approval.id).eq('org_id', orgId).maybeSingle()
  if (error) return null
  return (data as { pdf_path?: string | null } | null)?.pdf_path ?? null
}
