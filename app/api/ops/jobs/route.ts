import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { importProjectReviewNoteToJob } from '@/lib/project-review'
import { canAccessJobBoard } from '@/lib/permissions'
import { opsBoardJobsSelectEmbedded } from '@/lib/ops-board-query'
import { enrichOpsJobsWithPayrollSentAt } from '@/lib/ops-payroll-enrich'
import { SALE_AGREEMENT_TYPES } from '@/lib/sales-metrics'
import {
  enrichOpsJobsWithMeasureSoldSquaresFallback,
  enrichOpsJobsWithSoldSquares,
} from '@/lib/ops-board-sold-squares'
import { resolveProductionJobFinancials } from '@/lib/resolve-production-job-sale-from-project'

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

function sanitizeJobsForRole(jobs: any[], role: string) {
  if (role === 'admin') return jobs

  return jobs.map((job) => {
    const { labor_cost, material_cost, ...safeJob } = job
    return safeJob
  })
}

// POST - Create a production job from a project
export async function POST(request: Request) {
  try {
    const supabase = createClient()
    const adminClient = createServiceClient()

    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user profile
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Check role access
    if (!['admin', 'regional_manager', 'operations', 'manager', 'sales_manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await request.json()
    const { project_id, sale_amount } = body

    if (!project_id) {
      return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
    }

    // Get the project
    const { data: project, error: projectError } = await adminClient
      .from('projects')
      .select('*, customers(id, name)')
      .eq('id', project_id)
      .eq('org_id', profile.org_id)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Check if production job already exists for this project
    const { data: existingJob } = await adminClient
      .from('production_jobs')
      .select('id, job_number')
      .eq('project_id', project_id)
      .single()

    if (existingJob) {
      return NextResponse.json({ 
        error: 'Production job already exists for this project',
        job_id: existingJob.id,
        job_number: existingJob.job_number
      }, { status: 409 })
    }

    const { data: opportunityForSource } = project.opportunity_id
      ? await adminClient
          .from('opportunities')
          .select('job_source, insurance_stage')
          .eq('id', project.opportunity_id)
          .eq('org_id', profile.org_id)
          .maybeSingle()
      : { data: null }

    let acceptedProposalId = project.project_type === 'roofing'
      ? (
          (
            await adminClient
              .from('proposals')
              .select('id')
              .eq('org_id', profile.org_id)
              .or(`project_id.eq.${project.id}${project.opportunity_id ? `,opportunity_id.eq.${project.opportunity_id}` : ''}`)
              .not('accepted_at', 'is', null)
              .order('accepted_at', { ascending: false })
              .limit(1)
              .maybeSingle()
          ).data?.id ?? null
        )
      : null

    const saleAgreementFilter =
      acceptedProposalId && project.opportunity_id
        ? `proposal_id.eq.${acceptedProposalId},opportunity_id.eq.${project.opportunity_id}`
        : acceptedProposalId
          ? `proposal_id.eq.${acceptedProposalId}`
          : project.opportunity_id
            ? `opportunity_id.eq.${project.opportunity_id}`
            : null

    const hasLegacySignedContract = Boolean(project.contract_uploaded_at || project.contract_pdf_path)

    let signedSaleAgreement: {
      id: string
      proposal_id: string | null
      project_cost: number | string | null
      payment_method: string | null
    } | null = null

    if (saleAgreementFilter) {
      const { data } = await adminClient
        .from('order_form_contracts')
        .select('id, proposal_id, project_cost, payment_method')
        .eq('org_id', profile.org_id)
        .in('agreement_type', SALE_AGREEMENT_TYPES)
        .eq('status', 'completed')
        .or(saleAgreementFilter)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      signedSaleAgreement = data ?? null
    }

    if (!signedSaleAgreement && project.address_text) {
      const { data } = await adminClient
        .from('order_form_contracts')
        .select('id, proposal_id, project_cost, payment_method')
        .eq('org_id', profile.org_id)
        .in('agreement_type', SALE_AGREEMENT_TYPES)
        .eq('status', 'completed')
        .eq('project_address', project.address_text)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      signedSaleAgreement = data ?? null
    }

    if (!signedSaleAgreement && !hasLegacySignedContract) {
      return NextResponse.json(
        { error: 'Jobs can only be pushed to the job board after a signed Installation or Repair Agreement.' },
        { status: 400 }
      )
    }

    const signedSaleAgreementProposalId = signedSaleAgreement?.proposal_id || null
    if (signedSaleAgreementProposalId) {
      acceptedProposalId = signedSaleAgreementProposalId
    }

    const saleAgreementSnapshot = signedSaleAgreement
      ? {
          project_cost: Number(signedSaleAgreement.project_cost) || 0,
          payment_method: signedSaleAgreement.payment_method ?? null,
          proposal_id: signedSaleAgreement.proposal_id ?? null,
        }
      : null

    const resolvedFinancials = await resolveProductionJobFinancials(adminClient, {
      orgId: profile.org_id,
      projectId: project_id,
      acceptedProposalId,
      installationContract: saleAgreementSnapshot,
    })

    const rawBodySale = sale_amount
    const clientProvidedSale =
      rawBodySale !== undefined &&
      rawBodySale !== null &&
      !(typeof rawBodySale === 'string' && rawBodySale.trim() === '') &&
      Number.isFinite(Number(rawBodySale))
    const finalSaleAmount = clientProvidedSale
      ? roundMoney(Number(rawBodySale))
      : resolvedFinancials.sale_amount

    // Create the production job
    const { data: newJob, error: createError } = await adminClient
      .from('production_jobs')
      .insert({
        org_id: profile.org_id,
        project_id: project.id,
        customer_id: project.customer_id,
        job_type: project.project_type || 'roofing',
        address_text: project.address_text || '',
        lat: project.lat,
        lng: project.lng,
        accepted_proposal_id: acceptedProposalId,
        salesperson_id: project.owner_user_id,
        sale_date: new Date().toISOString().split('T')[0],
        sale_amount: finalSaleAmount,
        dealer_fee_amount: resolvedFinancials.dealer_fee_amount,
        dealer_fee_percent: resolvedFinancials.dealer_fee_percent,
        financing_program_id: resolvedFinancials.financing_program_id,
        commission_pre_tax_subtotal: resolvedFinancials.commission_pre_tax_subtotal,
        commission_comp_base: resolvedFinancials.commission_comp_base,
        created_by: user.id,
        job_source: opportunityForSource?.job_source || 'retail',
        insurance_stage: opportunityForSource?.job_source === 'insurance'
          ? (opportunityForSource.insurance_stage || 'contingency_signed')
          : null,
      })
      .select()
      .single()

    if (createError) {
      console.error('Error creating production job:', createError)
      return NextResponse.json({ error: 'Failed to create production job' }, { status: 500 })
    }

    const importResult = await importProjectReviewNoteToJob(adminClient, {
      jobId: newJob.id,
      projectId: project_id,
      actorUserId: user.id,
    })
    if (!importResult.ok) {
      console.warn('Project review → job note import:', importResult.error)
    }

    // Optionally update project status
    await adminClient
      .from('projects')
      .update({ status: 'in_progress' })
      .eq('id', project_id)

    // Create activity log
    await adminClient.from('activities').insert({
      org_id: profile.org_id,
      project_id: project_id,
      user_id: user.id,
      type: 'status_change',
      body: `Project sent to Operations as Job ${newJob.job_number}`,
    })

    return NextResponse.json({ 
      success: true, 
      job: newJob,
      message: `Production job ${newJob.job_number} created successfully`
    })

  } catch (error) {
    console.error('Error in POST /api/ops/jobs:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET - List production jobs
export async function GET(request: Request) {
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

    if (!canAccessJobBoard(profile.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const crew_id = searchParams.get('crew_id')
    const date_from = searchParams.get('date_from')
    const date_to = searchParams.get('date_to')

    let query = adminClient
      .from('production_jobs')
      .select(opsBoardJobsSelectEmbedded())
      .eq('org_id', profile.org_id)
      .order('created_at', { ascending: false })

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    if (crew_id) {
      query = query.eq('assigned_crew_id', crew_id)
    }

    if (date_from) {
      query = query.gte('scheduled_date', date_from)
    }

    if (date_to) {
      query = query.lte('scheduled_date', date_to)
    }

    const { data: jobs, error } = await query

    if (error) {
      console.error('Error fetching jobs:', error)
      return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 })
    }

    const jobList = (jobs ?? []) as unknown as Array<{ id: string } & Record<string, unknown>>
    await enrichOpsJobsWithPayrollSentAt(adminClient, profile.org_id, jobList)
    await enrichOpsJobsWithSoldSquares(adminClient, profile.org_id, jobList)
    await enrichOpsJobsWithMeasureSoldSquaresFallback(adminClient, profile.org_id, jobList)
    const jobIds = jobList.map((j) => j.id)
    const collectedByJob: Record<string, number> = {}
    if (jobIds.length > 0) {
      const { data: paymentRows } = await adminClient
        .from('job_payments')
        .select('job_id, amount_cents')
        .in('job_id', jobIds)
      for (const row of paymentRows || []) {
        const jid = row.job_id as string
        collectedByJob[jid] = (collectedByJob[jid] || 0) + (row.amount_cents as number)
      }
    }

    const withPayments = jobList.map((j) => ({
      ...j,
      collected_cents: collectedByJob[j.id] || 0,
    }))

    return NextResponse.json({ jobs: sanitizeJobsForRole(withPayments, profile.role) })

  } catch (error) {
    console.error('Error in GET /api/ops/jobs:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
