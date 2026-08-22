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
 * Single precedence chain used everywhere we compute scheduling buffers.
 *
 * Two independent constraints combine here:
 *  1. The person-level baseline gap — team closer queue → personal Calendar
 *     settings → org default (Admin → Settings → Scheduling). First non-null wins.
 *  2. The per-appointment-type trailing gap from Admin → Scheduling
 *     (`appointment_types.buffer_after_minutes`, e.g. Inspection "+45 min after slot").
 *
 * Both express a MINIMUM required gap, so they compose with `max`, not with
 * precedence: a 45-minute inspection buffer must not be silently shrunk to a
 * closer's 15-minute baseline, and a type configured at 0 must not strip a
 * closer's personal breathing room.
 *
 * `baselineBufferAfter` is returned separately because legacy appointment rows
 * (NULL `buffer_after_minutes`) should fall back to the person-level gap, not to
 * the type buffer of whatever is being booked against them.
 */
export function resolveSchedulingBuffers(
  queue: QueueBufferFields | null | undefined,
  user: UserCalendarBufferFields | null | undefined,
  orgDefaultGapMinutes: number,
  appointmentTypeBufferAfterMinutes?: number | null
): { bufferBefore: number; bufferAfter: number; baselineBufferAfter: number } {
  const bufferBefore = queue?.buffer_before ?? user?.appointment_buffer_before ?? 0
  const baselineBufferAfter =
    queue?.buffer_after ??
    queue?.buffer_minutes ??
    user?.appointment_buffer_after ??
    user?.appointment_buffer_minutes ??
    orgDefaultGapMinutes
  const typeBufferAfter =
    typeof appointmentTypeBufferAfterMinutes === 'number' && appointmentTypeBufferAfterMinutes >= 0
      ? appointmentTypeBufferAfterMinutes
      : 0
  return {
    bufferBefore,
    bufferAfter: Math.max(baselineBufferAfter, typeBufferAfter),
    baselineBufferAfter,
  }
}
