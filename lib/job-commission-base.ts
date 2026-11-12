/**
 * THE one writer of a production job's sale amount and commission base.
 *
 * Owner decision (Nathan, 2026-10-22, corrected the same day): commission base = signed
 * contract total + signed change orders, EXCLUDING sales tax ONLY. The dealer (lender) fee is
 * NEVER deducted: commission and OPP are paid on the full sale amount. The sale amount itself
 * stays tax-included. It is set automatically when a contract or a change order is signed.
 * Nobody types it. Locked by a test: a dealer fee must never reduce the base.
 * Sales tax is read from the job's proposal (`proposals.tax_amount`); contracts and change
 * orders only carry the tax-included total.
 *
 * Before this, five places wrote `commission_comp_base` / `commission_pre_tax_subtotal`
 * and they disagreed: contract signing (twice — new project and existing project, both
 * from the PROPOSAL subtotal minus the dealer fee, not from the contract the customer
 * signed), the ops "Financial source" override (linked proposal subtotal minus fee),
 * the manual ops job create (`resolveProductionJobFinancials`, proposal again), and
 * `applyChangeOrderToJob` (shifted the base by the CO delta, but only when the base was
 * already non-null and only when the CO carried a job_id). The repair-contract job
 * create wrote neither. All of them now call `syncJobSaleAndCommissionBase()`.
 *
 * `commission_pre_tax_subtotal` is retired: the base is no longer a pre-tax proposal
 * figure, so the writer clears it rather than leave a number that means something else.
 *
 * Non-commissionable change orders (`job_change_orders.is_commissionable = false`) move
 * the sale amount but not the commission base — the flag existed before this change and
 * is kept. As of 2026-10-21 every CO in prod is commissionable, so base = sale amount on
 * every job.
 *
 * Time & materials jobs (`billing_mode = 'time_materials'`, lib/hourly-billing.ts; coordinator decision 2026-11-12): the
 * commission base is what was INVOICED minus its sales tax (issued job invoices' total − tax_cents; drafts and void out) — the hours billed,
 * not the estimate. The sale amount stays the signed quote (the estimate). Re-synced after hours are approved and after a
 * job invoice changes (`syncTimeAndMaterialsCommissionBase`); once the job was paid on an approved week, the difference goes
 * on the next open week as commission change lines (lib/payroll-commission-change.ts). Fixed-price jobs: unchanged.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { enqueueRecordEvent } from '@/lib/integrations'
import { roundMoney } from '@/lib/money'
import { loadJobInvoiceFacts, type JobInvoiceFacts } from '@/lib/job-invoice-tax'

/** Sale agreements: the contracts a customer pays on. A contingency carries no price. */
export const SALE_AGREEMENT_TYPES = ['installation', 'repair'] as const

/** Cents of disagreement tolerated before two money figures are called a conflict. */
const MATCH_TOLERANCE = 0.05

export type SignedContractAmount = { id: string; projectCost: number | null }

export type SignedChangeOrderAmount = {
  id: string
  originalAmount: number | null
  updatedTotal: number | null
  isCommissionable: boolean | null
  createdAt: string | null
}

export type JobSaleTotals =
  | {
      ok: true
      /** Where the starting (pre-CO) contract total came from. */
      contractSource: 'signed_contracts' | 'first_change_order'
      contractTotal: number
      changeOrdersTotal: number
      commissionableChangeOrdersTotal: number
      saleAmount: number
      salesTax: number
      commissionBase: number
    }
  | {
      ok: false
      /**
       * no_signed_contract — nothing signed to read a price from.
       * change_order_chain_conflict — the first signed CO says the contract was a different
       *   amount than the signed contracts on file. Usually a contract that was deleted by the
       *   pre-2026-09-26 signing bug (split cash/finance deals). Never guessed — a human fixes it.
       */
      reason: 'no_signed_contract' | 'change_order_chain_conflict'
      contractTotal: number | null
      firstChangeOrderOriginal: number | null
    }

function money(value: number | null | undefined): number {
  return roundMoney(Number(value) || 0)
}

/**
 * Pure: signed contract total + signed change orders. Each CO stores the running total
 * the customer signed (`original_amount` → `updated_total`), so a CO's dollar effect is
 * its delta. Summing deltas (not taking the last `updated_total`) keeps two COs that were
 * written off the same starting total from overwriting each other.
 */
export function computeJobSaleTotals(input: {
  contracts: SignedContractAmount[]
  changeOrders: SignedChangeOrderAmount[]
  /** Sales tax inside the signed total (proposal tax_amount). Default 0. */
  salesTax?: number | null
}): JobSaleTotals {
  const contractRows = input.contracts.filter((c) => money(c.projectCost) > 0)
  const changeOrders = [...input.changeOrders].sort((a, b) =>
    String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
  )
  const firstChangeOrderOriginal = changeOrders.length > 0 ? money(changeOrders[0].originalAmount) : null

  let contractTotal: number
  let contractSource: 'signed_contracts' | 'first_change_order'
  if (contractRows.length > 0) {
    contractTotal = roundMoney(contractRows.reduce((sum, c) => sum + money(c.projectCost), 0))
    contractSource = 'signed_contracts'
    if (
      firstChangeOrderOriginal != null &&
      firstChangeOrderOriginal > 0 &&
      Math.abs(firstChangeOrderOriginal - contractTotal) > MATCH_TOLERANCE
    ) {
      return { ok: false, reason: 'change_order_chain_conflict', contractTotal, firstChangeOrderOriginal }
    }
  } else if (firstChangeOrderOriginal != null && firstChangeOrderOriginal > 0) {
    // Older jobs whose contract never linked to the job but whose first signed CO states it.
    contractTotal = firstChangeOrderOriginal
    contractSource = 'first_change_order'
  } else {
    return { ok: false, reason: 'no_signed_contract', contractTotal: null, firstChangeOrderOriginal }
  }

  let changeOrdersTotal = 0
  let commissionableChangeOrdersTotal = 0
  for (const co of changeOrders) {
    const delta = money(co.updatedTotal) - money(co.originalAmount)
    changeOrdersTotal += delta
    if (co.isCommissionable !== false) commissionableChangeOrdersTotal += delta
  }
  changeOrdersTotal = roundMoney(changeOrdersTotal)
  commissionableChangeOrdersTotal = roundMoney(commissionableChangeOrdersTotal)

  const salesTax = money(input.salesTax)
  return {
    ok: true,
    contractSource,
    contractTotal,
    changeOrdersTotal,
    commissionableChangeOrdersTotal,
    saleAmount: Math.max(0, roundMoney(contractTotal + changeOrdersTotal)),
    salesTax,
    commissionBase: Math.max(0, roundMoney(contractTotal + commissionableChangeOrdersTotal - salesTax)),
  }
}

/** Pure: a time & materials job's commission base (dollars) = ISSUED invoices (not drafts, not void) − their tax, never below 0. */
export function timeAndMaterialsCommissionBase(facts: Pick<JobInvoiceFacts, 'issuedPreTaxCents'> | null | undefined): number {
  return Math.max(0, roundMoney((facts?.issuedPreTaxCents ?? 0) / 100))
}

/** Is this job billed by the hour? Before migration 202611120030 (no column) no job is. */
export async function isTimeAndMaterialsJob(admin: SupabaseClient, orgId: string, jobId: string): Promise<boolean> {
  const { data, error } = await admin.from('production_jobs').select('billing_mode').eq('id', jobId).eq('org_id', orgId).maybeSingle()
  if (error) return false
  return (data as { billing_mode?: string | null } | null)?.billing_mode === 'time_materials'
}

export type SaleJobRow = { id: string; project_id: string | null; linked_proposal_id?: string | null; accepted_proposal_id?: string | null }

/** The signed facts a sale total is built from: signed sale contracts, signed change orders, the proposal's sales tax. */
export async function loadSignedSaleInputs(
  admin: SupabaseClient,
  orgId: string,
  job: SaleJobRow
): Promise<{ contracts: SignedContractAmount[]; changeOrders: SignedChangeOrderAmount[]; salesTax: number; taxProposalId: string | null } | { error: unknown }> {
  const jobId = job.id
  let opportunityId: string | null = null
  if (job.project_id) {
    const { data: project } = await admin
      .from('projects')
      .select('opportunity_id')
      .eq('id', job.project_id)
      .eq('org_id', orgId)
      .maybeSingle()
    opportunityId = (project?.opportunity_id as string | null) ?? null
  }

  // Same anchor order as lib/job-contract.ts findJobSignedContracts: the job's proposal,
  // then its opportunity. Only signed (`completed`) sale agreements carry a price.
  const proposalId = (job.linked_proposal_id as string | null) ?? (job.accepted_proposal_id as string | null)
  const anchors: Array<[string, string]> = []
  if (proposalId) anchors.push(['proposal_id', proposalId])
  if (opportunityId) anchors.push(['opportunity_id', opportunityId])
  let contracts: SignedContractAmount[] = []
  let contractProposalId: string | null = null
  for (const [column, value] of anchors) {
    const { data, error } = await admin
      .from('order_form_contracts')
      .select('id, project_cost, proposal_id')
      .eq('org_id', orgId)
      .eq(column, value)
      .eq('status', 'completed')
      .in('agreement_type', [...SALE_AGREEMENT_TYPES])
    if (error) return { error }
    if (data && data.length > 0) {
      contracts = data.map((row) => ({ id: row.id as string, projectCost: row.project_cost as number | null }))
      contractProposalId = (data.find((row) => row.proposal_id)?.proposal_id as string | undefined) ?? null
      break
    }
  }

  // A CO saved against the project before the job existed has no job_id; it still counts.
  let coQuery = admin
    .from('job_change_orders')
    .select('id, original_amount, updated_total, is_commissionable, created_at')
    .eq('org_id', orgId)
    .eq('status', 'completed')
  coQuery = job.project_id
    ? coQuery.or(`job_id.eq.${jobId},and(job_id.is.null,project_id.eq.${job.project_id})`)
    : coQuery.eq('job_id', jobId)
  const { data: coRows, error: coError } = await coQuery
  if (coError) return { error: coError }

  // Tax comes from the job's own proposal (the one its sale amount was built from — for financed
  // deals that is the financed proposal), falling back to the signed contract's proposal.
  const taxProposalId = proposalId ?? contractProposalId
  let salesTax = 0
  if (taxProposalId) {
    const { data: proposal } = await admin
      .from('proposals')
      .select('tax_amount')
      .eq('id', taxProposalId)
      .eq('org_id', orgId)
      .maybeSingle()
    salesTax = Number(proposal?.tax_amount) || 0
  }

  return {
    contracts,
    salesTax,
    taxProposalId,
    changeOrders: (coRows || []).map((row) => ({
      id: row.id as string,
      originalAmount: row.original_amount as number | null,
      updatedTotal: row.updated_total as number | null,
      isCommissionable: row.is_commissionable as boolean | null,
      createdAt: row.created_at as string | null,
    })),
  }
}

export type CurrentContractTotal = { ok: true; total: number } | { ok: false; reason: 'job_not_found' | 'no_signed_contract' | 'change_order_chain_conflict' | 'error' }

/**
 * What the customer owes today on a fixed-price job: signed contract + SIGNED change orders (an unsent or unsigned one is not
 * binding). The ONE answer for "the running total a new change order builds on" — same inputs and chain rules as the sync above,
 * so a change order made from this number can never trip `change_order_chain_conflict` there.
 */
export async function currentContractTotal(admin: SupabaseClient, orgId: string, jobId: string): Promise<CurrentContractTotal> {
  try {
    const { data: job } = await admin
      .from('production_jobs')
      .select('id, project_id, linked_proposal_id, accepted_proposal_id')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (!job) return { ok: false, reason: 'job_not_found' }
    const inputs = await loadSignedSaleInputs(admin, orgId, job as SaleJobRow)
    if ('error' in inputs) return { ok: false, reason: 'error' }
    const totals = computeJobSaleTotals(inputs)
    return totals.ok ? { ok: true, total: totals.saleAmount } : { ok: false, reason: totals.reason }
  } catch {
    return { ok: false, reason: 'error' }
  }
}

export type SyncJobSaleResult =
  | { status: 'updated' | 'unchanged'; totals: Extract<JobSaleTotals, { ok: true }> }
  | { status: 'skipped'; totals: Extract<JobSaleTotals, { ok: false }> }
  | { status: 'error'; error: unknown }
  | { status: 'time_materials'; changed: boolean; commissionBase: number }

/**
 * Loads the job's signed sale contracts and signed change orders, computes the totals,
 * and writes `sale_amount` + `commission_comp_base` (clearing the retired
 * `commission_pre_tax_subtotal`). Call it right after a contract or change order is
 * signed. Never throws; a `skipped` result leaves the job untouched — the data-health
 * check surfaces it, and payroll will not pay a job whose base is missing.
 *
 * Requires a service-role client: contracts and change orders are read org-scoped here.
 */
export async function syncJobSaleAndCommissionBase(
  admin: SupabaseClient,
  args: { orgId: string; jobId: string }
): Promise<SyncJobSaleResult> {
  const { orgId, jobId } = args
  try {
    const { data: job, error: jobError } = await admin
      .from('production_jobs')
      .select('id, project_id, linked_proposal_id, accepted_proposal_id, sale_amount, commission_comp_base, commission_pre_tax_subtotal')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (jobError || !job) return { status: 'error', error: jobError || new Error('Job not found') }

    // Billed by the hour: the base is what was invoiced (pre-tax). The sale amount (the estimate) is left as signed.
    if (await isTimeAndMaterialsJob(admin, orgId, jobId)) {
      const commissionBase = timeAndMaterialsCommissionBase((await loadJobInvoiceFacts(admin, [jobId])).get(jobId))
      const same = job.commission_comp_base != null && roundMoney(Number(job.commission_comp_base)) === commissionBase && job.commission_pre_tax_subtotal == null
      if (same) return { status: 'time_materials', changed: false, commissionBase }
      const { error } = await admin
        .from('production_jobs')
        .update({ commission_comp_base: commissionBase, commission_pre_tax_subtotal: null })
        .eq('id', jobId)
        .eq('org_id', orgId)
      if (error) return { status: 'error', error }
      return { status: 'time_materials', changed: true, commissionBase }
    }

    const inputs = await loadSignedSaleInputs(admin, orgId, job)
    if ('error' in inputs) return { status: 'error', error: inputs.error }
    const { contracts, changeOrders, salesTax } = inputs

    const totals = computeJobSaleTotals({
      salesTax,
      contracts,
      changeOrders,
    })
    if (!totals.ok) {
      console.warn('[job-commission-base] not written', { orgId, jobId, reason: totals.reason })
      return { status: 'skipped', totals }
    }

    const unchanged =
      job.sale_amount != null &&
      roundMoney(Number(job.sale_amount)) === totals.saleAmount &&
      job.commission_comp_base != null &&
      roundMoney(Number(job.commission_comp_base)) === totals.commissionBase &&
      job.commission_pre_tax_subtotal == null
    if (unchanged) return { status: 'unchanged', totals }

    const { error: updateError } = await admin
      .from('production_jobs')
      .update({
        sale_amount: totals.saleAmount,
        commission_comp_base: totals.commissionBase,
        commission_pre_tax_subtotal: null,
      })
      .eq('id', jobId)
      .eq('org_id', orgId)
    if (updateError) return { status: 'error', error: updateError }
    // QuickBooks: the job's ONE sale invoice (a signed change order moves the same invoice). The sale amount in cents is the
    // event version, so a new total is always a new event. Never blocks the sale; the worker's sweep catches a miss.
    await enqueueRecordEvent(admin, orgId, { eventType: 'invoice.upserted', table: 'production_jobs', id: jobId, version: Math.round(totals.saleAmount * 100) })
    return { status: 'updated', totals }
  } catch (error) {
    return { status: 'error', error }
  }
}

/**
 * Same as syncJobSaleAndCommissionBase, but finds the job from its project when the caller
 * only has a project (a change order saved before the job existed, or contract signing).
 * No job yet → nothing to do; creating the job runs the sync and picks everything up.
 */
export async function syncJobSaleForProjectOrJob(
  admin: SupabaseClient,
  args: { orgId: string; jobId?: string | null; projectId?: string | null }
): Promise<SyncJobSaleResult | null> {
  let jobId = args.jobId ?? null
  if (!jobId && args.projectId) {
    const { data: job, error } = await admin
      .from('production_jobs')
      .select('id')
      .eq('org_id', args.orgId)
      .eq('project_id', args.projectId)
      .maybeSingle()
    if (error) return { status: 'error', error }
    jobId = (job?.id as string | undefined) ?? null
  }
  if (!jobId) return null
  return syncJobSaleAndCommissionBase(admin, { orgId: args.orgId, jobId })
}

/**
 * After a job's invoices change (hours approved, an invoice edited / voided / copied / made) or its billing mode changes:
 * re-sync the base — but only for a job billed by the hour (a fixed-price job's base comes from its contract and is left
 * exactly as it is). Never throws.
 */
export async function syncTimeAndMaterialsCommissionBase(admin: SupabaseClient, orgId: string, jobId: string | null | undefined): Promise<SyncJobSaleResult | null> {
  if (!jobId) return null
  try {
    if (!(await isTimeAndMaterialsJob(admin, orgId, jobId))) return null
    const r = await syncJobSaleAndCommissionBase(admin, { orgId, jobId })
    if (r.status === 'error') {
      // The base did not move, so commission change lines can't be judged: retried every morning, never only logged.
      const { markCommissionChangeRetry } = await import('@/lib/payroll-commission-change')
      await markCommissionChangeRetry(admin, orgId, jobId, r.error)
    }
    // Already paid on an approved week? The base moved since: the next open week gets the difference (never the paid week).
    // Run on every sync (not only on a change) so a run that failed before catches up; it writes nothing when in step.
    if (r.status === 'time_materials') {
      const { syncCommissionChangesForJob } = await import('@/lib/payroll-commission-change')
      // On an unexpected error it marks the job for the morning retry itself (lib/payroll-commission-change.ts).
      await syncCommissionChangesForJob(admin, orgId, jobId).catch((error) =>
        console.error('[job-commission-base] commission change lines failed (marked for retry)', { orgId, jobId, error })
      )
    }
    return r
  } catch (error) {
    // Could not even tell whether this is a T&M job (a read failed): mark it so the retry decides. A fixed-price job
    // marked this way is cleared on the retry (syncCommissionChangesForJob writes nothing for it and un-marks it).
    const { markCommissionChangeRetry } = await import('@/lib/payroll-commission-change')
    await markCommissionChangeRetry(admin, orgId, jobId, error)
    return null
  }
}
