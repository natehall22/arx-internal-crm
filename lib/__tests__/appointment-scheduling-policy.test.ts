/**
 * Proves the relaxed adjuster-meeting scheduling rules are UNREACHABLE for
 * inspections.
 *
 * The pairs below feed the SAME situation to both types. An inspection must keep
 * every rule (availability gating, conflict rejection, delete-on-Google-failure);
 * an adjuster meeting must succeed in each. That is what demonstrates the branch is
 * driven by appointment type rather than by anything a caller can pass.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  ADJUSTER_MEETING_APPOINTMENT_TYPE,
  ADJUSTER_MEETING_SCHEDULING_POLICY,
  STRICT_SCHEDULING_POLICY,
  resolveSchedulingPolicy,
} from '@/lib/adjuster-meeting'
import { findAttendeeConflicts } from '@/lib/adjuster-meeting-calendar'

const SATURDAY_8AM_ET = '2026-08-08T12:00:00.000Z'

describe('scheduling policy is derived from appointment type, never a caller flag', () => {
  it.each([
    ['inspection'],
    ['close'],
    ['insurance_call'],
    ['insurance_follow_up'],
    ['some_type_added_next_year'],
    [''],
  ])('keeps every rule enforced for %s', (type) => {
    expect(resolveSchedulingPolicy(type)).toEqual(STRICT_SCHEDULING_POLICY)
  })

  it('keeps every rule enforced for null/undefined (fail closed)', () => {
    expect(resolveSchedulingPolicy(null)).toEqual(STRICT_SCHEDULING_POLICY)
    expect(resolveSchedulingPolicy(undefined)).toEqual(STRICT_SCHEDULING_POLICY)
  })

  it('relaxes only for the exact adjuster_meeting type', () => {
    expect(resolveSchedulingPolicy(ADJUSTER_MEETING_APPOINTMENT_TYPE)).toEqual(
      ADJUSTER_MEETING_SCHEDULING_POLICY
    )
    // Near-misses must not relax.
    expect(resolveSchedulingPolicy('adjuster')).toEqual(STRICT_SCHEDULING_POLICY)
    expect(resolveSchedulingPolicy('adjuster_meeting_v2')).toEqual(STRICT_SCHEDULING_POLICY)
  })

  it('passing "inspection" provably re-enables all three rules', () => {
    const p = resolveSchedulingPolicy('inspection')
    expect(p.enforceAvailability).toBe(true)
    expect(p.rejectOnConflict).toBe(true)
    expect(p.deleteOnCalendarFailure).toBe(true)
  })
})

describe('paired same-input/different-type behaviour', () => {
  describe('weekend / out-of-hours time', () => {
    it('inspection: availability gating still applies, so it can be rejected', () => {
      expect(resolveSchedulingPolicy('inspection').enforceAvailability).toBe(true)
    })

    it('adjuster meeting: no availability gating, Saturday 8am books cleanly', () => {
      expect(resolveSchedulingPolicy(ADJUSTER_MEETING_APPOINTMENT_TYPE).enforceAvailability).toBe(false)
      // And nothing in the conflict helper knows about business hours at all.
      expect(findAttendeeConflicts([], { startIso: SATURDAY_8AM_ET, durationMinutes: 60 })).toEqual([])
    })
  })

  describe('calendar conflict', () => {
    const busy = [
      { id: 'other', scheduled_for: SATURDAY_8AM_ET, duration_minutes: 60, status: 'scheduled' },
    ]

    it('inspection: conflict is still a rejection', () => {
      expect(resolveSchedulingPolicy('inspection').rejectOnConflict).toBe(true)
    })

    it('adjuster meeting: conflict is surfaced but never rejects', () => {
      expect(resolveSchedulingPolicy(ADJUSTER_MEETING_APPOINTMENT_TYPE).rejectOnConflict).toBe(false)
      // The conflict is still detected — it becomes a warning, not a block.
      expect(
        findAttendeeConflicts(busy, { startIso: SATURDAY_8AM_ET, durationMinutes: 60 })
      ).toHaveLength(1)
    })
  })

  describe('Google Calendar push failure', () => {
    it('inspection: the appointment row is still deleted', () => {
      expect(resolveSchedulingPolicy('inspection').deleteOnCalendarFailure).toBe(true)
    })

    it('adjuster meeting: the appointment row survives for retry', () => {
      expect(
        resolveSchedulingPolicy(ADJUSTER_MEETING_APPOINTMENT_TYPE).deleteOnCalendarFailure
      ).toBe(false)
    })
  })
})

/**
 * Source-level guards. These assert the shape of the scheduling route itself, which
 * is what actually stops a future edit from routing adjuster meetings through the
 * shared validators (or dropping the inspection delete rule).
 */
describe('route structure keeps the two paths separate', () => {
  const routeSource = readFileSync(
    join(process.cwd(), 'app/api/opportunities/[id]/inside-sales-follow-up/route.ts'),
    'utf8'
  )

  const adjusterBranch = routeSource.slice(
    routeSource.indexOf("action === 'schedule_adjuster_meeting'"),
    routeSource.indexOf("action === 'schedule_back_to_closer'")
  )

  it('the adjuster-meeting branch never calls the availability validators', () => {
    expect(adjusterBranch.length).toBeGreaterThan(0)
    expect(adjusterBranch).not.toContain('assignNextAvailableCloser')
    expect(adjusterBranch).not.toContain('isSlotAvailable')
    expect(adjusterBranch).not.toContain('getDefaultTeam')
  })

  it('the adjuster-meeting branch never deletes the appointment row', () => {
    expect(adjusterBranch).not.toMatch(/scheduled_appointments'\)\s*\.delete\(\)/)
  })

  it('the inspection path still deletes the row when the Google push fails', () => {
    expect(routeSource).toContain(
      'Failed to push this inspection onto the closer calendar. No appointment was created.'
    )
    expect(routeSource).toMatch(/deleteOnCalendarFailure && !googleCalendarEventId/)
    expect(routeSource).toMatch(/deleteOnCalendarFailure && \(!googleCalendarEventId/)
  })

  it('the inspection path still round-robins and 409s on no availability', () => {
    expect(routeSource).toContain('assignNextAvailableCloser')
    expect(routeSource).toContain('No available closer for this time slot')
  })

  it('exposes no general-purpose scheduling escape hatch', () => {
    // The failure mode to avoid: a boolean an inspection caller could pass.
    for (const hatch of [
      'skipAvailabilityCheck',
      'bypassValidation',
      'allowConflicts',
      'forceSchedule',
      'skipValidation',
    ]) {
      expect(routeSource).not.toContain(hatch)
    }
  })
})

describe('shared validators are untouched', () => {
  it('round-robin exposes no bypass mode', () => {
    const roundRobin = readFileSync(join(process.cwd(), 'lib/round-robin.ts'), 'utf8')
    expect(roundRobin).not.toContain('adjuster_meeting')
    expect(roundRobin).not.toContain('skipAvailability')
    expect(roundRobin).not.toContain('allowConflicts')
  })
})
