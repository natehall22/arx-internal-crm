import type { SupabaseClient } from '@supabase/supabase-js'
import { commissionCompBaseFromPreTaxAndDealerFee } from '@/lib/commission-payroll'

export type InstallationContractSnapshot = {
  project_cost: number
  payment_method: string | null
  proposal_id: string | null
} | null

export type ResolvedProductionJobFinancials = {
  sale_amount: number | null
  dealer_fee_amount: number | null
  dealer_fee_percent: number | null
  financing_program_id: string | null
  commission_pre_tax_subtotal: number | null
  commission_comp_base: number | null
}

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

/**
 * Resolve sale + payroll snapshot when creating a production job from a project.
 * Contract total comes from change orders / installation agreement; lender/dealer fee and financing
 * program come from the linked proposal (installation PDF often omits loan details).
 */
export async function resolveProductionJobFinancials(
  adminClient: SupabaseClient,
  args: {
    orgId: string
    projectId: string
    /** Latest accepted proposal id, or null (installation agreement proposal_id is used as fallback). */
    acceptedProposalId: string | null
    installationContract: InstallationContractSnapshot
  }
): Promise<ResolvedProductionJobFinancials> {
  const { orgId, projectId, acceptedProposalId, installationContract } = args

  let proposalId = acceptedProposalId
  if (!proposalId && installationContract?.proposal_id) {
    proposalId = installationContract.proposal_id
  }

  const { data: coRows } = await adminClient
    .from('job_change_orders')
    .select('updated_total')
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })

  let saleFromCo: number | null = null
  if (coRows?.length) {
    const v = roundMoney(Number(coRows[coRows.length - 1].updated_total) || 0)
    if (v > 0) saleFromCo = v
  }

  let saleFromContract: number | null = null
  if (installationContract) {
    const v = roundMoney(Number(installationContract.project_cost) || 0)
    if (v > 0) saleFromContract = v
  }

  let proposalRow: {
    subtotal: number | string | null
    dealer_fee_amount: number | string | null
    dealer_fee_percent: number | string | null
    financing_program_id: string | null
    financed_contract_total: number | string | null
  } | null = null

  if (proposalId) {
    const { data: p } = await adminClient
      .from('proposals')
      .select(
        'subtotal, dealer_fee_amount, dealer_fee_percent, financing_program_id, financed_contract_total'
      )
      .eq('org_id', orgId)
      .eq('id', proposalId)
      .maybeSingle()
    proposalRow = p
  }

  const saleFromFinanced =
    proposalRow?.financed_contract_total != null &&
    roundMoney(Number(proposalRow.financed_contract_total)) > 0
      ? roundMoney(Number(proposalRow.financed_contract_total))
      : null

  const saleFromSubtotal =
    proposalRow?.subtotal != null && roundMoney(Number(proposalRow.subtotal)) > 0
      ? roundMoney(Number(proposalRow.subtotal))
      : null

  const sale_amount =
    saleFromCo ?? saleFromContract ?? saleFromFinanced ?? saleFromSubtotal ?? null

  const paymentMethod = installationContract?.payment_method ?? null
  const proposalFinancingProgramId = proposalRow?.financing_program_id
  const hasProposalFinancingProgram =
    proposalFinancingProgramId != null && String(proposalFinancingProgramId).trim() !== ''
  /** Installation agreement may omit payment method; proposal financing_program_id is the reliable signal. */
  const isFinance = paymentMethod === 'finance' || hasProposalFinancingProgram

  const dealer_fee_amount =
    isFinance && proposalRow?.dealer_fee_amount != null
      ? roundMoney(Number(proposalRow.dealer_fee_amount))
      : null
  const dealer_fee_percent =
    isFinance && proposalRow?.dealer_fee_percent != null
      ? Number(proposalRow.dealer_fee_percent)
      : null

  const preTax =
    proposalRow?.subtotal != null ? roundMoney(Number(proposalRow.subtotal)) : null

  const commission_pre_tax_subtotal = preTax
  const commission_comp_base =
    preTax != null
      ? commissionCompBaseFromPreTaxAndDealerFee(preTax, isFinance ? dealer_fee_amount : null)
      : null

  const financing_program_id =
    isFinance && proposalRow?.financing_program_id
      ? String(proposalRow.financing_program_id)
      : null

  return {
    sale_amount,
    dealer_fee_amount,
    dealer_fee_percent,
    financing_program_id,
    commission_pre_tax_subtotal,
    commission_comp_base,
  }
}
