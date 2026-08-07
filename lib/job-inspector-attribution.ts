/**
 * Works out who inspected a job, so the inspection commission line can be paid
 * without an admin hand-entering a row for every deal.
 *
 * Source of truth is the inspection appointment: `scheduled_appointments.closer_user_id`
 * is the rep who ran the inspection (see app/api/inspections/schedule-close/route.ts,
 * which reads exactly this column as "the inspector"). `canvasser_user_id` is the
 * setter who booked it — a different person and a different pay line.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  INSPECTION_SET_APPOINTMENT_TYPE_OR,
  countsAsInspectionSet,
} from '@/lib/inspection-set-metrics'
import type { DealCommissionRoleParticipant } from '@/lib/payroll-export'
import { normalizeCommissionRatePercent } from '@/lib/commission-rate'

type AppointmentRow = {
  opportunity_id: string | null
  closer_user_id: string | null
  appointment_type: string | null
  status: string | null
  scheduled_for: string | null
}

export function countsAsCompletedInspection(
  row: Pick<AppointmentRow, 'appointment_type' | 'status'>
): boolean {
  return (
    countsAsInspectionSet(row) &&
    (row.status ?? '').trim().toLowerCase() === 'completed'
  )
}

/**
 * Map opportunity id → the user who inspected it.
 *
 * When an opportunity has several inspection appointments (reschedules, second
 * looks), the EARLIEST completed one wins — that is the verified visit the sale is
 * credited to. Rows with no closer assigned are ignored rather than guessed at.
 */
export async function loadInspectorByOpportunity(
  supabase: SupabaseClient,
  orgId: string,
  opportunityIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (opportunityIds.length === 0) return out

  const { data, error } = await supabase
    .from('scheduled_appointments')
    .select('opportunity_id, closer_user_id, appointment_type, status, scheduled_for')
    .eq('org_id', orgId)
    .in('opportunity_id', opportunityIds)
    .or(INSPECTION_SET_APPOINTMENT_TYPE_OR)
    .order('scheduled_for', { ascending: true })

  // Fail closed: an error swallowed into an empty map would silently drop real pay.
  if (error) throw error

  for (const row of (data || []) as AppointmentRow[]) {
    const oppId = row.opportunity_id
    if (!oppId || !row.closer_user_id) continue
    if (!countsAsCompletedInspection(row)) continue
    // Ordered ascending, so the first row seen for an opportunity is the earliest.
    if (!out.has(oppId)) out.set(oppId, row.closer_user_id)
  }

  return out
}

/**
 * Merge a derived inspector into the explicit per-job commission roles.
 *
 * Precedence, highest first:
 *  1. An explicit `inspector` row an admin saved for this job — never overwritten,
 *     including when they deliberately set it to $0.
 *  2. The inspector derived from the appointment, at the org's inspection rate.
 *  3. Nothing, when the rate is 0/unset or no inspector can be identified.
 *
 * Pure so the precedence rules can be tested without a database.
 */
export function withDerivedInspector(
  explicit: DealCommissionRoleParticipant[],
  inspectorUserId: string | null,
  inspectionRatePercent: number
): DealCommissionRoleParticipant[] {
  if (!inspectorUserId) return explicit
  if (!Number.isFinite(inspectionRatePercent) || inspectionRatePercent <= 0) return explicit
  if (explicit.some((p) => p.role === 'inspector')) return explicit

  return [
    ...explicit,
    {
      userId: inspectorUserId,
      role: 'inspector',
      overrideAmount: null,
      overridePercent: inspectionRatePercent,
      premierPricingAmount: null,
    },
  ]
}

/** Org inspection rate, defaulting to 0 (feature off) when unset or unreadable. */
export function normalizeInspectionRate(value: unknown): number {
  return normalizeCommissionRatePercent(value)
}
