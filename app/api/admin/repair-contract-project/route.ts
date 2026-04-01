import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import {
  ensureProductionJobForContract,
  insertProjectFromSignedContract,
  resolveCustomerIdForRepair,
  type OrderFormContractRow,
} from '@/lib/repair-order-form-project'

/**
 * POST — Admin only. Backfill a `projects` row (and `production_jobs` when missing) for a
 * won opportunity that has a completed `order_form_contracts` row but no linked project.
 *
 * Body: { opportunity_id: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { profile } = await requireAuthApi()
    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }

    const body = await request.json()
    const opportunityId = typeof body.opportunity_id === 'string' ? body.opportunity_id.trim() : ''
    if (!opportunityId) {
      return NextResponse.json({ error: 'opportunity_id is required' }, { status: 400 })
    }

    const admin = createServiceClient()

    const { data: opportunity, error: oppErr } = await admin
      .from('opportunities')
      .select('id, org_id, lead_id, customer_id, status')
      .eq('id', opportunityId)
      .eq('org_id', profile.org_id)
      .maybeSingle()

    if (oppErr || !opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    if (opportunity.status !== 'won') {
      return NextResponse.json(
        {
          error:
            'Repair is intended for won opportunities missing a project. This opportunity is not marked won.',
        },
        { status: 400 }
      )
    }

    const { data: byOpp } = await admin
      .from('projects')
      .select('id')
      .eq('org_id', profile.org_id)
      .eq('opportunity_id', opportunityId)
      .maybeSingle()

    if (byOpp?.id) {
      return NextResponse.json(
        { error: 'A project is already linked to this opportunity', project_id: byOpp.id },
        { status: 409 }
      )
    }

    const { data: contractRows, error: contractErr } = await admin
      .from('order_form_contracts')
      .select('*')
      .eq('opportunity_id', opportunityId)
      .eq('org_id', profile.org_id)
      .eq('status', 'completed')
      .order('customer_signed_at', { ascending: false, nullsFirst: false })
      .limit(1)

    if (contractErr) {
      console.error('[repair-contract-project] contract query', contractErr)
      return NextResponse.json({ error: 'Failed to load contract' }, { status: 500 })
    }

    const contract = (contractRows?.[0] ?? null) as OrderFormContractRow | null
    if (!contract) {
      return NextResponse.json(
        { error: 'No completed order form contract found for this opportunity' },
        { status: 404 }
      )
    }

    if (opportunity.lead_id) {
      const { data: leadProjects } = await admin
        .from('projects')
        .select('id, opportunity_id')
        .eq('org_id', profile.org_id)
        .eq('lead_id', opportunity.lead_id)
        .order('created_at', { ascending: false })
        .limit(1)

      const byLead = leadProjects?.[0] ?? null

      if (byLead?.id) {
        if (byLead.opportunity_id && byLead.opportunity_id !== opportunityId) {
          return NextResponse.json(
            {
              error:
                'This lead already has a project linked to a different opportunity. Resolve manually in the database.',
              conflicting_project_id: byLead.id,
              conflicting_opportunity_id: byLead.opportunity_id,
            },
            { status: 409 }
          )
        }

        await admin.from('projects').update({ opportunity_id: opportunityId }).eq('id', byLead.id)

        const customerId = await resolveCustomerIdForRepair(admin, profile.org_id, contract, opportunity)
        if (customerId) {
          await admin.from('projects').update({ customer_id: customerId }).eq('id', byLead.id)
          await admin.from('opportunities').update({ customer_id: customerId }).eq('id', opportunityId)
          await admin.from('leads').update({ customer_id: customerId }).eq('id', opportunity.lead_id)
        }

        const job = await ensureProductionJobForContract(admin, {
          orgId: profile.org_id,
          projectId: byLead.id,
          contract,
          customerId,
          actorUserId: profile.id,
        })

        await admin.from('activities').insert({
          org_id: profile.org_id,
          opportunity_id: opportunityId,
          project_id: byLead.id,
          user_id: profile.id,
          type: 'status_change',
          body: 'Admin repair: linked existing lead project to this opportunity and ensured production job.',
        })

        return NextResponse.json({
          ok: true,
          mode: 'linked',
          project_id: byLead.id,
          production_job_id: job.production_job_id,
          job_number: job.job_number,
        })
      }
    }

    const customerId = await resolveCustomerIdForRepair(admin, profile.org_id, contract, opportunity)
    const signedAt = contract.customer_signed_at || new Date().toISOString()

    const { project_id, error: insertErr } = await insertProjectFromSignedContract(admin, {
      contract,
      opportunity,
      customerId,
      signedAtIso: signedAt,
      actorUserId: profile.id,
    })

    if (insertErr || !project_id) {
      return NextResponse.json(
        { error: insertErr || 'Project insert failed', detail: insertErr },
        { status: 500 }
      )
    }

    if (customerId && opportunity.lead_id) {
      await admin.from('leads').update({ customer_id: customerId }).eq('id', opportunity.lead_id)
    }
    if (customerId) {
      await admin.from('opportunities').update({ customer_id: customerId }).eq('id', opportunityId)
    }

    await admin.from('activities').insert({
      org_id: profile.org_id,
      project_id: project_id,
      user_id: profile.id,
      type: 'status_change',
      body: 'Project created from signed contract (admin repair).',
    })

    const job = await ensureProductionJobForContract(admin, {
      orgId: profile.org_id,
      projectId: project_id,
      contract,
      customerId,
      actorUserId: profile.id,
    })

    await admin.from('activities').insert({
      org_id: profile.org_id,
      opportunity_id: opportunityId,
      project_id: project_id,
      user_id: profile.id,
      type: 'status_change',
      body: 'Admin repair: project and production job backfilled from order form contract.',
    })

    return NextResponse.json({
      ok: true,
      mode: 'created',
      project_id,
      production_job_id: job.production_job_id,
      job_number: job.job_number,
    })
  } catch (e) {
    console.error('[repair-contract-project]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unauthorized' },
      { status: e instanceof Error && e.message === 'Unauthorized' ? 401 : 500 }
    )
  }
}
