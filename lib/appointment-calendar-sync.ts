import { deleteCalendarEvent, refreshAccessToken } from '@/lib/google-calendar'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function getValidAccessToken(
  adminClient: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data: tokenRow } = await adminClient
    .from('user_google_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (!tokenRow) return null

  const expiresAt = new Date(tokenRow.expires_at)
  if (expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    try {
      const refreshed = await refreshAccessToken(tokenRow.refresh_token)
      await adminClient
        .from('user_google_tokens')
        .update({ access_token: refreshed.access_token, expires_at: refreshed.expires_at })
        .eq('user_id', userId)
      return refreshed.access_token
    } catch {
      return tokenRow.access_token
    }
  }

  return tokenRow.access_token
}

/**
 * Delete a Google event that was created under a team member's calendar.
 * Try the assignee first, then the canvasser/setter — some flows create the event with
 * whoever had OAuth connected at scheduling time.
 */
export async function deleteGoogleEventWithFallback(
  adminClient: SupabaseClient,
  eventId: string,
  userIdsInOrder: (string | null | undefined)[]
): Promise<{ ok: boolean; triedUsers: string[]; lastError?: string }> {
  const triedUsers: string[] = []
  for (const uid of userIdsInOrder) {
    if (!uid) continue
    triedUsers.push(uid)
    const token = await getValidAccessToken(adminClient, uid)
    if (!token) continue
    try {
      await deleteCalendarEvent(token, eventId)
      return { ok: true, triedUsers }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('deleteGoogleEventWithFallback: delete failed for user', uid, msg)
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

/** Best-effort Google Calendar cleanup for one or more appointments. */
export async function deleteAppointmentCalendarEvents(
  adminClient: SupabaseClient,
  appointments: AppointmentCalendarRow[]
): Promise<string[]> {
  const warnings: string[] = []
  for (const appt of appointments) {
    const eventId = appt.google_event_id
    if (!eventId) continue
    const del = await deleteGoogleEventWithFallback(adminClient, eventId, [
      appt.closer_user_id,
      appt.canvasser_user_id,
    ])
    if (!del.ok) {
      warnings.push(
        `Google Calendar: could not remove event for appointment ${appt.id} (no OAuth token or delete failed).`
      )
    }
  }
  return warnings
}
