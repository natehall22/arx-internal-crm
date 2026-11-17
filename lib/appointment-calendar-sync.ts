import type { SupabaseClient } from '@supabase/supabase-js'

import { getCalendarClient } from '@/lib/calendar/connection'
import { calendarLabel } from '@/lib/calendar/labels'

/**
 * Delete an event that was created under a team member's calendar (Google or Outlook, whichever that member has).
 * Try the assignee first, then the canvasser/setter — some flows create the event with
 * whoever had a calendar connected at scheduling time.
 */
export async function deleteCalendarEventWithFallback(
  adminClient: SupabaseClient,
  eventId: string,
  userIdsInOrder: (string | null | undefined)[]
): Promise<{ ok: boolean; triedUsers: string[]; lastError?: string }> {
  const triedUsers: string[] = []
  for (const uid of userIdsInOrder) {
    if (!uid) continue
    triedUsers.push(uid)
    const client = await getCalendarClient(adminClient, uid, { useExpiredOnRefreshFailure: true })
    if (!client) continue
    try {
      await client.deleteEvent(eventId)
      return { ok: true, triedUsers }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('deleteCalendarEventWithFallback: delete failed for user', uid, msg)
    }
  }
  return { ok: false, triedUsers, lastError: 'No token or all delete attempts failed' }
}

export type AppointmentCalendarRow = {
  id: string
  google_event_id?: string | null
  closer_user_id?: string | null
  canvasser_user_id?: string | null
}

/** Best-effort calendar cleanup for one or more appointments. */
export async function deleteAppointmentCalendarEvents(
  adminClient: SupabaseClient,
  appointments: AppointmentCalendarRow[]
): Promise<string[]> {
  const warnings: string[] = []
  for (const appt of appointments) {
    const eventId = appt.google_event_id
    if (!eventId) continue
    const del = await deleteCalendarEventWithFallback(adminClient, eventId, [
      appt.closer_user_id,
      appt.canvasser_user_id,
    ])
    if (!del.ok) {
      warnings.push(
        `${calendarLabel()}: could not remove event for appointment ${appt.id} (no OAuth token or delete failed).`
      )
    }
  }
  return warnings
}
