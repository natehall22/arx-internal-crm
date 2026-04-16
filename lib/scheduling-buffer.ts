/**
 * Whether a candidate slot [slotStart, slotEnd] conflicts with an existing
 * appointment [existingStart, existingEnd] using asymmetric buffers.
 * Matches `hasDbConflictForCloser` in round-robin and slot generation in
 * `/api/canvass/availability` + `/api/canvass/team-availability`.
 */
export function hasBufferedConflict(
  slotStart: Date,
  slotEnd: Date,
  existingStart: Date,
  existingEnd: Date,
  bufferBeforeMinutes: number,
  bufferAfterMinutes: number
): boolean {
  const blockedStart = new Date(existingStart.getTime() - bufferAfterMinutes * 60 * 1000)
  const blockedEnd = new Date(existingEnd.getTime() + bufferBeforeMinutes * 60 * 1000)
  return slotStart < blockedEnd && slotEnd > blockedStart
}
