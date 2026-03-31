/**
 * Sales calendar data: scheduled inspections/closes from `scheduled_appointments`,
 * plus standalone `close_appointments` rows that are not represented there (rare / legacy).
 * Uses the browser Supabase client only — same RLS as the rest of the app; does not touch scheduling APIs.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  canReassignAppointmentsFromProfile,
  canViewOrgWideScheduledAppointments,
  deriveCalendarAccess,
} from '@/lib/permissions'

export type SalesCalendarRow = {
  id: string
  org_id?: string
  lead_id?: string | null
  opportunity_id?: string | null
  scheduled_for: string
  duration_minutes: number
  status: string
  address_text: string | null
  notes: string | null
  appointment_type?: string | null
  closer_user_id?: string | null
  canvasser_user_id?: string | null
  /** scheduled = normal row; close_only = synthetic from close_appointments only */
  _calendarSource?: 'scheduled' | 'close_only'
  close_appointment_id?: string | null
}

export type FetchSalesCalendarArgs = {
  orgId: string
  authUserId: string
  profile: unknown
  start: Date
  end: Date
  canAccessTeamCalendar: boolean
  selectedMemberId: string
  selectedUserId: string
  /**
   * Team lane loads the full org day then filters in UI; avoids over-filtering at SQL.
   */
  teamLaneFullOrg?: boolean
}

/**
 * Who may load the full org's scheduled rows for the calendar (no closer/canvas filter).
 * Uses permission helpers first, then falls back to `users.role` alone so we still work when
 * `custom_roles` / nested role_permissions fail to load in the browser (a common cause of an empty
 * calendar for admins and managers).
 */
export function calendarReadsOrgWideScheduled(profile: unknown): boolean {
  if (canViewOrgWideScheduledAppointments(profile) || deriveCalendarAccess(profile) !== 'none') {
    return true
  }
  if (canReassignAppointmentsFromProfile(profile)) {
    return true
  }
  const role = String((profile as { role?: string })?.role || '')
    .toLowerCase()
    .trim()
  if (!role) return false
  return [
    'admin',
    'owner',
    'operations',
    'sales_manager',
    'setter_manager',
    'regional_manager',
    'regional_setter_manager',
  ].includes(role)
}

export async function fetchSalesCalendarSlice(
  supabase: SupabaseClient,
  args: FetchSalesCalendarArgs
): Promise<{ rows: SalesCalendarRow[]; error: string | null }> {
  const {
    orgId,
    authUserId,
    profile,
    start,
    end,
    canAccessTeamCalendar,
    selectedMemberId,
    selectedUserId,
    teamLaneFullOrg,
  } = args

  const wide = calendarReadsOrgWideScheduled(profile)

  let saQuery = supabase
    .from('scheduled_appointments')
    .select('*')
    .eq('org_id', orgId)
    .gte('scheduled_for', start.toISOString())
    .lte('scheduled_for', end.toISOString())
    .order('scheduled_for', { ascending: true })

  if (teamLaneFullOrg) {
    // managers: all closers / unassigned in range
  } else if (canAccessTeamCalendar && selectedMemberId) {
    saQuery = saQuery.eq('closer_user_id', selectedMemberId)
  } else if (!canAccessTeamCalendar && selectedUserId !== 'all') {
    saQuery = saQuery.eq('closer_user_id', selectedUserId)
  } else if (!wide) {
    saQuery = saQuery.or(
      `closer_user_id.eq.${authUserId},canvasser_user_id.eq.${authUserId}`
    )
  }

  const { data: scheduledRows, error: saError } = await saQuery

  if (saError) {
    console.error('scheduled_appointments calendar query:', saError)
    return { rows: [], error: saError.message }
  }

  const scheduled = (scheduledRows || []) as SalesCalendarRow[]
  const scheduledIds = new Set(scheduled.map((r) => r.id))

  // Standalone close_appointments rows are org-wide; only merge when the user is allowed to see
  // org-wide calendar data (same as scheduled_appointments filter above).
  let closeRows: Array<{
    id: string
    opportunity_id?: string | null
    scheduled_for: string
    scheduled_appointment_id?: string | null
  }> = []
  if (wide || teamLaneFullOrg) {
    const { data: cr, error: caError } = await supabase
      .from('close_appointments')
      .select('id, opportunity_id, scheduled_for, scheduled_appointment_id')
      .eq('org_id', orgId)
      .gte('scheduled_for', start.toISOString())
      .lte('scheduled_for', end.toISOString())

    if (caError) {
      console.warn('close_appointments calendar query (non-fatal):', caError.message)
    } else {
      closeRows = cr || []
    }
  }

  const oppIds = Array.from(
    new Set((closeRows || []).map((c) => c.opportunity_id).filter(Boolean))
  ) as string[]

  let oppNameById: Record<string, string> = {}
  if (oppIds.length > 0) {
    const { data: opps } = await supabase.from('opportunities').select('id, name').in('id', oppIds)
    for (const o of opps || []) {
      if (o?.id) oppNameById[o.id] = o.name || ''
    }
  }

  const synthetics: SalesCalendarRow[] = []
  for (const ca of closeRows || []) {
    const sid = ca.scheduled_appointment_id as string | null
    if (sid && scheduledIds.has(sid)) {
      continue
    }
    const oname = ca.opportunity_id ? oppNameById[ca.opportunity_id as string] : ''
    synthetics.push({
      id: `close-appt-${ca.id}`,
      org_id: orgId,
      lead_id: null,
      opportunity_id: ca.opportunity_id as string,
      scheduled_for: ca.scheduled_for as string,
      duration_minutes: 60,
      status: 'scheduled',
      address_text: null,
      notes: oname ? `Close — ${oname}` : 'Scheduled close',
      appointment_type: 'close',
      closer_user_id: null,
      canvasser_user_id: null,
      _calendarSource: 'close_only',
      close_appointment_id: ca.id as string,
    })
  }

  const merged: SalesCalendarRow[] = [
    ...scheduled.map((r) => ({ ...r, _calendarSource: 'scheduled' as const })),
    ...synthetics,
  ].sort(
    (a, b) =>
      new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime()
  )

  return { rows: merged, error: null }
}
