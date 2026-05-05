import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const MAX_SALES = 24

const ORG_WIDE_ROLES = new Set(['admin', 'owner'])
const MANAGER_ROLES = new Set([
  'admin',
  'owner',
  'regional_manager',
  'regional_setter_manager',
  'sales_manager',
  'setter_manager',
  'manager',
])

const JOB_PROGRESS: Record<string, { percent: number; label: string; tone: string }> = {
  signed: { percent: 15, label: 'Signed', tone: 'blue' },
  sold: { percent: 25, label: 'Sold', tone: 'blue' },
  materials: { percent: 45, label: 'Materials', tone: 'amber' },
  scheduled: { percent: 60, label: 'Scheduled', tone: 'indigo' },
  in_progress: { percent: 75, label: 'In progress', tone: 'cyan' },
  complete: { percent: 90, label: 'Complete', tone: 'emerald' },
  collected: { percent: 100, label: 'Collected', tone: 'green' },
  on_hold: { percent: 35, label: 'On hold', tone: 'rose' },
}
const COMPLETED_JOB_STATUSES = new Set(['complete', 'collected'])
const COMPLETED_VISIBILITY_DAYS = 7

type OpportunityLink = {
  id?: string | null
  owner_user_id: string | null
  setter_user_id: string | null
}

type ContractRow = {
  id: string
  opportunity_id: string | null
  proposal_id: string | null
  customer_name: string | null
  project_address: string | null
  project_cost: number | string | null
  customer_signed_at: string | null
}

type ProjectLink = {
  id: string
  opportunity_id: string | null
  customers?: { id: string; name: string | null } | { id: string; name: string | null }[] | null
  leads?: { id: string; homeowner_name: string | null } | { id: string; homeowner_name: string | null }[] | null
}

type PipelineJobRow = {
  id: string
  job_number: string | null
  status: string | null
  address_text: string | null
  sale_amount: number | string | null
  sale_date: string | null
  salesperson_id: string | null
  accepted_proposal_id: string | null
  project_id: string | null
  scheduled_date: string | null
  completed_at: string | null
  updated_at: string | null
  customer?: { id: string; name: string | null } | { id: string; name: string | null }[] | null
  project?: ProjectLink | ProjectLink[] | null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function jobMeta(status: string | null | undefined) {
  return JOB_PROGRESS[status || ''] ?? JOB_PROGRESS.signed
}

function roleLabel(profileId: string, opp: OpportunityLink | null, inManagedScope: boolean, salespersonId?: string | null) {
  const isSetter = opp?.setter_user_id === profileId
  const isCloser = opp?.owner_user_id === profileId || salespersonId === profileId

  if (isSetter && isCloser) return 'Setter + closer'
  if (isSetter) return 'Setter'
  if (isCloser) return 'Closer'
  return inManagedScope ? 'Team sale' : 'Attached'
}

function shouldHideCompletedJob(job: PipelineJobRow | null) {
  if (!COMPLETED_JOB_STATUSES.has(job?.status || '')) return false
  if (!job?.completed_at) return false

  const completedAt = new Date(job.completed_at).getTime()
  if (!Number.isFinite(completedAt)) return false

  const visibleUntil = completedAt + COMPLETED_VISIBILITY_DAYS * 24 * 60 * 60 * 1000
  return Date.now() > visibleUntil
}

async function getManagedScopeUserIds(supabase: ReturnType<typeof createServiceClient>, profile: any) {
  if (ORG_WIDE_ROLES.has(profile.role)) return null

  const ids = new Set<string>([profile.id])

  if (profile.region_id && (profile.role === 'regional_manager' || profile.role === 'regional_setter_manager')) {
    const { data: regionTeams } = await supabase
      .from('teams')
      .select('id')
      .eq('org_id', profile.org_id)
      .eq('region_id', profile.region_id)

    const teamIds = (regionTeams || []).map((team: any) => team.id).filter(Boolean)
    if (teamIds.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('id')
        .eq('org_id', profile.org_id)
        .in('team_id', teamIds)

      for (const user of users || []) ids.add(user.id)
    }
  } else if (profile.team_id && MANAGER_ROLES.has(profile.role)) {
    const { data: users } = await supabase
      .from('users')
      .select('id')
      .eq('org_id', profile.org_id)
      .eq('team_id', profile.team_id)

    for (const user of users || []) ids.add(user.id)
  }

  if (MANAGER_ROLES.has(profile.role)) {
    const { data: directReports } = await supabase
      .from('users')
      .select('id')
      .eq('org_id', profile.org_id)
      .eq('manager_user_id', profile.id)

    for (const user of directReports || []) ids.add(user.id)
  }

  return ids
}

function isInScope(job: PipelineJobRow, opp: OpportunityLink | null, scopeIds: Set<string> | null) {
  if (scopeIds === null) return true
  return Boolean(
    (job.salesperson_id && scopeIds.has(job.salesperson_id)) ||
    (opp?.setter_user_id && scopeIds.has(opp.setter_user_id)) ||
    (opp?.owner_user_id && scopeIds.has(opp.owner_user_id))
  )
}

function jobCustomerName(job: PipelineJobRow, contract: ContractRow | null) {
  const directCustomer = one(job.customer)
  const project = one(job.project)
  const projectCustomer = one(project?.customers)
  const projectLead = one(project?.leads)

  return (
    directCustomer?.name ||
    projectCustomer?.name ||
    contract?.customer_name ||
    projectLead?.homeowner_name ||
    'Unknown customer'
  )
}

export async function GET() {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()
    const scopeIds = await getManagedScopeUserIds(supabase, profile)

    const { data: jobRows, error: jobsError } = await supabase
      .from('production_jobs')
      .select(
        `
        id,
        job_number,
        status,
        address_text,
        sale_amount,
        sale_date,
        salesperson_id,
        accepted_proposal_id,
        project_id,
        scheduled_date,
        completed_at,
        updated_at,
        customer:customers(id, name),
        project:projects(
          id,
          opportunity_id,
          customers(id, name),
          leads(id, homeowner_name)
        )
      `
      )
      .eq('org_id', profile.org_id)
      .order('updated_at', { ascending: false })
      .limit(200)

    if (jobsError) throw jobsError

    const jobs = ((jobRows || []) as PipelineJobRow[]).filter((job) => !shouldHideCompletedJob(job))
    const opportunityIds = Array.from(
      new Set(
        jobs
          .map((job) => one(job.project)?.opportunity_id)
          .filter(Boolean) as string[]
      )
    )
    const proposalIds = Array.from(
      new Set(jobs.map((job) => job.accepted_proposal_id).filter(Boolean) as string[])
    )

    const opportunitiesById = new Map<string, OpportunityLink>()
    if (opportunityIds.length > 0) {
      const { data: opportunities, error: opportunitiesError } = await supabase
        .from('opportunities')
        .select('id, owner_user_id, setter_user_id')
        .eq('org_id', profile.org_id)
        .in('id', opportunityIds)

      if (opportunitiesError) throw opportunitiesError
      for (const opp of opportunities || []) opportunitiesById.set(opp.id, opp)
    }

    const scopedJobs = jobs.filter((job) => {
      const opportunityId = one(job.project)?.opportunity_id || ''
      return isInScope(job, opportunitiesById.get(opportunityId) || null, scopeIds)
    })

    const contractsByProposalId = new Map<string, ContractRow>()
    const contractsByOpportunityId = new Map<string, ContractRow>()

    if (proposalIds.length > 0) {
      const { data: contracts, error: contractsError } = await supabase
        .from('order_form_contracts')
        .select('id, opportunity_id, proposal_id, customer_name, project_address, project_cost, customer_signed_at')
        .eq('org_id', profile.org_id)
        .eq('agreement_type', 'installation')
        .eq('status', 'completed')
        .in('proposal_id', proposalIds)

      if (contractsError) throw contractsError
      for (const contract of (contracts || []) as ContractRow[]) {
        if (contract.proposal_id) contractsByProposalId.set(contract.proposal_id, contract)
        if (contract.opportunity_id) contractsByOpportunityId.set(contract.opportunity_id, contract)
      }
    }

    const missingContractOpportunityIds = Array.from(
      new Set(
        scopedJobs
          .map((job) => one(job.project)?.opportunity_id)
          .filter((id): id is string => Boolean(id))
          .filter((id) => !contractsByOpportunityId.has(id))
      )
    )

    if (missingContractOpportunityIds.length > 0) {
      const { data: contracts, error: contractsError } = await supabase
        .from('order_form_contracts')
        .select('id, opportunity_id, proposal_id, customer_name, project_address, project_cost, customer_signed_at')
        .eq('org_id', profile.org_id)
        .eq('agreement_type', 'installation')
        .eq('status', 'completed')
        .in('opportunity_id', missingContractOpportunityIds)

      if (contractsError) throw contractsError
      for (const contract of (contracts || []) as ContractRow[]) {
        if (contract.proposal_id && !contractsByProposalId.has(contract.proposal_id)) {
          contractsByProposalId.set(contract.proposal_id, contract)
        }
        if (contract.opportunity_id && !contractsByOpportunityId.has(contract.opportunity_id)) {
          contractsByOpportunityId.set(contract.opportunity_id, contract)
        }
      }
    }

    const attachedUserIds = Array.from(
      new Set(
        scopedJobs.flatMap((job) => {
          const opportunityId = one(job.project)?.opportunity_id || ''
          const opp = opportunitiesById.get(opportunityId)
          return [job.salesperson_id, opp?.setter_user_id, opp?.owner_user_id].filter(Boolean) as string[]
        })
      )
    )

    const usersById = new Map<string, { full_name: string | null }>()
    if (attachedUserIds.length > 0) {
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, full_name')
        .eq('org_id', profile.org_id)
        .in('id', attachedUserIds)

      if (usersError) throw usersError
      for (const user of users || []) usersById.set(user.id, { full_name: user.full_name })
    }

    const isManaged = scopeIds === null || (scopeIds?.size || 0) > 1
    const sales = scopedJobs.slice(0, MAX_SALES).map((job) => {
      const project = one(job.project)
      const opportunityId = project?.opportunity_id || ''
      const opp = opportunitiesById.get(opportunityId) || null
      const contract =
        (job.accepted_proposal_id ? contractsByProposalId.get(job.accepted_proposal_id) : null) ||
        (opportunityId ? contractsByOpportunityId.get(opportunityId) : null) ||
        null
      const meta = jobMeta(job.status)

      return {
        id: job.id,
        customerName: jobCustomerName(job, contract),
        projectAddress: job.address_text || contract?.project_address || '',
        saleAmount: Number(job.sale_amount || contract?.project_cost || 0),
        signedAt: contract?.customer_signed_at || job.sale_date || null,
        attachment: roleLabel(profile.id, opp, isManaged, job.salesperson_id),
        setterName: opp?.setter_user_id ? usersById.get(opp.setter_user_id)?.full_name || null : null,
        closerName:
          (job.salesperson_id ? usersById.get(job.salesperson_id)?.full_name : null) ||
          (opp?.owner_user_id ? usersById.get(opp.owner_user_id)?.full_name : null) ||
          null,
        jobId: job.id,
        jobNumber: job.job_number,
        jobStatus: job.status || 'signed',
        statusLabel: meta.label,
        progressPercent: meta.percent,
        progressTone: meta.tone,
        scheduledDate: job.scheduled_date,
        completedAt: job.completed_at,
      }
    })

    const totalVolume = sales.reduce((sum, sale) => sum + sale.saleAmount, 0)
    const averageProgress =
      sales.length > 0
        ? Math.round(sales.reduce((sum, sale) => sum + sale.progressPercent, 0) / sales.length)
        : 0

    return NextResponse.json({
      sales,
      summary: {
        count: sales.length,
        shown: sales.length,
        totalVolume,
        averageProgress,
      },
    })
  } catch (error) {
    console.error('Attached sales error:', error)
    return NextResponse.json({ error: 'Failed to fetch attached sales' }, { status: 500 })
  }
}
