import type { SupabaseClient } from '@supabase/supabase-js'
import {
  resolveProposalMeasuredSquares,
  resolveProposalSoldRoofSquares,
  resolveProposalWastePercent,
} from '@/lib/sold-roof-squares'

type JobLike = {
  project_id?: string | null
  accepted_proposal_id?: string | null
  linked_proposal_id?: string | null
  sold_squares?: number | null
  measured_squares?: number | null
  sold_waste_percent?: number | null
}

type ProposalRow = {
  id: string
  project_id: string | null
  accepted_at: string | null
  sold_squares?: number | null
  measured_squares?: number | null
  sold_waste_percent?: number | null
}

type ProposalLineItemRow = {
  proposal_id: string
  category: string | null
  name: string | null
  description: string | null
  unit: string | null
  quantity: number | null
  is_adder: boolean | null
}

export async function enrichOpsJobsWithSoldSquares(
  supabase: SupabaseClient,
  orgId: string,
  jobs: Array<JobLike & Record<string, unknown>>
) {
  const explicitProposalIds = Array.from(
    new Set(
      jobs
        .map((job) => job.linked_proposal_id || job.accepted_proposal_id)
        .filter((value): value is string => Boolean(value))
    )
  )
  const projectIds = Array.from(
    new Set(jobs.map((job) => job.project_id).filter((value): value is string => Boolean(value)))
  )
  if (projectIds.length === 0 && explicitProposalIds.length === 0) return

  let proposalRows: ProposalRow[] = []

  const withSquareColumns = await supabase
    .from('proposals')
    .select('id, project_id, accepted_at, sold_squares, measured_squares, sold_waste_percent')
    .eq('org_id', orgId)
    .or(
      [
        explicitProposalIds.length > 0 ? `id.in.(${explicitProposalIds.join(',')})` : null,
        projectIds.length > 0 ? `project_id.in.(${projectIds.join(',')})` : null,
      ]
        .filter(Boolean)
        .join(',')
    )
    .not('accepted_at', 'is', null)
    .order('accepted_at', { ascending: false })

  if (withSquareColumns.error) {
    const fallback = await supabase
      .from('proposals')
      .select('id, project_id, accepted_at')
      .eq('org_id', orgId)
      .or(
        [
          explicitProposalIds.length > 0 ? `id.in.(${explicitProposalIds.join(',')})` : null,
          projectIds.length > 0 ? `project_id.in.(${projectIds.join(',')})` : null,
        ]
          .filter(Boolean)
          .join(',')
      )
      .not('accepted_at', 'is', null)
      .order('accepted_at', { ascending: false })

    if (fallback.error || !fallback.data?.length) return
    proposalRows = fallback.data as ProposalRow[]
  } else {
    proposalRows = (withSquareColumns.data || []) as ProposalRow[]
  }

  if (proposalRows.length === 0) return

  const byId = new Map<string, ProposalRow>()
  const latestByProject = new Map<string, ProposalRow>()
  for (const proposal of proposalRows) {
    byId.set(proposal.id, proposal)
    if (!proposal.project_id || latestByProject.has(proposal.project_id)) continue
    latestByProject.set(proposal.project_id, proposal)
  }

  const proposalIds = Array.from(new Set(Array.from(latestByProject.values()).map((proposal) => proposal.id)))
  const lineItemsByProposal = new Map<string, ProposalLineItemRow[]>()

  if (proposalIds.length > 0) {
    const { data: lineItems } = await supabase
      .from('proposal_line_items')
      .select('proposal_id, category, name, description, unit, quantity, is_adder')
      .in('proposal_id', proposalIds)

    for (const row of (lineItems || []) as ProposalLineItemRow[]) {
      const existing = lineItemsByProposal.get(row.proposal_id) || []
      existing.push(row)
      lineItemsByProposal.set(row.proposal_id, existing)
    }
  }

  for (const job of jobs) {
    const explicitProposalId = job.linked_proposal_id || job.accepted_proposal_id
    const proposal =
      (explicitProposalId ? byId.get(explicitProposalId) : null) ||
      (job.project_id ? latestByProject.get(job.project_id) : null)
    if (!proposal) continue

    const proposalLineItems = lineItemsByProposal.get(proposal.id) || []
    job.sold_squares = resolveProposalSoldRoofSquares(proposal, proposalLineItems)
    job.measured_squares = resolveProposalMeasuredSquares(proposal, proposalLineItems)
    job.sold_waste_percent = resolveProposalWastePercent(proposal, proposalLineItems)
  }
}
