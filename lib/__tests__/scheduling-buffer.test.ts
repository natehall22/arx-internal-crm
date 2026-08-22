/**
 * Guards the fix for the "buffer between appointments is ignored" bug.
 *
 * Two inspections were booked on 2026-08-17 at 5:45pm and 6:30pm ET — a 15-minute
 * gap — even though Admin → Scheduling had Inspection set to 30 min + 45 min after,
 * and both rows were stamped buffer_after_minutes = 45. Two independent defects:
 *
 *   1. resolveSchedulingBuffers never looked at appointment_types.buffer_after_minutes,
 *      so the conflict check used the closer's 15-minute team-queue gap instead of 45.
 *   2. Busy-slot queries selected only (scheduled_for, duration_minutes), so an already
 *      booked appointment's own trailing buffer never protected the time behind it.
 */
import {
  hasBufferedConflict,
  existingBuffersForAppointment,
} from '@/lib/scheduling-buffer'
import { resolveSchedulingBuffers } from '@/lib/org-scheduling-gap'

/** ET on 2026-08-17 is UTC-4. */
const et = (hhmm: string) => new Date(`2026-08-17T${hhmm}:00.000-04:00`)

describe('resolveSchedulingBuffers composes person-level and per-type gaps', () => {
  // Live prod values on 2026-08-17.
  const queue = { buffer_before: 15, buffer_after: 15, buffer_minutes: 15 }
  const user = { appointment_buffer_before: 0, appointment_buffer_after: 15 }

  it('uses the larger per-type buffer over the closer baseline', () => {
    const { bufferAfter, baselineBufferAfter } = resolveSchedulingBuffers(queue, user, 15, 45)
    expect(bufferAfter).toBe(45)
    expect(baselineBufferAfter).toBe(15)
  })

  it('keeps the closer baseline when the type buffer is 0 (e.g. Follow Up)', () => {
    expect(resolveSchedulingBuffers(queue, user, 15, 0).bufferAfter).toBe(15)
  })

  it('keeps the closer baseline when a closer wants more than the type requires', () => {
    const roomy = { buffer_before: 0, buffer_after: 60, buffer_minutes: 60 }
    expect(resolveSchedulingBuffers(roomy, user, 15, 45).bufferAfter).toBe(60)
  })

  it('falls back to the org default gap with no queue or user row', () => {
    const { bufferAfter, bufferBefore } = resolveSchedulingBuffers(null, null, 15)
    expect(bufferAfter).toBe(15)
    expect(bufferBefore).toBe(0)
  })

  it('is unchanged when no type buffer is supplied (pre-fix precedence intact)', () => {
    expect(resolveSchedulingBuffers(queue, user, 15).bufferAfter).toBe(15)
  })
})

describe('hasBufferedConflict enforces max(earlier.after, later.before)', () => {
  const inspection = { before: 15, after: 45 }

  it('rejects the real 6:30pm slot behind the booked 5:45–6:15pm inspection', () => {
    const conflict = hasBufferedConflict(
      et('18:30'),
      et('19:00'),
      et('17:45'),
      et('18:15'),
      inspection.before,
      inspection.after,
      { before: 15, after: 45 }
    )
    expect(conflict).toBe(true)
  })

  it('allows 7:00pm — exactly 45 minutes after the 6:15pm end', () => {
    const conflict = hasBufferedConflict(
      et('19:00'),
      et('19:30'),
      et('17:45'),
      et('18:15'),
      inspection.before,
      inspection.after,
      { before: 15, after: 45 }
    )
    expect(conflict).toBe(false)
  })

  it('requires the gap to satisfy the max, never the sum', () => {
    // Earlier needs 45 after; later needs 15 before. 45 is enough, 60 is not required.
    const at45 = hasBufferedConflict(
      et('19:00'),
      et('19:30'),
      et('17:45'),
      et('18:15'),
      15,
      45,
      { before: 15, after: 45 }
    )
    expect(at45).toBe(false)
  })

  it('honors the booked appointment buffer even when the new slot needs none', () => {
    // New slot has zero buffers; the existing inspection still claims 45 after.
    const conflict = hasBufferedConflict(
      et('18:30'),
      et('19:00'),
      et('17:45'),
      et('18:15'),
      0,
      0,
      { before: 0, after: 45 }
    )
    expect(conflict).toBe(true)
  })

  it('honors the new slot buffer when booking in front of an existing appointment', () => {
    // New 30-min inspection ending 5:30pm, existing starts 5:45pm — only 15 min behind it.
    const conflict = hasBufferedConflict(
      et('17:00'),
      et('17:30'),
      et('17:45'),
      et('18:15'),
      15,
      45,
      { before: 15, after: 45 }
    )
    expect(conflict).toBe(true)
  })

  it('still catches plain overlaps', () => {
    expect(
      hasBufferedConflict(et('18:00'), et('18:30'), et('17:45'), et('18:15'), 0, 0)
    ).toBe(true)
  })

  it('treats touching ranges as a conflict only when a buffer demands it', () => {
    // Back-to-back with no buffers anywhere is legal.
    expect(
      hasBufferedConflict(et('18:15'), et('18:45'), et('17:45'), et('18:15'), 0, 0)
    ).toBe(false)
  })

  it('omitting existing buffers reproduces the original candidate-only behavior', () => {
    // 15-min gap, candidate needs 45 after but sits behind the existing appointment,
    // so only the candidate's 15-min "before" applies — exactly the old result.
    expect(
      hasBufferedConflict(et('18:30'), et('19:00'), et('17:45'), et('18:15'), 15, 45)
    ).toBe(false)
  })
})

describe('existingBuffersForAppointment handles legacy rows', () => {
  it('uses the stored buffer when present', () => {
    expect(existingBuffersForAppointment(45, 15, 10)).toEqual({ before: 10, after: 45 })
  })

  it('falls back to the closer baseline when NULL (pre-migration rows)', () => {
    expect(existingBuffersForAppointment(null, 15, 10)).toEqual({ before: 10, after: 15 })
    expect(existingBuffersForAppointment(undefined, 15, 10)).toEqual({ before: 10, after: 15 })
  })

  it('respects an explicit stored 0 rather than treating it as missing', () => {
    expect(existingBuffersForAppointment(0, 15, 10)).toEqual({ before: 10, after: 0 })
  })
})
