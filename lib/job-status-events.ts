/**
 * Desire paths for production statuses — the status is recorded where the work
 * already happens, not in a dropdown someone has to remember.
 *
 * Evidence (prod, 2026-10-21): materials "not ordered" on 39 of 42 jobs, permit
 * "not needed" on 42 of 42, 111 past appointments still "scheduled", 31 of 35
 * signed proposals never marked accepted. Every one of those events already
 * happens in the app; the status just wasn't written there.
 *
 * | Status                | Written by (the real-world event)                                   |
 * |-----------------------|----------------------------------------------------------------------|
 * | materials ordered     | supplier order sheet downloaded to send, or one tap on the job      |
 * | trade (crew) done     | the 4th required walk-around photo arriving through the crew link   |
 * | proposal accepted     | the order-form contract being signed                                 |
 * | appointment outcome   | an outcome logged for the lead / a contract signed on the deal      |
 * | permit                | one tap on the job's Permit card                                     |
 *
 * The JOB is still never auto-completed: `complete` starts payroll (see
 * `deriveJobSchedule`). When every crew is done the job shows in "Needs you"
 * (lib/data-health.ts) with a one-tap link instead.
 *
 * Every writer here only moves a status FORWARD and is idempotent, so a repeat
 * event (second download, extra photo) is a no-op.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { missingRequiredPhotoTags } from '@/lib/final-photo-tags'
import { syncJobScheduleFromTrades } from '@/lib/job-trades-db'

/* ------------------------------------------------------------------------ *
 * Materials
 * ------------------------------------------------------------------------ */

export type MaterialsOrderedSource = 'order_sheet_download' | 'one_tap' | 'board'

/**
 * Pure: the update that records "materials ordered", or null when there is
 * nothing to do (already ordered/delivered, or the job is closed out/cancelled).
 *
 * A sold job also moves to "Material Ordering" — that board column is exactly
 * this event, and the separate "Start Material Ordering" click was the
 * dropdown-shaped step nobody did.
 */
export function materialsOrderedUpdate(
  job: { status: string; materials_status: string | null; materials_ordered_at: string | null },
  nowIso: string
): Record<string, unknown> | null {
  if (job.status === 'cancelled') return null
  if (job.materials_status && job.materials_status !== 'not_ordered') return null
  const update: Record<string, unknown> = {
    materials_status: 'ordered',
    materials_ordered_at: job.materials_ordered_at ?? nowIso,
  }
  if (job.status === 'sold') update.status = 'materials'
  return update
}

/** Pure: undo a mistaken "ordered" tap. Only reverses what {@link materialsOrderedUpdate} did. */
export function materialsUnorderedUpdate(job: {
  status: string
  materials_status: string | null
}): Record<string, unknown> | null {
  if (job.materials_status !== 'ordered') return null
  const update: Record<string, unknown> = { materials_status: 'not_ordered', materials_ordered_at: null }
  if (job.status === 'materials') update.status = 'sold'
  return update
}

export async function markMaterialsOrdered(
  admin: SupabaseClient,
  args: { orgId: string; jobId: string; source: MaterialsOrderedSource }
): Promise<{ changed: boolean; error?: string }> {
  const { data: job, error } = await admin
    .from('production_jobs')
    .select('id, status, materials_status, materials_ordered_at')
    .eq('id', args.jobId)
    .eq('org_id', args.orgId)
    .maybeSingle()
  if (error) return { changed: false, error: error.message }
  if (!job) return { changed: false, error: 'Job not found' }

  const update = materialsOrderedUpdate(job, new Date().toISOString())
  if (!update) return { changed: false }

  // Guarded on the old value so two quick events can't both "win" and flip the job status twice.
  const { error: updateError } = await admin
    .from('production_jobs')
    .update(update)
    .eq('id', args.jobId)
    .eq('org_id', args.orgId)
    .eq('materials_status', 'not_ordered')
  if (updateError) {
    console.error('[markMaterialsOrdered]', args.source, args.jobId, updateError)
    return { changed: false, error: updateError.message }
  }
  return { changed: true }
}

export async function unmarkMaterialsOrdered(
  admin: SupabaseClient,
  args: { orgId: string; jobId: string }
): Promise<{ changed: boolean; error?: string }> {
  const { data: job, error } = await admin
    .from('production_jobs')
    .select('id, status, materials_status')
    .eq('id', args.jobId)
    .eq('org_id', args.orgId)
    .maybeSingle()
  if (error) return { changed: false, error: error.message }
  if (!job) return { changed: false, error: 'Job not found' }
  const update = materialsUnorderedUpdate(job)
  if (!update) return { changed: false }
  const { error: updateError } = await admin
    .from('production_jobs')
    .update(update)
    .eq('id', args.jobId)
    .eq('org_id', args.orgId)
    .eq('materials_status', 'ordered')
  if (updateError) return { changed: false, error: updateError.message }
  return { changed: true }
}

/* ------------------------------------------------------------------------ *
 * Permit
 * ------------------------------------------------------------------------ */

/** The three things anyone does with a permit here. Replaces a status nobody set. */
export const PERMIT_ACTIONS = ['not_needed', 'applied', 'approved'] as const
export type PermitAction = (typeof PERMIT_ACTIONS)[number]

export function isPermitAction(value: unknown): value is PermitAction {
  return typeof value === 'string' && (PERMIT_ACTIONS as readonly string[]).includes(value)
}

/** Pure: column values for a permit tap. `permit_status` values match the CHECK constraint. */
export function permitUpdate(action: PermitAction, permitNumber?: string | null): Record<string, unknown> {
  const number = typeof permitNumber === 'string' ? permitNumber.trim().slice(0, 80) : undefined
  if (action === 'not_needed') {
    return { permit_required: false, permit_status: 'not_needed' }
  }
  const update: Record<string, unknown> = {
    permit_required: true,
    permit_status: action === 'approved' ? 'approved' : 'pending',
  }
  if (number !== undefined) update.permit_number = number || null
  return update
}

/* ------------------------------------------------------------------------ *
 * Crew photo link → trade done
 * ------------------------------------------------------------------------ */

const TRADE_FINAL_STATUSES = new Set(['completed', 'cancelled'])

/**
 * Pure: should this trade flip to done now? Only an open trade with a crew and
 * every required angle in.
 */
export function tradeDoneFromCrewPhotos(
  trade: { status: string; assigned_sub_id: string | null },
  photoTags: Iterable<string | null | undefined>
): boolean {
  if (TRADE_FINAL_STATUSES.has(trade.status)) return false
  if (!trade.assigned_sub_id) return false
  return missingRequiredPhotoTags(photoTags).length === 0
}

/**
 * Called after each crew-link photo is recorded. The 4th required photo marks
 * that crew's trade done (credited to the sub) and lets the job-level schedule
 * re-derive (scheduled → in progress). Never completes the JOB.
 *
 * Ops can still reopen a trade; it will re-complete on the crew's next upload
 * only if all four angles are still there, which is the same rule ops applies.
 */
export async function completeTradeFromCrewPhotos(
  admin: SupabaseClient,
  ctx: { orgId: string; jobId: string; workOrderId: string }
): Promise<{ completed: boolean }> {
  const [{ data: trade }, { data: photos }] = await Promise.all([
    admin
      .from('work_orders')
      .select('id, status, assigned_sub_id')
      .eq('id', ctx.workOrderId)
      .eq('org_id', ctx.orgId)
      .eq('job_id', ctx.jobId)
      .maybeSingle(),
    admin
      .from('photos')
      .select('photo_tag')
      .eq('org_id', ctx.orgId)
      .eq('job_id', ctx.jobId)
      .eq('work_order_id', ctx.workOrderId)
      .is('deleted_at', null),
  ])
  if (!trade) return { completed: false }
  const tags = ((photos || []) as { photo_tag: string | null }[]).map((p) => p.photo_tag)
  if (!tradeDoneFromCrewPhotos(trade, tags)) return { completed: false }

  const { data: updated, error } = await admin
    .from('work_orders')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      completed_by: null,
      completed_by_sub_id: trade.assigned_sub_id,
    })
    .eq('id', trade.id)
    .eq('org_id', ctx.orgId)
    .not('status', 'in', '(completed,cancelled)')
    .select('id')
  if (error) {
    console.error('[completeTradeFromCrewPhotos]', ctx.workOrderId, error)
    return { completed: false }
  }
  if (!updated || updated.length === 0) return { completed: false }

  await syncJobScheduleFromTrades(admin, ctx.orgId, ctx.jobId)
  return { completed: true }
}

/* ------------------------------------------------------------------------ *
 * Appointments
 * ------------------------------------------------------------------------ */

/** Appointment rows that still need an outcome. */
export const OPEN_APPOINTMENT_STATUS = 'scheduled'

/**
 * Logging an outcome against the LEAD (no appointment id — the lead page and
 * catch-up sessions do this) used to leave the lead's appointment "scheduled"
 * forever. Close out the lead's past open inspection appointments with the same
 * status the appointment-id path writes. Future appointments (a reschedule the
 * same request just booked) are left alone.
 */
export async function closeOutLeadAppointments(
  admin: SupabaseClient,
  args: {
    orgId: string
    leadId: string
    status: 'completed' | 'no_show'
    opportunityId?: string | null
    nowIso?: string
  }
): Promise<{ closed: number }> {
  const nowIso = args.nowIso ?? new Date().toISOString()
  const update: Record<string, unknown> = { status: args.status }
  if (args.opportunityId) update.opportunity_id = args.opportunityId
  const { data, error } = await admin
    .from('scheduled_appointments')
    .update(update)
    .eq('org_id', args.orgId)
    .eq('lead_id', args.leadId)
    .eq('status', OPEN_APPOINTMENT_STATUS)
    .or('appointment_type.is.null,appointment_type.eq.inspection')
    .lte('scheduled_for', nowIso)
    .select('id')
  if (error) {
    console.error('[closeOutLeadAppointments]', args.leadId, error)
    return { closed: 0 }
  }
  return { closed: (data || []).length }
}

/* ------------------------------------------------------------------------ *
 * Contract signed → proposal accepted + appointments closed
 * ------------------------------------------------------------------------ */

/** Proposal statuses a signature moves to accepted. A declined proposal is left for a human. */
export const PROPOSAL_STATUSES_SIGNING_ACCEPTS = ['draft', 'sent', 'viewed'] as const

/**
 * The order-form contract is the real "accept" (W6): signing it marks the
 * proposal it was built from accepted, stamps the project so the proposal page
 * never offers "Create project" for a deal that already has one, and closes out
 * the deal's past appointments that were left "scheduled".
 *
 * Writes proposals directly, NOT via PATCH /api/proposals/[id] — that route's
 * accept side effect creates a project, which signing has already done.
 *
 * Best effort: a failure here is logged and never fails the signature.
 */
export async function applyContractSignedStatuses(
  admin: SupabaseClient,
  args: {
    orgId: string
    proposalId: string | null
    opportunityId: string | null
    projectId: string | null
    signedAtIso: string
  }
): Promise<{ proposalAccepted: boolean; appointmentsClosed: number }> {
  let proposalAccepted = false
  let appointmentsClosed = 0
  try {
    if (args.proposalId) {
      const update: Record<string, unknown> = { status: 'accepted', accepted_at: args.signedAtIso }
      const { data, error } = await admin
        .from('proposals')
        .update(update)
        .eq('id', args.proposalId)
        .eq('org_id', args.orgId)
        .in('status', [...PROPOSAL_STATUSES_SIGNING_ACCEPTS])
        .select('id')
      if (error) console.error('[applyContractSignedStatuses] proposal', args.proposalId, error)
      proposalAccepted = !error && (data || []).length > 0
      if (args.projectId) {
        await admin
          .from('proposals')
          .update({ project_id: args.projectId })
          .eq('id', args.proposalId)
          .eq('org_id', args.orgId)
          .is('project_id', null)
      }
    }
    if (args.opportunityId) {
      const { data, error } = await admin
        .from('scheduled_appointments')
        .update({ status: 'completed' })
        .eq('org_id', args.orgId)
        .eq('opportunity_id', args.opportunityId)
        .eq('status', OPEN_APPOINTMENT_STATUS)
        .lte('scheduled_for', args.signedAtIso)
        .select('id')
      if (error) console.error('[applyContractSignedStatuses] appointments', args.opportunityId, error)
      appointmentsClosed = (data || []).length
    }
  } catch (error) {
    console.error('[applyContractSignedStatuses]', error)
  }
  return { proposalAccepted, appointmentsClosed }
}
