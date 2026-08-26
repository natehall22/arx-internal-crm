import type { SupabaseClient } from '@supabase/supabase-js'
import { getAttributedCanvassLeadUserId } from '@/lib/canvass-lead-attribution'
import { deleteAppointmentCalendarEvents } from '@/lib/appointment-calendar-sync'
import { isOrgSuperuserRoleSlug } from '@/lib/org-role-constants'

type LeadRow = {
  id: string
  org_id: string
  owner_user_id: string | null
  pin_attributed_user_id: string | null
  installation_agreement_signed_at: string | null
}

type OpportunityRow = {
  id: string
  status: string | null
  inspection_outcome: string | null
}

type AppointmentRow = {
  id: string
  status: string | null
  google_event_id: string | null
  closer_user_id: string | null
  canvasser_user_id: string | null
}

export type CanvassLeadDeleteResult =
  | { ok: true; deleted_id: string; calendarWarnings: string[] }
  | { ok: false; status: number; error: string }

function canDeletePinAsUser(
  lead: LeadRow,
  actorUserId: string,
  isOrgAdmin: boolean
): boolean {
  if (isOrgAdmin) return true
  const attributedId = getAttributedCanvassLeadUserId(lead)
  return lead.owner_user_id === actorUserId || attributedId === actorUserId
}

async function opportunityHasDownstreamData(
  admin: SupabaseClient,
  opportunityId: string
): Promise<boolean> {
  const checks = await Promise.all([
    admin.from('proposals').select('id').eq('opportunity_id', opportunityId).limit(1),
    admin.from('projects').select('id').eq('opportunity_id', opportunityId).limit(1),
    admin
      .from('order_form_contracts')
      .select('id')
      .eq('opportunity_id', opportunityId)
      .limit(1),
    admin
      .from('inspection_results')
      .select('id')
      .eq('opportunity_id', opportunityId)
      .limit(1),
  ])

  for (const result of checks) {
    if (result.error) {
      console.error('opportunityHasDownstreamData check failed:', result.error)
      return true
    }
    if (result.data && result.data.length > 0) return true
  }
  return false
}

async function isPristineCanvassOpportunity(
  admin: SupabaseClient,
  opp: OpportunityRow
): Promise<boolean> {
  if (opp.status !== 'open') return false
  if (opp.inspection_outcome) return false
  return !(await opportunityHasDownstreamData(admin, opp.id))
}

/**
 * Delete a canvass pin (lead) and cascade-remove a pristine pre-inspection pipeline:
 * scheduled appointments, Google Calendar events, and auto-created open opportunities.
 */
export async function deleteCanvassLeadWithDependencies(args: {
  admin: SupabaseClient
  orgId: string
  leadId: string
  actorUserId: string
  actorRole: string
}): Promise<CanvassLeadDeleteResult> {
  const { admin, orgId, leadId, actorUserId, actorRole } = args
  const isOrgAdmin = isOrgSuperuserRoleSlug(actorRole)

  const { data: lead, error: fetchError } = await admin
    .from('leads')
    .select('id, org_id, owner_user_id, pin_attributed_user_id, installation_agreement_signed_at')
    .eq('id', leadId)
    .single()

  if (fetchError || !lead) {
    return { ok: false, status: 404, error: 'Lead not found' }
  }

  const leadRow = lead as LeadRow

  if (leadRow.org_id !== orgId) {
    return { ok: false, status: 403, error: 'Unauthorized' }
  }

  if (leadRow.installation_agreement_signed_at && !isOrgAdmin) {
    return {
      ok: false,
      status: 403,
      error: 'This pin belongs to a signed customer and can only be deleted by an admin',
    }
  }

  if (!canDeletePinAsUser(leadRow, actorUserId, isOrgAdmin)) {
    return { ok: false, status: 403, error: 'Only the pin owner or admin can delete this pin' }
  }

  const [{ data: opportunities }, { data: appointments }] = await Promise.all([
    admin
      .from('opportunities')
      .select('id, status, inspection_outcome')
      .eq('lead_id', leadId),
    admin
      .from('scheduled_appointments')
      .select('id, status, google_event_id, closer_user_id, canvasser_user_id')
      .eq('lead_id', leadId),
  ])

  const oppRows = (opportunities ?? []) as OpportunityRow[]
  const apptRows = (appointments ?? []) as AppointmentRow[]

  if (apptRows.some((a) => a.status === 'completed')) {
    return {
      ok: false,
      status: 400,
      error: 'Cannot delete pin with a completed inspection. Contact an admin.',
    }
  }

  for (const opp of oppRows) {
    const pristine = await isPristineCanvassOpportunity(admin, opp)
    if (!pristine) {
      return {
        ok: false,
        status: 400,
        error:
          'Cannot delete pin with active sales or production data. Contact an admin to remove the opportunity first.',
      }
    }
  }

  const calendarWarnings = await deleteAppointmentCalendarEvents(admin, apptRows)

  const apptIds = apptRows.map((a) => a.id)
  if (apptIds.length > 0) {
    const { error: closeLinkErr } = await admin
      .from('close_appointments')
      .delete()
      .in('scheduled_appointment_id', apptIds)
    if (closeLinkErr) {
      console.error('deleteCanvassLeadWithDependencies: close_appointments cleanup failed:', closeLinkErr)
      return { ok: false, status: 500, error: 'Failed to remove linked appointments' }
    }
    const { error: closeSourceErr } = await admin
      .from('close_appointments')
      .delete()
      .in('source_inspection_appointment_id', apptIds)
    if (closeSourceErr) {
      console.error('deleteCanvassLeadWithDependencies: close source cleanup failed:', closeSourceErr)
      return { ok: false, status: 500, error: 'Failed to remove linked appointments' }
    }
    const { error: apptDeleteErr } = await admin.from('scheduled_appointments').delete().in('id', apptIds)
    if (apptDeleteErr) {
      console.error('deleteCanvassLeadWithDependencies: appointment delete failed:', apptDeleteErr)
      return { ok: false, status: 500, error: 'Failed to remove scheduled appointments' }
    }
  }

  await admin.from('activities').delete().eq('lead_id', leadId)
  await admin.from('files').delete().eq('lead_id', leadId)
  await admin.from('referrals').delete().eq('referred_lead_id', leadId)

  if (oppRows.length > 0) {
    const oppIds = oppRows.map((o) => o.id)
    const { error: oppDeleteErr } = await admin.from('opportunities').delete().in('id', oppIds)
    if (oppDeleteErr) {
      console.error('deleteCanvassLeadWithDependencies: opportunity delete failed:', oppDeleteErr)
      return { ok: false, status: 500, error: 'Failed to remove linked opportunity' }
    }
  }

  const { error: deleteError } = await admin.from('leads').delete().eq('id', leadId)
  if (deleteError) {
    console.error('deleteCanvassLeadWithDependencies: lead delete failed:', deleteError)
    return { ok: false, status: 500, error: 'Failed to delete lead' }
  }

  // (Deleting a lead used to trigger a Sisu 444 recount for every affected rep here.
  // The 444 program was retired 2026-08-25 and its engine deleted; no recount remains.)

  return { ok: true, deleted_id: leadId, calendarWarnings }
}
