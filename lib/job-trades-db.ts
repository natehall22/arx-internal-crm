/**
 * Database side of job trades — see `lib/job-trades.ts` for the model.
 * Server only.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveJobProposalId } from '@/lib/job-sold-scope'
import {
  JOB_TRADE_COLUMNS,
  TRADE_LABELS,
  deriveJobSchedule,
  detectTradesFromLineItems,
  newCrewLinkToken,
  primaryTradeForJobType,
  type DerivedJobSchedule,
  type JobTradeRow,
  type Trade,
} from '@/lib/job-trades'

/* ------------------------------------------------------------------------ *
 * ensureJobTrades
 * ------------------------------------------------------------------------ */

type EnsureJobRow = {
  id: string
  org_id: string
  project_id: string | null
  customer_id: string | null
  job_type: string | null
  status: string
  address_text: string | null
  scheduled_date: string | null
  scheduled_time_start: string | null
  install_days: number | null
  assigned_sub_id: string | null
  install_google_event_id: string | null
  install_calendar_id: string | null
  completed_at: string | null
  cancelled_at: string | null
  created_by: string
  linked_proposal_id: string | null
  accepted_proposal_id: string | null
}

const ENSURE_JOB_COLUMNS =
  'id, org_id, project_id, customer_id, job_type, status, address_text, scheduled_date, scheduled_time_start, install_days, assigned_sub_id, install_google_event_id, install_calendar_id, completed_at, cancelled_at, created_by, linked_proposal_id, accepted_proposal_id'

function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505'
}

/**
 * Make sure each job has its automatic trades. Idempotent and safe to call on
 * every page load: it only inserts trades that have never existed (the partial
 * unique index on (job_id, trade) WHERE trade_source='auto' makes a concurrent
 * double-insert a no-op).
 *
 * The primary trade ADOPTS the job's current assignment — sub, date, length and
 * the Google event already sent — so a job scheduled before trades existed keeps
 * its crew and its invite instead of getting a second one.
 *
 * Proposal-detected trades are only added while the job is still ahead of
 * install (never onto a completed/collected job's history). Cancelled jobs get
 * nothing.
 */
export async function ensureJobTrades(
  admin: SupabaseClient,
  orgId: string,
  jobIds: string[]
): Promise<void> {
  const ids = Array.from(new Set(jobIds.filter(Boolean)))
  if (ids.length === 0) return

  const [{ data: jobsData, error: jobsError }, { data: existingData, error: existingError }] = await Promise.all([
    admin.from('production_jobs').select(ENSURE_JOB_COLUMNS).eq('org_id', orgId).in('id', ids),
    admin
      .from('work_orders')
      .select('job_id, trade, trade_source')
      .eq('org_id', orgId)
      .in('job_id', ids)
      .not('trade', 'is', null),
  ])
  if (jobsError || existingError) {
    console.error('[ensureJobTrades] load failed', jobsError || existingError)
    return
  }

  const autoTradesByJob = new Map<string, Set<string>>()
  const anyTradeByJob = new Set<string>()
  for (const row of (existingData || []) as { job_id: string; trade: string; trade_source: string | null }[]) {
    anyTradeByJob.add(row.job_id)
    if (row.trade_source === 'auto') {
      const set = autoTradesByJob.get(row.job_id) ?? new Set<string>()
      set.add(row.trade)
      autoTradesByJob.set(row.job_id, set)
    }
  }

  const jobs = ((jobsData || []) as EnsureJobRow[]).filter((job) => !job.cancelled_at)
  const isDone = (job: EnsureJobRow) => job.status === 'complete' || job.status === 'collected'

  // What each open job sold, in ONE line-item query for the whole batch — this
  // runs on every board load, so it must not cost two queries per open job.
  const proposalIdByJob = new Map<string, string>()
  await Promise.all(
    jobs
      .filter((job) => !isDone(job))
      .map(async (job) => {
        const proposalId = await resolveJobProposalId(admin, orgId, job)
        if (proposalId) proposalIdByJob.set(job.id, proposalId)
      })
  )
  const itemsByProposal = new Map<string, { name: string | null; category: string | null }[]>()
  const proposalIds = Array.from(new Set(Array.from(proposalIdByJob.values())))
  if (proposalIds.length > 0) {
    const { data: items, error: itemsError } = await admin
      .from('proposal_line_items')
      .select('proposal_id, name, category')
      .in('proposal_id', proposalIds)
    if (itemsError) console.error('[ensureJobTrades] line items failed', itemsError)
    for (const item of (items || []) as { proposal_id: string; name: string | null; category: string | null }[]) {
      const list = itemsByProposal.get(item.proposal_id) ?? []
      list.push(item)
      itemsByProposal.set(item.proposal_id, list)
    }
  }

  const inserts: Record<string, unknown>[] = []
  for (const job of jobs) {
    const haveAuto = autoTradesByJob.get(job.id) ?? new Set<string>()
    const primary = primaryTradeForJobType(job.job_type)
    const done = isDone(job)

    // A job with any trade at all already had its primary handled (ops may have
    // replaced it by hand) — only a job with NO trades gets the primary adopted.
    if (!anyTradeByJob.has(job.id) && !haveAuto.has(primary)) {
      const scheduled = Boolean(job.scheduled_date && job.assigned_sub_id)
      // Only a job that was actually put on the calendar contributes history.
      // A finished job that was never scheduled here would add an empty
      // "pending" roofing row to its history — skip it.
      if (!done || scheduled) {
        const adoptedDays = job.install_days === 2 ? 2 : job.scheduled_date ? 1 : null
        inserts.push({
          ...baseTradeInsert(job, primary, 'auto'),
          status: done ? 'completed' : scheduled ? 'scheduled' : 'pending',
          assigned_sub_id: job.assigned_sub_id,
          scheduled_date: job.scheduled_date,
          scheduled_time_start: job.scheduled_time_start,
          install_days: adoptedDays,
          install_google_event_id: job.install_google_event_id,
          install_calendar_id: job.install_calendar_id,
          completed_at: done ? job.completed_at : null,
          crew_link_token: scheduled ? newCrewLinkToken() : null,
        })
      }
    }

    const proposalId = proposalIdByJob.get(job.id)
    if (!done && proposalId) {
      for (const trade of detectTradesFromLineItems(itemsByProposal.get(proposalId) ?? [])) {
        if (trade === primary || haveAuto.has(trade)) continue
        inserts.push({ ...baseTradeInsert(job, trade, 'auto'), status: 'pending' })
      }
    }
  }

  // One insert per row: a unique-index conflict on one (a concurrent load
  // created it first) must not drop the others. Only ever runs once per trade.
  for (const row of inserts) {
    const { error } = await admin.from('work_orders').insert(row)
    if (error && !isUniqueViolation(error)) {
      console.error('[ensureJobTrades] insert failed', row.job_id, row.trade, error)
    }
  }
}


function baseTradeInsert(
  job: Pick<EnsureJobRow, 'id' | 'org_id' | 'project_id' | 'customer_id' | 'address_text' | 'created_by'>,
  trade: Trade,
  source: 'auto' | 'manual',
  createdBy?: string
): Record<string, unknown> {
  return {
    org_id: job.org_id,
    job_id: job.id,
    project_id: job.project_id,
    customer_id: job.customer_id,
    work_order_type: 'install',
    trade,
    trade_source: source,
    title: `${TRADE_LABELS[trade]} install`,
    address: job.address_text,
    created_by: createdBy ?? job.created_by,
  }
}

/** Add a trade by hand. Manual trades have no uniqueness — two siding crews is legitimate. */
export async function addManualTrade(
  admin: SupabaseClient,
  orgId: string,
  jobId: string,
  trade: Trade,
  userId: string
): Promise<{ trade: JobTradeRow } | { error: string; status: number }> {
  const { data: job } = await admin
    .from('production_jobs')
    .select('id, org_id, project_id, customer_id, address_text, created_by, cancelled_at')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!job) return { error: 'Job not found', status: 404 }
  if (job.cancelled_at) return { error: 'This job is cancelled', status: 400 }

  const { data, error } = await admin
    .from('work_orders')
    .insert({ ...baseTradeInsert(job, trade, 'manual', userId), status: 'pending' })
    .select(JOB_TRADE_COLUMNS)
    .single()
  if (error || !data) {
    console.error('[addManualTrade] insert failed', error)
    return { error: 'Failed to add trade', status: 500 }
  }
  return { trade: data as JobTradeRow }
}

/* ------------------------------------------------------------------------ *
 * syncJobScheduleFromTrades — the ONLY writer of the job-level schedule columns
 * ------------------------------------------------------------------------ */

export async function syncJobScheduleFromTrades(
  admin: SupabaseClient,
  orgId: string,
  jobId: string,
  opts: { revertToMaterials?: boolean } = {}
): Promise<DerivedJobSchedule | null> {
  const [{ data: job }, { data: trades }] = await Promise.all([
    admin
      .from('production_jobs')
      .select('id, status, scheduled_date, install_days, assigned_sub_id, started_at')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle(),
    admin
      .from('work_orders')
      .select('trade, status, assigned_sub_id, scheduled_date, install_days')
      .eq('org_id', orgId)
      .eq('job_id', jobId)
      .not('trade', 'is', null),
  ])
  if (!job) return null

  const derived = deriveJobSchedule(job, (trades || []) as JobTradeRow[], opts)
  const update: Record<string, unknown> = {}
  if (derived.scheduled_date !== job.scheduled_date) update.scheduled_date = derived.scheduled_date
  if (derived.install_days !== job.install_days) update.install_days = derived.install_days
  if (derived.assigned_sub_id !== job.assigned_sub_id) {
    update.assigned_sub_id = derived.assigned_sub_id
    if (derived.assigned_sub_id) update.assigned_crew_id = null // in-house crew path retired
  }
  if (derived.status !== job.status) {
    update.status = derived.status
    if (derived.status === 'in_progress' && !job.started_at) update.started_at = new Date().toISOString()
  }
  if (Object.keys(update).length > 0) {
    const { error } = await admin.from('production_jobs').update(update).eq('id', jobId).eq('org_id', orgId)
    if (error) console.error('[syncJobScheduleFromTrades] update failed', jobId, error)
  }
  return derived
}
