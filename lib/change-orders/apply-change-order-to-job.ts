import type { SupabaseClient } from '@supabase/supabase-js'
import { roundMoney } from '@/lib/money'

/**
 * Applies a signed change order's dollar impact to its production job: sets sale_amount to the
 * new total, and shifts commission_pre_tax_subtotal / commission_comp_base by the same delta
 * (original_amount -> updated_total) so payroll doesn't keep computing off the pre-CO figures.
 * Only call this once a CO is actually signed/completed — not when it's merely sent for remote signature.
 */
export async function applyChangeOrderToJob(
  adminClient: SupabaseClient,
  args: {
    orgId: string
    jobId: string
    originalAmount: number
    updatedTotal: number
    /** job_change_orders.is_commissionable — non-commissionable COs must not move the comp base. */
    isCommissionable: boolean
  }
): Promise<{ error: unknown | null }> {
  const { orgId, jobId, originalAmount, updatedTotal, isCommissionable } = args

  const { data: job, error: fetchError } = await adminClient
    .from('production_jobs')
    .select('commission_pre_tax_subtotal, commission_comp_base')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (fetchError) {
    return { error: fetchError }
  }

  const updateData: Record<string, unknown> = {
    sale_amount: roundMoney(updatedTotal),
  }

  if (isCommissionable) {
    const delta = roundMoney(updatedTotal) - roundMoney(originalAmount)

    if (job?.commission_pre_tax_subtotal != null) {
      updateData.commission_pre_tax_subtotal = Math.max(
        0,
        roundMoney(Number(job.commission_pre_tax_subtotal) + delta)
      )
    }
    if (job?.commission_comp_base != null) {
      updateData.commission_comp_base = Math.max(
        0,
        roundMoney(Number(job.commission_comp_base) + delta)
      )
    }
  }

  const { error: updateError } = await adminClient
    .from('production_jobs')
    .update(updateData)
    .eq('id', jobId)
    .eq('org_id', orgId)

  return { error: updateError }
}
