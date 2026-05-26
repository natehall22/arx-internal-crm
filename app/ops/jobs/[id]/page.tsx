export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { notFound, redirect } from 'next/navigation'
import JobDetailClient from './JobDetailClient'
import { canAccessJobBilling } from '@/lib/finance-access'
import { redactProductionJobFinancialSummaryFields, resolveOpsAccess } from '@/lib/ops-access'
import {
  enrichOpsJobsWithMeasureSoldSquaresFallback,
  enrichOpsJobsWithSoldSquares,
} from '@/lib/ops-board-sold-squares'
import { isOrgSuperuserRoleSlug } from '@/lib/permissions'
import {
  resolveProposalMeasuredSquares,
  resolveProposalSoldRoofSquares,
  resolveProposalWastePercent,
} from '@/lib/sold-roof-squares'

interface PageProps {
  params: { id: string }
}

type JobSoldScopeLineItem = {
  id: string
  name: string
  description: string | null
  category: string
  quantity: number
  unit: string
  unit_price: number
  line_total: number
  is_adder: boolean
}

type JobSoldScopeRoofMeasureLf = {
  source: string | null
  ridges_lf: number | null
  valleys_lf: number | null
  hips_lf: number | null
  eaves_lf: number | null
  rakes_lf: number | null
  flashing_lf: number | null
  step_flashing_lf: number | null
  wall_flashing_lf: number | null
}

type JobSoldScope = {
  total_squares: number | null
  /** Proposal-derived total includes waste factor; legacy project field does not claim that. */
  total_squares_source: 'proposal_enriched' | 'project_legacy' | 'roof_measure_total' | null
  measured_squares: number | null
  waste_percent: number | null
  /** When proposal has no waste %, ARX / roof_measurements.suggested_waste_percent (estimate only). */
  measure_suggested_waste_percent: number | null
  source: 'proposal' | 'project_legacy' | null
  proposal_id: string | null
  proposal_number: string | null
  line_items: JobSoldScopeLineItem[]
  /** Ridge / valley / flashing LF from roof_measurements linked to the proposal (or opp/project fallback). */
  roof_measurement_linear: JobSoldScopeRoofMeasureLf | null
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

function positiveLinearFt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n) || n <= 0) return null
  return Math.round(n * 10) / 10
}

function positiveWastePercent(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n) || n <= 0) return null
  return Math.round(n * 10) / 10
}

function buildRoofMeasurementLinear(
  row: {
    ridges_lf?: number | null
    valleys_lf?: number | null
    hips_lf?: number | null
    eaves_lf?: number | null
    rakes_lf?: number | null
    flashing_lf?: number | null
    step_flashing_lf?: number | null
    source?: string | null
    raw_data?: unknown
  } | null
): JobSoldScopeRoofMeasureLf | null {
  if (!row) return null
  const raw =
    row.raw_data && typeof row.raw_data === 'object' && !Array.isArray(row.raw_data)
      ? (row.raw_data as Record<string, unknown>)
      : null

  const out: JobSoldScopeRoofMeasureLf = {
    source: row.source ?? null,
    ridges_lf: positiveLinearFt(row.ridges_lf),
    valleys_lf: positiveLinearFt(row.valleys_lf),
    hips_lf: positiveLinearFt(row.hips_lf),
    eaves_lf: positiveLinearFt(row.eaves_lf),
    rakes_lf: positiveLinearFt(row.rakes_lf),
    flashing_lf: positiveLinearFt(row.flashing_lf),
    step_flashing_lf:
      positiveLinearFt(row.step_flashing_lf) ?? (raw ? positiveLinearFt(raw.step_flashing_lf) : null),
    wall_flashing_lf: raw ? positiveLinearFt(raw.wall_flashing_lf) : null,
  }

  const hasNumeric =
    out.ridges_lf != null ||
    out.valleys_lf != null ||
    out.hips_lf != null ||
    out.eaves_lf != null ||
    out.rakes_lf != null ||
    out.flashing_lf != null ||
    out.step_flashing_lf != null ||
    out.wall_flashing_lf != null

  return hasNumeric ? out : null
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

  const jobRowForSquares = { ...jobRes.data }
  await enrichOpsJobsWithSoldSquares(supabaseService, profile.org_id, [jobRowForSquares])
  await enrichOpsJobsWithMeasureSoldSquaresFallback(supabaseService, profile.org_id, [jobRowForSquares])

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
    const jr = jobRes.data
    const projectLegacySq =
      rawProject &&
      typeof rawProject === 'object' &&
      'sold_roof_squares' in rawProject &&
      (rawProject as { sold_roof_squares?: number | null }).sold_roof_squares != null
        ? Number((rawProject as { sold_roof_squares?: number | null }).sold_roof_squares)
        : null
    const legacyPositive = projectLegacySq != null && !Number.isNaN(projectLegacySq) && projectLegacySq > 0

    let proposalId: string | null =
      jr.linked_proposal_id || jr.accepted_proposal_id || null

    if (!proposalId && jr.project_id) {
      const { data: p } = await supabaseService
        .from('proposals')
        .select('id')
        .eq('org_id', profile.org_id)
        .eq('project_id', jr.project_id)
        .not('accepted_at', 'is', null)
        .order('accepted_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      proposalId = p?.id ?? null
    }

    let proposal_number: string | null = null
    let proposalSquares: {
      sold_squares?: number | null
      measured_squares?: number | null
      sold_waste_percent?: number | null
    } | null = null
    let line_items: JobSoldScopeLineItem[] = []

    if (proposalId) {
      const { data: propMeta } = await supabaseService
        .from('proposals')
        .select('id, proposal_number, sold_squares, measured_squares, sold_waste_percent')
        .eq('org_id', profile.org_id)
        .eq('id', proposalId)
        .maybeSingle()
      proposal_number = propMeta?.proposal_number ?? null
      proposalSquares = propMeta

      const { data: li } = await supabaseService
        .from('proposal_line_items')
        .select(
          'id, name, description, category, unit, quantity, unit_price, line_total, is_adder, sort_order'
        )
        .eq('proposal_id', proposalId)
        .order('sort_order', { ascending: true })

      line_items = (li || []).map((row) => ({
        id: row.id,
        name: row.name || 'Line item',
        description: row.description ?? null,
        category: row.category || 'general',
        quantity: Number(row.quantity) || 0,
        unit: row.unit || '',
        unit_price: Number(row.unit_price) || 0,
        line_total: Number(row.line_total) || 0,
        is_adder: Boolean(row.is_adder),
      }))
    }

    const proposalResolvedTotalSquares = proposalSquares
      ? resolveProposalSoldRoofSquares(proposalSquares, line_items)
      : null
    const proposalResolvedMeasuredSquares = proposalSquares
      ? resolveProposalMeasuredSquares(proposalSquares, line_items)
      : null
    const proposalResolvedWastePercent = proposalSquares
      ? resolveProposalWastePercent(proposalSquares, line_items)
      : null

    const soldSqPositive =
      proposalId != null
        ? proposalResolvedTotalSquares
        : typeof jobRowForSquares.sold_squares === 'number' && jobRowForSquares.sold_squares > 0
          ? Number(jobRowForSquares.sold_squares)
          : null
    const soldSquaresFromMeasureRow =
      proposalId == null &&
      (jobRowForSquares as { sold_squares_from_measure?: boolean }).sold_squares_from_measure === true

    const totalSquares =
      soldSqPositive ?? (proposalId == null && legacyPositive ? projectLegacySq : null)
    const totalSquaresSource: JobSoldScope['total_squares_source'] =
      soldSqPositive != null && soldSquaresFromMeasureRow
        ? 'roof_measure_total'
        : soldSqPositive != null
          ? 'proposal_enriched'
          : proposalId == null && legacyPositive && projectLegacySq != null
            ? 'project_legacy'
            : null

    const measureSelect =
      'ridges_lf, valleys_lf, hips_lf, eaves_lf, rakes_lf, flashing_lf, step_flashing_lf, source, raw_data, suggested_waste_percent'
    let measurementRow: Parameters<typeof buildRoofMeasurementLinear>[0] = null

    if (proposalId) {
      const { data } = await supabaseService
        .from('roof_measurements')
        .select(measureSelect)
        .eq('org_id', profile.org_id)
        .eq('proposal_id', proposalId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      measurementRow = data
    }
    if (!measurementRow && resolvedOppId) {
      const { data } = await supabaseService
        .from('roof_measurements')
        .select(measureSelect)
        .eq('org_id', profile.org_id)
        .eq('opportunity_id', resolvedOppId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      measurementRow = data
    }
    if (!measurementRow && jr.project_id) {
      const { data } = await supabaseService
        .from('roof_measurements')
        .select(measureSelect)
        .eq('org_id', profile.org_id)
        .eq('project_id', jr.project_id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      measurementRow = data
    }

    const roofMeasurementLinear = buildRoofMeasurementLinear(measurementRow)
    const proposalHasWaste = proposalId != null
      ? proposalResolvedWastePercent != null && proposalResolvedWastePercent > 0
      : typeof jobRowForSquares.sold_waste_percent === 'number' &&
        Number(jobRowForSquares.sold_waste_percent) > 0
    let measureSuggestedWasteOnly: number | null = null
    if (measurementRow && !proposalHasWaste) {
      measureSuggestedWasteOnly = positiveWastePercent(
        (measurementRow as { suggested_waste_percent?: unknown }).suggested_waste_percent
      )
      if (measureSuggestedWasteOnly == null && measurementRow.raw_data && typeof measurementRow.raw_data === 'object') {
        const raw = measurementRow.raw_data as Record<string, unknown>
        measureSuggestedWasteOnly = positiveWastePercent(raw.suggested_waste)
      }
    }

    const fromProposal =
      proposalId != null ||
      line_items.length > 0

    const source: 'proposal' | 'project_legacy' | null = fromProposal
      ? 'proposal'
      : legacyPositive
        ? 'project_legacy'
        : null

    const hasMeasurementsOnly =
      (proposalId != null && proposalResolvedMeasuredSquares != null && proposalResolvedMeasuredSquares > 0) ||
      (proposalId != null && proposalResolvedWastePercent != null && proposalResolvedWastePercent > 0) ||
      (proposalId == null &&
        ((typeof jobRowForSquares.measured_squares === 'number' && jobRowForSquares.measured_squares > 0) ||
          (typeof jobRowForSquares.sold_waste_percent === 'number' && jobRowForSquares.sold_waste_percent > 0)))

    if (
      totalSquares != null ||
      line_items.length > 0 ||
      hasMeasurementsOnly ||
      roofMeasurementLinear ||
      measureSuggestedWasteOnly != null
    ) {
      soldScope = {
        total_squares: totalSquares,
        total_squares_source: totalSquaresSource,
        measured_squares:
          proposalId != null
            ? proposalResolvedMeasuredSquares
            : typeof jobRowForSquares.measured_squares === 'number' && jobRowForSquares.measured_squares > 0
              ? jobRowForSquares.measured_squares
              : null,
        waste_percent:
          proposalId != null
            ? proposalResolvedWastePercent
            : typeof jobRowForSquares.sold_waste_percent === 'number' && jobRowForSquares.sold_waste_percent > 0
              ? jobRowForSquares.sold_waste_percent
              : null,
        measure_suggested_waste_percent: measureSuggestedWasteOnly,
        source,
        proposal_id: proposalId,
        proposal_number,
        line_items,
        roof_measurement_linear: roofMeasurementLinear,
      }
    }
  } catch {
    soldScope = null
  }

  const transformedJob = redactProductionJobFinancialSummaryFields(
    {
      ...jobRes.data,
      collected_cents: Math.round(amountCollected * 100),
      dealer_fee_amount: shouldTreatAsFinance
        ? (proposalFinancing?.dealer_fee_amount ?? jobRes.data.dealer_fee_amount)
        : null,
      dealer_fee_percent: shouldTreatAsFinance
        ? (proposalFinancing?.dealer_fee_percent ?? jobRes.data.dealer_fee_percent)
        : null,
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
      sold_scope: soldScope,
    } as Record<string, unknown>,
    canViewJobFinancials
  )

  const canEditPayrollAttribution =
    isOrgSuperuserRoleSlug(profile.role) || profile.role === 'operations'

  return (
    <JobDetailClient
      initialJob={transformedJob as any}
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
