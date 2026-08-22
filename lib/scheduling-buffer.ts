/**
 * Buffer semantics (named from the perspective of the appointment that owns them):
 * - `before` = minutes of free time required immediately BEFORE the appointment starts.
 * - `after`  = minutes of free time required immediately AFTER the appointment ends.
 *
 * Two appointments each carry their own requirement, so the gap between consecutive
 * appointments must satisfy BOTH — i.e. `max(earlier.after, later.before)`, never the
 * sum. Summing would demand a 60-minute hole between a 45-min-after inspection and a
 * 15-min-before close, which is not what Admin → Scheduling promises.
 */

/** A busy interval. `bufferAfterMinutes` is the trailing gap the interval itself claims. */
export type BusyInterval = {
  start: string
  end: string
  /**
   * From `scheduled_appointments.buffer_after_minutes`. Undefined for raw Google
   * Calendar events, which carry no ARX buffer metadata and are treated as 0
   * so personal calendar entries keep their pre-existing (unpadded) behavior.
   */
  bufferAfterMinutes?: number
}

/** Buffers claimed by an already-booked appointment. Omitted fields default to 0. */
export type ExistingBuffers = {
  before?: number
  after?: number
}

const MS_PER_MIN = 60 * 1000

/**
 * Whether a candidate slot [slotStart, slotEnd) conflicts with an existing
 * appointment [existingStart, existingEnd).
 *
 * `bufferBeforeMinutes` / `bufferAfterMinutes` belong to the CANDIDATE slot.
 * `existing` carries the booked appointment's own requirement; when omitted it
 * defaults to zero on both sides, which reproduces the original behavior exactly
 * (candidate padded, existing unpadded).
 */
export function hasBufferedConflict(
  slotStart: Date,
  slotEnd: Date,
  existingStart: Date,
  existingEnd: Date,
  bufferBeforeMinutes: number,
  bufferAfterMinutes: number,
  existing?: ExistingBuffers
): boolean {
  const existingBefore = existing?.before ?? 0
  const existingAfter = existing?.after ?? 0

  // Candidate sits entirely after the existing appointment.
  if (slotStart.getTime() >= existingEnd.getTime()) {
    const gapMinutes = (slotStart.getTime() - existingEnd.getTime()) / MS_PER_MIN
    return gapMinutes < Math.max(existingAfter, bufferBeforeMinutes)
  }

  // Candidate sits entirely before the existing appointment.
  if (slotEnd.getTime() <= existingStart.getTime()) {
    const gapMinutes = (existingStart.getTime() - slotEnd.getTime()) / MS_PER_MIN
    return gapMinutes < Math.max(bufferAfterMinutes, existingBefore)
  }

  // Ranges overlap directly.
  return true
}

/**
 * Resolve the buffers an already-booked row claims, for use as the `existing`
 * argument above. Legacy rows predate `buffer_after_minutes` and store NULL —
 * they fall back to the closer's baseline gap rather than to zero, so an old
 * appointment still reserves the closer's normal breathing room.
 */
export function existingBuffersForAppointment(
  storedBufferAfterMinutes: number | null | undefined,
  baselineBufferAfterMinutes: number,
  bufferBeforeMinutes: number
): ExistingBuffers {
  return {
    before: bufferBeforeMinutes,
    after:
      typeof storedBufferAfterMinutes === 'number'
        ? storedBufferAfterMinutes
        : baselineBufferAfterMinutes,
  }
}
