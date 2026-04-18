export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { notFound, redirect } from 'next/navigation'
import JobDetailClient from './JobDetailClient'
import { canAccessJobBilling } from '@/lib/finance-access'
import { canAccessJobBoard } from '@/lib/permissions'

interface PageProps {
  params: { id: string }
}

const jobSelectWithPaymentMethod = `
  *,
  assigned_crew:crews(id, name, color, phone),
  assigned_sub:sub_contractors(id, company_name, contact_name, phone),
  customer:customers(id, name, phone, email),
  salesperson:users!production_jobs_salesperson_id_fkey(id, full_name),
  project:projects(id, opportunity_id, scope_of_work, product_summary, ops_notes, permits_status, install_date, project_review, payment_method, customers(id, name, phone, email), leads(id, homeowner_name, phone, email))
`

const jobSelectWithoutPaymentMethod = `
  *,
  assigned_crew:crews(id, name, color, phone),
  assigned_sub:sub_contractors(id, company_name, contact_name, phone),
  customer:customers(id, name, phone, email),
  salesperson:users!production_jobs_salesperson_id_fkey(id, full_name),
  project:projects(id, opportunity_id, scope_of_work, product_summary, ops_notes, permits_status, install_date, project_review, customers(id, name, phone, email), leads(id, homeowner_name, phone, email))
`

export default async function JobDetailPage({ params }: PageProps) {
  const { profile } = await requireAuth()
  if (!canAccessJobBoard(profile.role)) {
    redirect('/dashboard')
  }
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

  const [jobRes, crewsRes, subsRes] = await Promise.all([
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
  // Also track the installation agreement PDF URL
  let installationAgreement: { pdf_url: string | null; status: string } | null = null
  
  if (jobRes.data.project_id) {
    // Check order_form_contracts for the opportunity that created this project
    try {
      const { data: contracts } = await supabase
        .from('order_form_contracts')
        .select('opportunity_id, pdf_url, status')
        .eq('status', 'completed')
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
                status: contract.status
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
        
        // Also try to get the installation agreement for this opportunity
        if (!installationAgreement) {
          try {
            const { data: contractData } = await supabase
              .from('order_form_contracts')
              .select('pdf_url, status')
              .eq('opportunity_id', opportunityId)
              .eq('status', 'completed')
              .order('created_at', { ascending: false })
              .limit(1)
            
            if (contractData && contractData.length > 0) {
              installationAgreement = {
                pdf_url: contractData[0].pdf_url,
                status: contractData[0].status
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

  // If job row was created before dealer_fee_* sync on sign, amounts live on proposals only (same as proposal UI).
  let proposalDealerFee:
    | {
        dealer_fee_amount: number | null
        dealer_fee_percent: number | null
        financing_program_id: string | null
      }
    | undefined
  const jobRow = jobRes.data
  const missingDealerFeeOnJob =
    jobRow.dealer_fee_amount == null || Number(jobRow.dealer_fee_amount) === 0
  if (missingDealerFeeOnJob) {
    const projectOppId =
      rawProject &&
      typeof rawProject === 'object' &&
      'opportunity_id' in rawProject
        ? (rawProject as { opportunity_id?: string | null }).opportunity_id
        : null
    const resolvedOppId = opportunityId || projectOppId || null
    try {
      if (resolvedOppId) {
        const { data: prop } = await supabaseService
          .from('proposals')
          .select('dealer_fee_amount, dealer_fee_percent, financing_program_id')
          .eq('org_id', profile.org_id)
          .eq('opportunity_id', resolvedOppId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (prop && prop.dealer_fee_amount != null && Number(prop.dealer_fee_amount) > 0) {
          proposalDealerFee = prop
        }
      }
      if (!proposalDealerFee && jobRow.project_id) {
        const { data: prop } = await supabaseService
          .from('proposals')
          .select('dealer_fee_amount, dealer_fee_percent, financing_program_id')
          .eq('org_id', profile.org_id)
          .eq('project_id', jobRow.project_id)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (prop && prop.dealer_fee_amount != null && Number(prop.dealer_fee_amount) > 0) {
          proposalDealerFee = prop
        }
      }
    } catch {
      // proposals table / RLS
    }
  }

  const projectOppId =
    rawProject && typeof rawProject === 'object' && 'opportunity_id' in rawProject
      ? (rawProject as { opportunity_id?: string | null }).opportunity_id
      : null
  const resolvedOppId = opportunityId || projectOppId || null

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

  const transformedJob = {
    ...jobRes.data,
    dealer_fee_amount: proposalDealerFee?.dealer_fee_amount ?? jobRes.data.dealer_fee_amount,
    dealer_fee_percent: proposalDealerFee?.dealer_fee_percent ?? jobRes.data.dealer_fee_percent,
    financing_program_id: proposalDealerFee?.financing_program_id ?? jobRes.data.financing_program_id,
    assigned_crew: Array.isArray(jobRes.data.assigned_crew) ? jobRes.data.assigned_crew[0] : jobRes.data.assigned_crew,
    assigned_sub: Array.isArray(jobRes.data.assigned_sub) ? jobRes.data.assigned_sub[0] : jobRes.data.assigned_sub,
    customer: customer,
    salesperson: Array.isArray(jobRes.data.salesperson) ? jobRes.data.salesperson[0] : jobRes.data.salesperson,
    project: rawProject,
    opportunity_id: resolvedOppId,
    installation_agreement: installationAgreement,
    payroll_attribution: payrollAttribution,
  }

  const canEditPayrollAttribution = ['admin', 'owner', 'operations'].includes(profile.role)

  return (
    <JobDetailClient
      initialJob={transformedJob}
      crews={crewsRes.data || []}
      subs={subsRes.data || []}
      userRole={profile.role}
      canViewJobBilling={canViewJobBilling}
      canEditPayrollAttribution={canEditPayrollAttribution}
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
