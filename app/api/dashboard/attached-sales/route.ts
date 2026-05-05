import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { getDateRangeForTimeFrame } from '@/lib/date-ranges'

export const dynamic = 'force-dynamic'

const TIMEZONE = 'America/New_York'
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
  opportunities: OpportunityLink | OpportunityLink[] | null
}

type JobRow = {
  id: string
  job_number: string | null
  status: string | null
  accepted_proposal_id: string | null
  project_id: string | null
  scheduled_date: string | null
  completed_at: string | null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function jobMeta(status: string | null | undefined) {
  return JOB_PROGRESS[status || ''] ?? JOB_PROGRESS.signed
}

function roleLabel(profileId: string, opp: OpportunityLink | null, inManagedScope: boolean) {
  const isSetter = opp?.setter_user_id === profileId
  const isCloser = opp?.owner_user_id === profileId

  if (isSetter && isCloser) return 'Setter + closer'
  if (isSetter) return 'Setter'
  if (isCloser) return 'Closer'
  return inManagedScope ? 'Team sale' : 'Attached'
}

function shouldHideCompletedJob(job: JobRow | null) {
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

export async function GET(request: NextRequest) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()
    const timeframe = request.nextUrl.searchParams.get('timeframe') || 'week'
    const { start, end } = getDateRangeForTimeFrame(timeframe, TIMEZONE, false)

    const scopeIds = await getManagedScopeUserIds(supabase, profile)
    const { data: contractRows, error: contractsError } = await supabase
      .from('order_form_contracts')
      .select(
        'id, opportunity_id, proposal_id, customer_name, project_address, project_cost, customer_signed_at, opportunities(owner_user_id, setter_user_id)'
      )
      .eq('org_id', profile.org_id)
      .eq('agreement_type', 'installation')
      .eq('status', 'completed')
      .not('customer_signed_at', 'is', null)
      .gte('customer_signed_at', start.toISOString())
      .lt('customer_signed_at', end.toISOString())
      .order('customer_signed_at', { ascending: false })
      .limit(100)

    if (contractsError) throw contractsError

    const scopedContracts = ((contractRows || []) as ContractRow[]).filter((contract) => {
      if (scopeIds === null) return true
      const opp = one(contract.opportunities)
      return Boolean(
        (opp?.setter_user_id && scopeIds.has(opp.setter_user_id)) ||
        (opp?.owner_user_id && scopeIds.has(opp.owner_user_id))
      )
    })

    const visibleContracts = scopedContracts.slice(0, MAX_SALES)
    const proposalIds = Array.from(
      new Set(visibleContracts.map((contract) => contract.proposal_id).filter(Boolean) as string[])
    )
    const opportunityIds = Array.from(
      new Set(visibleContracts.map((contract) => contract.opportunity_id).filter(Boolean) as string[])
    )

    const usersById = new Map<string, { full_name: string | null }>()
    const attachedUserIds = Array.from(
      new Set(
        visibleContracts.flatMap((contract) => {
          const opp = one(contract.opportunities)
          return [opp?.setter_user_id, opp?.owner_user_id].filter(Boolean) as string[]
        })
      )
    )

    if (attachedUserIds.length > 0) {
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, full_name')
        .eq('org_id', profile.org_id)
        .in('id', attachedUserIds)

      if (usersError) throw usersError
      for (const user of users || []) usersById.set(user.id, { full_name: user.full_name })
    }

    const jobsByProposalId = new Map<string, JobRow>()
    const jobsByProjectId = new Map<string, JobRow>()
    const projectIdByOpportunityId = new Map<string, string>()

    if (proposalIds.length > 0) {
      const { data: jobs, error: jobsError } = await supabase
        .from('production_jobs')
        .select('id, job_number, status, accepted_proposal_id, project_id, scheduled_date, completed_at')
        .eq('org_id', profile.org_id)
        .in('accepted_proposal_id', proposalIds)

      if (jobsError) throw jobsError
      for (const job of (jobs || []) as JobRow[]) {
        if (job.accepted_proposal_id) jobsByProposalId.set(job.accepted_proposal_id, job)
        if (job.project_id) jobsByProjectId.set(job.project_id, job)
      }
    }

    if (opportunityIds.length > 0) {
      const { data: projects, error: projectsError } = await supabase
        .from('projects')
        .select('id, opportunity_id')
        .eq('org_id', profile.org_id)
        .in('opportunity_id', opportunityIds)

      if (projectsError) throw projectsError
      for (const project of projects || []) {
        if (project.opportunity_id) projectIdByOpportunityId.set(project.opportunity_id, project.id)
      }
      const projectIds = Array.from(new Set((projects || []).map((project: any) => project.id).filter(Boolean)))

      if (projectIds.length > 0) {
        const { data: projectJobs, error: projectJobsError } = await supabase
          .from('production_jobs')
          .select('id, job_number, status, accepted_proposal_id, project_id, scheduled_date, completed_at')
          .eq('org_id', profile.org_id)
          .in('project_id', projectIds)

        if (projectJobsError) throw projectJobsError
        for (const job of (projectJobs || []) as JobRow[]) {
          if (job.project_id && !jobsByProjectId.has(job.project_id)) jobsByProjectId.set(job.project_id, job)
          if (job.accepted_proposal_id && !jobsByProposalId.has(job.accepted_proposal_id)) {
            jobsByProposalId.set(job.accepted_proposal_id, job)
          }
        }
      }
    }

    const sales = visibleContracts.flatMap((contract) => {
      const opp = one(contract.opportunities)
      const job =
        (contract.proposal_id ? jobsByProposalId.get(contract.proposal_id) : null) ||
        (contract.opportunity_id
          ? jobsByProjectId.get(projectIdByOpportunityId.get(contract.opportunity_id) || '')
          : null) ||
        null
      if (shouldHideCompletedJob(job)) return []

      const meta = jobMeta(job?.status)
      const isManaged = scopeIds === null || (scopeIds?.size || 0) > 1

      return [{
        id: contract.id,
        customerName: contract.customer_name || 'Unknown customer',
        projectAddress: contract.project_address || '',
        saleAmount: Number(contract.project_cost || 0),
        signedAt: contract.customer_signed_at,
        attachment: roleLabel(profile.id, opp, isManaged),
        setterName: opp?.setter_user_id ? usersById.get(opp.setter_user_id)?.full_name || null : null,
        closerName: opp?.owner_user_id ? usersById.get(opp.owner_user_id)?.full_name || null : null,
        jobId: job?.id || null,
        jobNumber: job?.job_number || null,
        jobStatus: job?.status || 'signed',
        statusLabel: meta.label,
        progressPercent: meta.percent,
        progressTone: meta.tone,
        scheduledDate: job?.scheduled_date || null,
        completedAt: job?.completed_at || null,
      }]
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
