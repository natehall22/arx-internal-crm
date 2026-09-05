export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { notFound, redirect } from 'next/navigation'
import JobDetailClient from './JobDetailClient'
import { canAccessJobBilling } from '@/lib/finance-access'
import { redactProductionJobFinancialSummaryFields, resolveOpsAccess } from '@/lib/ops-access'
import { isOrgSuperuserRoleSlug } from '@/lib/permissions'
import { buildJobSoldScope, type JobSoldScope } from '@/lib/job-sold-scope'
import {
  resolveMaterialsCoverageOverrides,
  type MaterialsCoverageOverrides,
} from '@/lib/materials-coverage-overrides'

interface PageProps {
  params: { id: string }
}

type FinancialSourceProposalOption = {
  id: string
  proposal_number: string | null
  financing_lender_name: string | null
  financing_term_months: number | null
  financing_rate: number | null
  dealer_fee_percent: number | null
  dealer_fee_amount: number | null
  subtotal: number | null
  accepted_at: string | null
  updated_at: string | null
}

const jobSelectWithPaymentMethod = `
  *,
  assigned_crew:crews(id, name, color, phone),
  assigned_sub:sub_contractors(id, company_name, contact_name, phone),
  customer:customers(id, name, phone, email),
  salesperson:users!production_jobs_salesperson_id_fkey(id, full_name),
  project:projects(id, opportunity_id, scope_of_work, product_summary, ops_notes, permits_status, install_date, project_review, payment_method, sold_roof_squares, customers(id, name, phone, email), leads(id, homeowner_name, phone, email))
`

const jobSelectWithoutPaymentMethod = `
  *,
  assigned_crew:crews(id, name, color, phone),
  assigned_sub:sub_contractors(id, company_name, contact_name, phone),
  customer:customers(id, name, phone, email),
  salesperson:users!production_jobs_salesperson_id_fkey(id, full_name),
  project:projects(id, opportunity_id, scope_of_work, product_summary, ops_notes, permits_status, install_date, project_review, sold_roof_squares, customers(id, name, phone, email), leads(id, homeowner_name, phone, email))
`

export default async function JobDetailPage({ params }: PageProps) {
  const { authUser, profile } = await requireAuth()
  const admin = createServiceClient()
  const { canJobBoard, canViewJobFinancials, canDeleteProductionJob } = await resolveOpsAccess(
    admin,
    authUser.id,
    profile
  )
  if (!canJobBoard) {
    redirect('/dashboard')
  }

  /** Matches PATCH /financial-source RBAC once user can reach this page with job-board access */
  const canEditFinancialSource = canViewJobFinancials
  const supabase = createClient()

  const customRole = profile.custom_role_id
    ? (await supabase
        .from('custom_roles')
        .select('name, display_name')
        .eq('id', profile.custom_role_id)
        .single()).data
    : null

  const canViewJobBilling = canAccessJobBilling({
    role: profile.role,
    customRoleName: customRole?.name,
    customRoleDisplayName: customRole?.display_name,
  })

  const jobQueryWithPaymentMethod = supabase
    .from('production_jobs')
    .select(jobSelectWithPaymentMethod)
    .eq('id', params.id)
    .eq('org_id', profile.org_id)
    .single()

  const jobResWithPaymentMethod = await jobQueryWithPaymentMethod
  const shouldFallbackToLegacyProjectShape = !!jobResWithPaymentMethod.error

  const jobResult = shouldFallbackToLegacyProjectShape
    ? await supabase
        .from('production_jobs')
        .select(jobSelectWithoutPaymentMethod)
        .eq('id', params.id)
        .eq('org_id', profile.org_id)
        .single()
    : jobResWithPaymentMethod

  const [jobRes, crewsRes, subsRes, orgCoverageRes] = await Promise.all([
    Promise.resolve(jobResult),
    supabase
      .from('crews')
      .select('id, name, crew_type, color, daily_capacity')
      .eq('org_id', profile.org_id)
      .eq('active', true),
    supabase
      .from('sub_contractors')
      .select('id, company_name, services')
      .eq('org_id', profile.org_id)
      .eq('active', true),
    supabase
      .from('orgs')
      .select(
        'starter_lf_per_bundle, cap_lf_per_bundle, underlayment_sq_per_roll, ridge_vent_lf_per_piece, ridge_vent_end_setback_ft, ice_water_lf_per_roll'
      )
      .eq('id', profile.org_id)
      .maybeSingle(),
  ])

  if (!jobRes.data) {
    notFound()
  }

  const rawProject = Array.isArray(jobRes.data.project) ? jobRes.data.project[0] : jobRes.data.project
  const rawCustomer = Array.isArray(jobRes.data.customer) ? jobRes.data.customer[0] : jobRes.data.customer
  
  // Try to get customer from: 1) direct customer link, 2) project's customer, 3) project's lead
  let customer = rawCustomer
  if (!customer && rawProject) {
    const projectCustomer = Array.isArray(rawProject.customers) ? rawProject.customers[0] : rawProject.customers
    const projectLead = Array.isArray(rawProject.leads) ? rawProject.leads[0] : rawProject.leads
    
    if (projectCustomer) {
      customer = projectCustomer
    } else if (projectLead) {
      customer = {
        id: projectLead.id,
        name: projectLead.homeowner_name,
        phone: projectLead.phone,
        email: projectLead.email,
      }
    }
  }

  // Find the opportunity_id for this job - needed to find accepted proposals
  let opportunityId: string | null = null
  // Also track the signed sale agreement PDF URL
  let installationAgreement: { pdf_url: string | null; status: string; agreement_type?: string | null } | null = null
  
  if (jobRes.data.project_id) {
    // Check order_form_contracts for the opportunity that created this project
    try {
      const { data: contracts } = await supabase
        .from('order_form_contracts')
        .select('opportunity_id, pdf_url, status, agreement_type')
        .eq('status', 'completed')
        .in('agreement_type', ['installation', 'repair'])
        .not('opportunity_id', 'is', null)
      
      if (contracts && contracts.length > 0) {
        // Find which contract's opportunity matches this job's address
        for (const contract of contracts) {
          if (contract.opportunity_id) {
            const { data: opp } = await supabase
              .from('opportunities')
              .select('id, address_text')
              .eq('id', contract.opportunity_id)
              .single()
            
            if (opp && opp.address_text === jobRes.data.address_text) {
              opportunityId = opp.id
              // Found the matching contract - store the PDF URL
              installationAgreement = {
                pdf_url: contract.pdf_url,
                status: contract.status,
                agreement_type: contract.agreement_type,
              }
              break
            }
          }
        }
      }
    } catch (e) {
      // order_form_contracts table might not exist
    }
    
    // Fallback: Find opportunity by matching address
    if (!opportunityId && jobRes.data.address_text) {
      const { data: opportunities } = await supabase
        .from('opportunities')
        .select('id')
        .eq('org_id', profile.org_id)
        .eq('address_text', jobRes.data.address_text)
        .limit(1)
      
      if (opportunities && opportunities.length > 0) {
        opportunityId = opportunities[0].id
        
        // Also try to get the signed sale agreement for this opportunity
        if (!installationAgreement) {
          try {
            const { data: contractData } = await supabase
              .from('order_form_contracts')
              .select('pdf_url, status, agreement_type')
              .eq('opportunity_id', opportunityId)
              .eq('status', 'completed')
              .in('agreement_type', ['installation', 'repair'])
              .order('created_at', { ascending: false })
              .limit(1)
            
            if (contractData && contractData.length > 0) {
              installationAgreement = {
                pdf_url: contractData[0].pdf_url,
                status: contractData[0].status,
                agreement_type: contractData[0].agreement_type,
              }
            }
          } catch (e) {
            // Ignore errors
          }
        }
      }
    }
  }

  const supabaseService = createServiceClient()

  // Original contract + change orders (same sources as /projects/[id])
  let originalContract: {
    id: string
    project_cost: number
    created_at: string
    payment_method: string | null
  } | null = null
  let changeOrders: {
    id: string
    co_number: string
    signed_at: string
    customer_signed_at: string | null
    updated_total: number
    pdf_url: string | null
    status: string
    signing_token: string | null
  }[] = []
  let amountCollected = 0

  if (jobRes.data.address_text) {
    try {
      const { data: contractByAddress } = await supabaseService
        .from('order_form_contracts')
        .select('id, project_cost, created_at, payment_method')
        .eq('org_id', profile.org_id)
        .eq('project_address', jobRes.data.address_text)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1)

      if (contractByAddress && contractByAddress.length > 0) {
        originalContract = contractByAddress[0]
      }

      if (!originalContract) {
        const { data: opportunities } = await supabaseService
          .from('opportunities')
          .select('id')
          .eq('org_id', profile.org_id)
          .eq('address_text', jobRes.data.address_text)
          .limit(1)

        if (opportunities && opportunities.length > 0) {
          const { data: contractByOpp } = await supabaseService
            .from('order_form_contracts')
            .select('id, project_cost, created_at, payment_method')
            .eq('opportunity_id', opportunities[0].id)
            .eq('status', 'completed')
            .order('created_at', { ascending: false })
            .limit(1)

          if (contractByOpp && contractByOpp.length > 0) {
            originalContract = contractByOpp[0]
          }
        }
      }
    } catch {
      // order_form_contracts may be unavailable
    }
  }

  if (jobRes.data.project_id) {
    try {
      const { data: coData } = await supabaseService
        .from('job_change_orders')
        .select(
          'id, co_number, signed_at, updated_total, pdf_url, status, signing_token, customer_signed_at'
        )
        .eq('org_id', profile.org_id)
        .eq('project_id', jobRes.data.project_id)
        .order('created_at', { ascending: true })

      if (coData) {
        changeOrders = coData as typeof changeOrders
      }
    } catch {
      // ignore
    }

    try {
      const { data: payments } = await supabaseService
        .from('job_payments')
        .select('amount_cents')
        .eq('job_id', jobRes.data.id)

      if (payments) {
        amountCollected = payments.reduce((sum, p) => sum + (p.amount_cents || 0), 0) / 100
      }
    } catch {
      // ignore
    }
  }

  const projectCustomer = rawProject
    ? (Array.isArray(rawProject.customers) ? rawProject.customers[0] : rawProject.customers)
    : null
  const projectLead = rawProject
    ? (Array.isArray(rawProject.leads) ? rawProject.leads[0] : rawProject.leads)
    : null
  const customerName =
    customer?.name || projectCustomer?.name || projectLead?.homeowner_name || 'Customer'
  const customerEmail = customer?.email || projectCustomer?.email || projectLead?.email || null

  const currentContractTotal =
    changeOrders.length > 0
      ? changeOrders[changeOrders.length - 1].updated_total
      : (originalContract?.project_cost ?? jobRes.data.sale_amount ?? 0)

  const showChangeOrdersSection = Boolean(
    jobRes.data.project_id && (originalContract || jobRes.data.sale_amount != null)
  )

  // Financing metadata can live on proposal even when the job has core numbers already synced.
  let proposalFinancing:
    | {
        dealer_fee_amount: number | null
        dealer_fee_percent: number | null
        financing_program_id: string | null
        financing_lender_name: string | null
        financed_contract_total: number | null
        financing_term_months: number | null
        financing_rate: number | null
      }
    | undefined
  const jobRow = jobRes.data
  const missingDealerFeeOnJob =
    jobRow.dealer_fee_amount == null || Number(jobRow.dealer_fee_amount) === 0
  const explicitProposalId = jobRow.linked_proposal_id || jobRow.accepted_proposal_id || null
  const explicitPaymentMethod = jobRow.project?.payment_method || null
  const shouldTreatAsFinance =
    explicitPaymentMethod === 'finance' ||
    (explicitPaymentMethod == null && Boolean(jobRow.financing_program_id))
  const projectOppId =
    rawProject && typeof rawProject === 'object' && 'opportunity_id' in rawProject
      ? (rawProject as { opportunity_id?: string | null }).opportunity_id
      : null
  const resolvedOppId = opportunityId || projectOppId || null
  const shouldLoadProposalFinancing =
    shouldTreatAsFinance && (missingDealerFeeOnJob || Boolean(jobRow.financing_program_id) || explicitProposalId != null)
  if (shouldLoadProposalFinancing) {
    try {
      if (explicitProposalId) {
        const { data: prop } = await supabaseService
          .from('proposals')
          .select('dealer_fee_amount, dealer_fee_percent, financing_program_id, financing_lender_name, financed_contract_total, financing_term_months, financing_rate')
          .eq('org_id', profile.org_id)
          .eq('id', explicitProposalId)
          .maybeSingle()
        if (prop) proposalFinancing = prop
      }
      if (!proposalFinancing && !explicitProposalId && resolvedOppId) {
        const { data: prop } = await supabaseService
          .from('proposals')
          .select('dealer_fee_amount, dealer_fee_percent, financing_program_id, financing_lender_name, financed_contract_total, financing_term_months, financing_rate')
          .eq('org_id', profile.org_id)
          .eq('opportunity_id', resolvedOppId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (prop) proposalFinancing = prop
      }
      if (!proposalFinancing && !explicitProposalId && jobRow.project_id) {
        const { data: prop } = await supabaseService
          .from('proposals')
          .select('dealer_fee_amount, dealer_fee_percent, financing_program_id, financing_lender_name, financed_contract_total, financing_term_months, financing_rate')
          .eq('org_id', profile.org_id)
          .eq('project_id', jobRow.project_id)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (prop) proposalFinancing = prop
      }
    } catch {
      // proposals table / RLS
    }
  }

  let payrollAttribution: {
    opportunity_id: string
    setter_user_id: string | null
    closer_user_id: string | null
    setter_name: string | null
    closer_name: string | null
  } | null = null

  if (resolvedOppId) {
    const { data: opp } = await supabaseService
      .from('opportunities')
      .select('setter_user_id, owner_user_id')
      .eq('id', resolvedOppId)
      .eq('org_id', profile.org_id)
      .maybeSingle()

    if (opp) {
      const setterId = opp.setter_user_id ?? null
      const closerId = opp.owner_user_id ?? null
      const ids = [setterId, closerId].filter((x): x is string => typeof x === 'string')
      const nameById = new Map<string, string>()
      if (ids.length > 0) {
        const { data: nameRows } = await supabaseService
          .from('users')
          .select('id, full_name')
          .eq('org_id', profile.org_id)
          .in('id', ids)
        for (const u of nameRows || []) {
          nameById.set(u.id, u.full_name || u.id)
        }
      }
      payrollAttribution = {
        opportunity_id: resolvedOppId,
        setter_user_id: setterId,
        closer_user_id: closerId,
        setter_name: setterId ? nameById.get(setterId) || null : null,
        closer_name: closerId ? nameById.get(closerId) || null : null,
      }
    }
  }

  // Customer-facing roof report (photo documentation PDF), if the field rep built one on the opportunity.
  let roofReport: { id: string; pdf_generated_at: string | null } | null = null
  if (resolvedOppId) {
    const { data: report } = await supabaseService
      .from('inspection_reports')
      .select('id, pdf_generated_at')
      .eq('opportunity_id', resolvedOppId)
      .eq('org_id', profile.org_id)
      .not('pdf_generated_at', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    roofReport = report ?? null
  }

  let soldScope: JobSoldScope | null = null
  let financialSourceProposalOptions: FinancialSourceProposalOption[] = []

  if (canEditFinancialSource) {
    try {
      const proposalMap = new Map<string, FinancialSourceProposalOption>()
      const selectColumns =
        'id, proposal_number, financing_lender_name, financing_term_months, financing_rate, dealer_fee_percent, dealer_fee_amount, subtotal, accepted_at, updated_at'

      if (resolvedOppId) {
        const { data: opportunityProposals } = await supabaseService
          .from('proposals')
          .select(selectColumns)
          .eq('org_id', profile.org_id)
          .eq('opportunity_id', resolvedOppId)
          .order('updated_at', { ascending: false })
        for (const proposal of opportunityProposals || []) {
          proposalMap.set(proposal.id, proposal)
        }
      }

      if (jobRow.project_id) {
        const { data: projectProposals } = await supabaseService
          .from('proposals')
          .select(selectColumns)
          .eq('org_id', profile.org_id)
          .eq('project_id', jobRow.project_id)
          .order('updated_at', { ascending: false })
        for (const proposal of projectProposals || []) {
          proposalMap.set(proposal.id, proposal)
        }
      }

      if (explicitProposalId && !proposalMap.has(explicitProposalId)) {
        const { data: explicitProposal } = await supabaseService
          .from('proposals')
          .select(selectColumns)
          .eq('org_id', profile.org_id)
          .eq('id', explicitProposalId)
          .maybeSingle()
        if (explicitProposal) {
          proposalMap.set(explicitProposal.id, explicitProposal)
        }
      }

      financialSourceProposalOptions = Array.from(proposalMap.values()).sort((a, b) => {
        const left = new Date(a.accepted_at || a.updated_at || 0).getTime()
        const right = new Date(b.accepted_at || b.updated_at || 0).getTime()
        return right - left
      })
    } catch {
      financialSourceProposalOptions = []
    }
  }

  try {
    soldScope = await buildJobSoldScope({
      admin: supabaseService,
      orgId: profile.org_id,
      job: jobRes.data,
      // This page resolves the opportunity from the signed contract / address match before
      // falling back to the project, which is richer than the shared default chain.
      opportunityId: resolvedOppId,
    })
  } catch {
    soldScope = null
  }

  const transformedJob = redactProductionJobFinancialSummaryFields(
    {
      ...jobRes.data,
      collected_cents: Math.round(amountCollected * 100),
      dealer_fee_amount: shouldTreatAsFinance
        ? (proposalFinancing?.dealer_fee_amount ?? jobRes.data.dealer_fee_amount)
        : jobRes.data.dealer_fee_amount,
      dealer_fee_percent: shouldTreatAsFinance
        ? (proposalFinancing?.dealer_fee_percent ?? jobRes.data.dealer_fee_percent)
        : jobRes.data.dealer_fee_percent,
      financing_program_id: shouldTreatAsFinance
        ? (proposalFinancing?.financing_program_id ?? jobRes.data.financing_program_id)
        : null,
      financing_lender_name: shouldTreatAsFinance ? (proposalFinancing?.financing_lender_name ?? null) : null,
      financed_contract_total: shouldTreatAsFinance ? (proposalFinancing?.financed_contract_total ?? null) : null,
      financing_term_months: shouldTreatAsFinance ? (proposalFinancing?.financing_term_months ?? null) : null,
      financing_rate: shouldTreatAsFinance ? (proposalFinancing?.financing_rate ?? null) : null,
      assigned_crew: Array.isArray(jobRes.data.assigned_crew) ? jobRes.data.assigned_crew[0] : jobRes.data.assigned_crew,
      assigned_sub: Array.isArray(jobRes.data.assigned_sub) ? jobRes.data.assigned_sub[0] : jobRes.data.assigned_sub,
      customer: customer,
      salesperson: Array.isArray(jobRes.data.salesperson) ? jobRes.data.salesperson[0] : jobRes.data.salesperson,
      project: rawProject,
      opportunity_id: resolvedOppId,
      installation_agreement: installationAgreement,
      payroll_attribution: payrollAttribution,
      roof_report: roofReport,
      sold_scope: soldScope,
    } as Record<string, unknown>,
    canViewJobFinancials
  )

  const canEditPayrollAttribution =
    isOrgSuperuserRoleSlug(profile.role) || profile.role === 'operations'

  const materialsCoverageOverrides: MaterialsCoverageOverrides = resolveMaterialsCoverageOverrides(
    orgCoverageRes.data
  )

  /**
   * Payment method for the top-of-job stripe. `projects.payment_method` wins because that is what
   * the "Edit source" control writes — otherwise changing the source would not move the stripe.
   * It is null on most rows today, so the signed contract is the real fallback. Deliberately
   * resolves to null rather than assuming cash: a wrong stripe is worse than an honest blank.
   */
  const resolvedPaymentMethod: string | null =
    (rawProject && typeof rawProject === 'object' && 'payment_method' in rawProject
      ? (rawProject as { payment_method?: string | null }).payment_method ?? null
      : null) ??
    originalContract?.payment_method ??
    (jobRes.data.financing_program_id ? 'finance' : null)

  return (
    <JobDetailClient
      initialJob={transformedJob as any}
      paymentMethod={resolvedPaymentMethod}
      materialsCoverageOverrides={materialsCoverageOverrides}
      crews={crewsRes.data || []}
      subs={subsRes.data || []}
      userRole={profile.role}
      canViewProfitability={canViewJobFinancials}
      canDeleteProductionJob={canDeleteProductionJob}
      canViewJobBilling={canViewJobBilling}
      canEditPayrollAttribution={canEditPayrollAttribution}
      canEditFinancialSource={canEditFinancialSource}
      financialSourceProposalOptions={financialSourceProposalOptions}
      changeOrdersSection={
        showChangeOrdersSection
          ? {
              projectId: jobRes.data.project_id,
              projectAddress: jobRes.data.address_text || '',
              customerName,
              customerEmail,
              originalContractAmount: currentContractTotal,
              originalContractDate: originalContract?.created_at?.split('T')[0] ?? null,
              originalContractId: originalContract?.id ?? null,
              paymentMethod:
                originalContract?.payment_method ??
                (rawProject && typeof rawProject === 'object' && 'payment_method' in rawProject
                  ? (rawProject as { payment_method?: string | null }).payment_method ?? null
                  : null),
              amountCollected,
              jobId: jobRes.data.id,
              repName: profile.full_name || '',
              changeOrders,
            }
          : null
      }
    />
  )
}
