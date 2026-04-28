import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { canAccessJobBoard } from '@/lib/permissions'
import { commissionCompBaseFromPreTaxAndDealerFee } from '@/lib/commission-payroll'
import { computeFinancedContractTotal } from '@/lib/financing'

type PaymentMethod = 'cash' | 'finance' | 'insurance' | 'other'

function normalizeMoney(value: number | null | undefined): number {
  return Math.round((Number(value) || 0) * 100) / 100
}

async function syncDealerFeeCostLine(args: {
  adminClient: ReturnType<typeof createServiceClient>
  orgId: string
  jobId: string
  userId: string
  dealerFeeAmount: number | null
}) {
  const amount = normalizeMoney(args.dealerFeeAmount)
  const description = 'Lender / dealer fee'
  const { data: existing, error: lookupError } = await args.adminClient
    .from('job_cost_lines')
    .select('id, amount, deleted_at')
    .eq('org_id', args.orgId)
    .eq('job_id', args.jobId)
    .eq('description', description)
    .is('deleted_at', null)
    .maybeSingle()

  if (lookupError) {
    console.error('[Financial Source] Dealer fee cost-line lookup failed:', lookupError)
    throw lookupError
  }

  if (amount <= 0) {
    if (existing?.id) {
      const { error: archiveError } = await args.adminClient
        .from('job_cost_lines')
        .update({
          status: 'archived',
          deleted_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
      if (archiveError) {
        console.error('[Financial Source] Dealer fee cost-line archive failed:', archiveError)
        throw archiveError
      }
    }
    return
  }

  if (existing?.id) {
    const { error: updateError } = await args.adminClient
      .from('job_cost_lines')
      .update({
        amount,
        cost_type: 'misc',
        status: 'active',
        deleted_at: null,
        notes: 'Financing lender/dealer fee synced from job financial source.',
      })
      .eq('id', existing.id)
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
    })

  if (insertError) {
    console.error('[Financial Source] Dealer fee cost-line insert failed:', insertError)
    throw insertError
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient()
    const adminClient = createServiceClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    if (!canAccessJobBoard(profile.role) || !['admin', 'owner'].includes(profile.role)) {
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

    const isFinance = paymentMethod === 'finance'
    let nextDealerFeeAmount = isFinance ? normalizeMoney(proposal?.dealer_fee_amount) : null
    const nextDealerFeePercent = isFinance ? normalizeMoney(proposal?.dealer_fee_percent) : null
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
    const nextCommissionBase =
      fallbackBase != null
        ? commissionCompBaseFromPreTaxAndDealerFee(fallbackBase, nextDealerFeeAmount)
        : null

    // Intentionally do not write accepted_proposal_id here — that stays the signed IA / job-packet anchor;
    // linked_proposal_id + job accounting fields are the admin override for financials.
    const updateData: Record<string, unknown> = {
      linked_proposal_id: proposalId,
      financing_program_id: isFinance ? (proposal?.financing_program_id ?? null) : null,
      dealer_fee_percent: isFinance ? nextDealerFeePercent : null,
      dealer_fee_amount: isFinance ? nextDealerFeeAmount : null,
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
        const { error: updateProjectError } = await adminClient
          .from('projects')
          .update({ payment_method: paymentMethod })
          .eq('id', job.project_id)
          .eq('org_id', profile.org_id)

        if (updateProjectError) {
          throw updateProjectError
        }
      }

      await syncDealerFeeCostLine({
        adminClient,
        orgId: profile.org_id,
        jobId: job.id,
        userId: user.id,
        dealerFeeAmount: nextDealerFeeAmount,
      })
    } catch (followUpError) {
      console.error('[Financial Source] Follow-up sync failed, attempting rollback:', followUpError)

      await adminClient
        .from('production_jobs')
        .update(previousJobValues)
        .eq('id', job.id)
        .eq('org_id', profile.org_id)

      if (job.project_id) {
        await adminClient
          .from('projects')
          .update({ payment_method: previousProjectPaymentMethod })
          .eq('id', job.project_id)
          .eq('org_id', profile.org_id)
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
