/**
 * Org-level default gap between appointments (Admin → Scheduling → "Default gap between appointments").
 * Used when team queue / user_settings do not specify buffer_after / legacy buffer_minutes.
 */
export async function getOrgDefaultSchedulingGapMinutes(
  supabase: { from: (table: string) => any },
  orgId: string
): Promise<number> {
  const { data } = await supabase
    .from('orgs')
    .select('default_scheduling_gap_minutes')
    .eq('id', orgId)
    .maybeSingle()
  const n = data?.default_scheduling_gap_minutes
  return typeof n === 'number' && n >= 0 ? n : 15
}

/** team_closer_queue row (or subset) */
export type QueueBufferFields = {
  buffer_before?: number | null
  buffer_after?: number | null
  buffer_minutes?: number | null
}

/** user_settings calendar columns (subset) */
export type UserCalendarBufferFields = {
  appointment_buffer_before?: number | null
  appointment_buffer_after?: number | null
  appointment_buffer_minutes?: number | null
}

/**
 * Single precedence chain used everywhere we compute scheduling buffers:
 * Team closer queue → personal Calendar settings → org default (Admin → Scheduling).
 */
export function resolveSchedulingBuffers(
  queue: QueueBufferFields | null | undefined,
  user: UserCalendarBufferFields | null | undefined,
  orgDefaultGapMinutes: number
): { bufferBefore: number; bufferAfter: number } {
  const bufferBefore = queue?.buffer_before ?? user?.appointment_buffer_before ?? 0
  const bufferAfter =
    queue?.buffer_after ??
    queue?.buffer_minutes ??
    user?.appointment_buffer_after ??
    user?.appointment_buffer_minutes ??
    orgDefaultGapMinutes
  return { bufferBefore, bufferAfter }
}
