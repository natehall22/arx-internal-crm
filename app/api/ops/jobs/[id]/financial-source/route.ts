import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuthApi } from '@/lib/auth'
import { resolveOpsAccess } from '@/lib/ops-access'
import { commissionCompBaseFromPreTaxAndDealerFee } from '@/lib/commission-payroll'
import { computeFinancedContractTotal } from '@/lib/financing'

type PaymentMethod = 'cash' | 'finance' | 'insurance' | 'other'

function normalizeMoney(value: number | null | undefined): number {
  return Math.round((Number(value) || 0) * 100) / 100
}

type DealerFeeLineSnapshot = {
  id: string
  amount: number
  status: string
  deleted_at: string | null
  notes: string | null
  cost_type: string
}

const DEALER_FEE_DESCRIPTION = 'Lender / dealer fee'

async function loadDealerFeeSnapshot(
  adminClient: ReturnType<typeof createServiceClient>,
  orgId: string,
  jobId: string
): Promise<DealerFeeLineSnapshot[]> {
  const { data, error } = await adminClient
    .from('job_cost_lines')
    .select('id, amount, status, deleted_at, notes, cost_type')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .eq('description', DEALER_FEE_DESCRIPTION)

  if (error) {
    throw error
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    amount: Number(row.amount) || 0,
    status: row.status,
    deleted_at: row.deleted_at,
    notes: row.notes,
    cost_type: row.cost_type,
  }))
}

async function restoreDealerFeeSnapshot(
  adminClient: ReturnType<typeof createServiceClient>,
  snapshot: DealerFeeLineSnapshot[],
  snapshotIds: Set<string>,
  orgId: string,
  jobId: string
) {
  for (const row of snapshot) {
    const { error } = await adminClient
      .from('job_cost_lines')
      .update({
        amount: row.amount,
        status: row.status,
        deleted_at: row.deleted_at,
        notes: row.notes,
        cost_type: row.cost_type,
      })
      .eq('id', row.id)
    if (error) {
      console.error('[Financial Source] Dealer fee cost-line restore failed:', error)
      throw error
    }
  }

  const { data: activeRows, error: activeError } = await adminClient
    .from('job_cost_lines')
    .select('id')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .eq('description', DEALER_FEE_DESCRIPTION)
    .is('deleted_at', null)

  if (activeError) {
    throw activeError
  }

  const orphanIds = (activeRows ?? []).map((row) => row.id).filter((id) => !snapshotIds.has(id))
  if (orphanIds.length > 0) {
    const { error: archiveError } = await adminClient
      .from('job_cost_lines')
      .update({
        status: 'archived',
        deleted_at: new Date().toISOString(),
      })
      .in('id', orphanIds)
    if (archiveError) {
      throw archiveError
    }
  }
}

async function syncDealerFeeCostLine(args: {
  adminClient: ReturnType<typeof createServiceClient>
  orgId: string
  jobId: string
  userId: string
  dealerFeeAmount: number | null
}) {
  const amount = normalizeMoney(args.dealerFeeAmount)
  const description = DEALER_FEE_DESCRIPTION
  const { data: existingRows, error: lookupError } = await args.adminClient
    .from('job_cost_lines')
    .select('id, amount, deleted_at')
    .eq('org_id', args.orgId)
    .eq('job_id', args.jobId)
    .eq('description', description)
    .is('deleted_at', null)

  if (lookupError) {
    console.error('[Financial Source] Dealer fee cost-line lookup failed:', lookupError)
    throw lookupError
  }

  const rows = existingRows ?? []
  const archiveIds = async (ids: string[]) => {
    if (ids.length === 0) return
    const { error: archiveError } = await args.adminClient
      .from('job_cost_lines')
      .update({
        status: 'archived',
        deleted_at: new Date().toISOString(),
      })
      .in('id', ids)
    if (archiveError) {
      console.error('[Financial Source] Dealer fee cost-line archive failed:', archiveError)
      throw archiveError
    }
  }

  if (amount <= 0) {
    await archiveIds(rows.map((row) => row.id))
    return
  }

  const [primary, ...duplicates] = rows
  if (duplicates.length > 0) {
    await archiveIds(duplicates.map((row) => row.id))
  }

  if (primary?.id) {
    const { error: updateError } = await args.adminClient
      .from('job_cost_lines')
      .update({
        amount,
        cost_type: 'misc',
        status: 'active',
        deleted_at: null,
        notes: 'Financing lender/dealer fee synced from job financial source.',
      })
      .eq('id', primary.id)
    if (updateError) {
      console.error('[Financial Source] Dealer fee cost-line update failed:', updateError)
      throw updateError
    }
    return
  }

  const { error: insertError } = await args.adminClient
    .from('job_cost_lines')
    .insert({
      org_id: args.orgId,
      job_id: args.jobId,
      description,
      amount,
      cost_type: 'misc',
      status: 'active',
      notes: 'Financing lender/dealer fee synced from job financial source.',
      created_by: args.userId,
      // Deterministic figure synced from the job's financing terms, not a discretionary entry —
      // exempt from the manual cost-line review gate by design.
      approved: true,
    })

  if (insertError) {
    console.error('[Financial Source] Dealer fee cost-line insert failed:', insertError)
    throw insertError
  }
}

function isMissingPaymentMethodColumn(error: { message?: string; code?: string } | null): boolean {
  const msg = String(error?.message || '').toLowerCase()
  return (
    msg.includes('payment_method') &&
    (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('could not find'))
  )
}

async function updateProjectPaymentMethod(
  adminClient: ReturnType<typeof createServiceClient>,
  args: { projectId: string; orgId: string; paymentMethod: string | null }
): Promise<void> {
  const { error } = await adminClient
    .from('projects')
    .update({ payment_method: args.paymentMethod })
    .eq('id', args.projectId)
    .eq('org_id', args.orgId)

  if (error) {
    if (isMissingPaymentMethodColumn(error)) {
      console.warn(
        '[Financial Source] projects.payment_method column missing; job saved without project payment_method sync'
      )
      return
    }
    throw error
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const adminClient = createServiceClient()
    const { authUser, profile } = await requireAuthApi()
    const { canJobBoard, canViewJobFinancials } = await resolveOpsAccess(adminClient, authUser.id, profile)
    if (!canJobBoard || !canViewJobFinancials) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const paymentMethod = String(body.payment_method || '').trim() as PaymentMethod
    const proposalId = typeof body.proposal_id === 'string' && body.proposal_id.trim().length > 0
      ? body.proposal_id.trim()
      : null

    if (!['cash', 'finance', 'insurance', 'other'].includes(paymentMethod)) {
      return NextResponse.json({ error: 'Invalid payment method' }, { status: 400 })
    }

    const { data: job, error: jobError } = await adminClient
      .from('production_jobs')
      .select('id, org_id, project_id, sale_amount, linked_proposal_id, accepted_proposal_id, financing_program_id, dealer_fee_percent, dealer_fee_amount, commission_pre_tax_subtotal, commission_comp_base')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    let previousProjectPaymentMethod: string | null = null
    if (job.project_id) {
      const { data: projectRow } = await adminClient
        .from('projects')
        .select('payment_method')
        .eq('id', job.project_id)
        .eq('org_id', profile.org_id)
        .maybeSingle()
      previousProjectPaymentMethod = projectRow?.payment_method ?? null
    }

    let proposal: {
      id: string
      subtotal: number | null
      financing_program_id: string | null
      dealer_fee_percent: number | null
      dealer_fee_amount: number | null
    } | null = null

    if (proposalId) {
      const { data: proposalRow, error: proposalError } = await adminClient
        .from('proposals')
        .select('id, subtotal, financing_program_id, dealer_fee_percent, dealer_fee_amount')
        .eq('org_id', profile.org_id)
        .eq('id', proposalId)
        .maybeSingle()

      if (proposalError || !proposalRow) {
        return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
      }

      proposal = proposalRow
    }

    if (paymentMethod === 'finance' && !proposal) {
      return NextResponse.json(
        { error: 'Select the financed proposal so lender and dealer fee can sync correctly.' },
        { status: 400 }
      )
    }

    const dealerFeeSnapshot = await loadDealerFeeSnapshot(adminClient, profile.org_id, job.id)
    const dealerFeeSnapshotIds = new Set(dealerFeeSnapshot.map((row) => row.id))
    const activeDealerFeeFromCostLine =
      dealerFeeSnapshot
        .filter((row) => row.deleted_at == null && normalizeMoney(row.amount) > 0)
        .map((row) => normalizeMoney(row.amount))[0] ?? null

    const isFinance = paymentMethod === 'finance'
    const existingDealerFeeAmount =
      job.dealer_fee_amount != null && normalizeMoney(job.dealer_fee_amount) > 0
        ? normalizeMoney(job.dealer_fee_amount)
        : activeDealerFeeFromCostLine
    const existingDealerFeePercent =
      job.dealer_fee_percent != null && normalizeMoney(job.dealer_fee_percent) > 0
        ? normalizeMoney(job.dealer_fee_percent)
        : null

    let nextDealerFeeAmount = isFinance ? normalizeMoney(proposal?.dealer_fee_amount) : existingDealerFeeAmount
    let nextDealerFeePercent = isFinance ? normalizeMoney(proposal?.dealer_fee_percent) : existingDealerFeePercent
    if (
      isFinance &&
      proposal &&
      (nextDealerFeeAmount == null || nextDealerFeeAmount <= 0) &&
      proposal.subtotal != null &&
      proposal.dealer_fee_percent != null &&
      Number(proposal.dealer_fee_percent) > 0
    ) {
      const { dealerFeeAmount } = computeFinancedContractTotal(
        Number(proposal.subtotal) || 0,
        proposal.dealer_fee_percent
      )
      nextDealerFeeAmount = normalizeMoney(dealerFeeAmount)
    }
    const nextPreTaxSubtotal =
      proposal?.subtotal != null
        ? normalizeMoney(proposal.subtotal)
        : (job.commission_pre_tax_subtotal != null ? normalizeMoney(job.commission_pre_tax_subtotal) : null)
    const fallbackBase =
      nextPreTaxSubtotal != null
        ? nextPreTaxSubtotal
        : (job.sale_amount != null ? normalizeMoney(job.sale_amount) : null)
    // Cash/other: comp base uses full pre-tax total — dealer fee stays on job for COGS but not commission math.
    const dealerFeeForCompBase = isFinance ? nextDealerFeeAmount : null
    const nextCommissionBase =
      fallbackBase != null
        ? commissionCompBaseFromPreTaxAndDealerFee(fallbackBase, dealerFeeForCompBase)
        : null

    // Intentionally do not write accepted_proposal_id here — that stays the signed IA / job-packet anchor;
    // linked_proposal_id + job accounting fields are the admin override for financials.
    const updateData: Record<string, unknown> = {
      linked_proposal_id: proposalId,
      financing_program_id: isFinance ? (proposal?.financing_program_id ?? null) : null,
      dealer_fee_percent: nextDealerFeePercent,
      dealer_fee_amount: nextDealerFeeAmount,
      commission_pre_tax_subtotal: nextPreTaxSubtotal,
      commission_comp_base: nextCommissionBase,
    }

    const previousJobValues = {
      linked_proposal_id: job.linked_proposal_id ?? null,
      accepted_proposal_id: job.accepted_proposal_id ?? null,
      financing_program_id: job.financing_program_id ?? null,
      dealer_fee_percent: job.dealer_fee_percent ?? null,
      dealer_fee_amount: job.dealer_fee_amount ?? null,
      commission_pre_tax_subtotal: job.commission_pre_tax_subtotal ?? null,
      commission_comp_base: job.commission_comp_base ?? null,
    }

    const { error: updateJobError } = await adminClient
      .from('production_jobs')
      .update(updateData)
      .eq('id', job.id)
      .eq('org_id', profile.org_id)

    if (updateJobError) {
      console.error('[Financial Source] Failed updating production job:', updateJobError)
      return NextResponse.json({ error: 'Failed to update job financial source' }, { status: 500 })
    }

    try {
      if (job.project_id) {
        await updateProjectPaymentMethod(adminClient, {
          projectId: job.project_id,
          orgId: profile.org_id,
          paymentMethod,
        })
      }

      const nextFee = normalizeMoney(nextDealerFeeAmount)
      const existingFee = normalizeMoney(existingDealerFeeAmount)
      const activeCostLineFee = normalizeMoney(activeDealerFeeFromCostLine)
      // Cash: skip only when fee is unchanged AND an active cost line already matches (or no fee to sync).
      const skipDealerFeeCostLineSync =
        !isFinance &&
        nextFee === existingFee &&
        (nextFee <= 0 || (activeCostLineFee > 0 && activeCostLineFee === nextFee))

      if (!skipDealerFeeCostLineSync) {
        await syncDealerFeeCostLine({
          adminClient,
          orgId: profile.org_id,
          jobId: job.id,
          userId: authUser.id,
          dealerFeeAmount: nextDealerFeeAmount,
        })
      }
    } catch (followUpError) {
      console.error('[Financial Source] Follow-up sync failed, attempting rollback:', followUpError)

      await adminClient
        .from('production_jobs')
        .update(previousJobValues)
        .eq('id', job.id)
        .eq('org_id', profile.org_id)

      if (job.project_id) {
        await updateProjectPaymentMethod(adminClient, {
          projectId: job.project_id,
          orgId: profile.org_id,
          paymentMethod: previousProjectPaymentMethod,
        })
      }

      try {
        await restoreDealerFeeSnapshot(
          adminClient,
          dealerFeeSnapshot,
          dealerFeeSnapshotIds,
          profile.org_id,
          job.id
        )
      } catch (rollbackDealerFeeError) {
        console.error('[Financial Source] Dealer fee rollback failed:', rollbackDealerFeeError)
      }

      return NextResponse.json(
        { error: 'Could not finish syncing the financial source. No changes were saved.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      linked_proposal_id: proposalId,
      payment_method: paymentMethod,
      dealer_fee_amount: nextDealerFeeAmount,
    })
  } catch (error) {
    console.error('[Financial Source] PATCH failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
