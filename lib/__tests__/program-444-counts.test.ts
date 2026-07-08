import { computeEnrollmentCounts, type CountableEnrollment } from '@/lib/sync-444-core'
import { countsAsInspectionSet } from '@/lib/inspection-set-metrics'

// Fixtures use real America/New_York week boundaries:
//   Week 1: Sun 2026-06-07 00:00 ET (04:00Z) → Sun 2026-06-14 00:00 ET (exclusive)
//   Week 2: Sun 2026-06-14 00:00 ET (04:00Z) → Sun 2026-06-21 00:00 ET (exclusive)
const WEEK1_START = '2026-06-07T04:00:00.000Z'
const WEEK1_END = '2026-06-14T04:00:00.000Z'
const WEEK2_START = '2026-06-14T04:00:00.000Z'
const WEEK2_END = '2026-06-21T04:00:00.000Z'

type LeadFixture = {
  owner_user_id: string | null
  pin_attributed_user_id: string | null
  created_at: string
}

type AppointmentFixture = {
  canvasser_user_id: string | null
  created_at: string
  appointment_type?: string | null
  status?: string | null
}

// ── Reference implementation ───────────────────────────────────────────────────
// A deliberately independent re-statement of the EXACT counting semantics the
// sync used inline before the extraction: pin_attributed_user_id wins over
// owner_user_id, appointments keyed by canvasser_user_id, half-open [start, end)
// windows. If computeEnrollmentCounts ever drifts from what the sync persists,
// this reference diverges and the test fails.
function refAttribute(l: LeadFixture): string | null {
  return l.pin_attributed_user_id || l.owner_user_id || null
}

function refCount<T>(
  rows: T[],
  getUser: (row: T) => string | null,
  getTs: (row: T) => string,
  userId: string,
  start: string,
  end: string,
): number {
  const s = new Date(start).getTime()
  const e = new Date(end).getTime()
  return rows.filter((row) => {
    if (getUser(row) !== userId) return false
    if ('appointment_type' in (row as object) || 'status' in (row as object)) {
      if (!countsAsInspectionSet(row as AppointmentFixture)) return false
    }
    const ts = new Date(getTs(row)).getTime()
    return ts >= s && ts < e
  }).length
}

function referenceCounts(
  enrollments: CountableEnrollment[],
  leads: LeadFixture[],
  appointments: AppointmentFixture[],
) {
  const out: Record<string, { week1_doors: number; week1_inspections: number; week2_doors: number; week2_inspections: number }> = {}
  for (const en of enrollments) {
    out[en.id] = {
      week1_doors: refCount(leads, refAttribute, (l) => l.created_at, en.user_id, en.week1_starts_at, en.week1_ends_at),
      week1_inspections: refCount(appointments, (a) => a.canvasser_user_id, (a) => a.created_at, en.user_id, en.week1_starts_at, en.week1_ends_at),
      week2_doors: refCount(leads, refAttribute, (l) => l.created_at, en.user_id, en.week2_starts_at, en.week2_ends_at),
      week2_inspections: refCount(appointments, (a) => a.canvasser_user_id, (a) => a.created_at, en.user_id, en.week2_starts_at, en.week2_ends_at),
    }
  }
  return out
}

describe('computeEnrollmentCounts', () => {
  const enrollment: CountableEnrollment = {
    id: 'enr-1',
    user_id: 'rep-1',
    week1_starts_at: WEEK1_START,
    week1_ends_at: WEEK1_END,
    week2_starts_at: WEEK2_START,
    week2_ends_at: WEEK2_END,
  }

  it('counts doors and inspections per week within half-open [start, end) windows', () => {
    const leads: LeadFixture[] = [
      // Week 1: start boundary is inclusive (>= start)
      { owner_user_id: 'rep-1', pin_attributed_user_id: null, created_at: WEEK1_START },
      { owner_user_id: 'rep-1', pin_attributed_user_id: null, created_at: '2026-06-10T15:00:00.000Z' },
      // Week 1 end boundary is EXCLUSIVE — this is the first instant of week 2,
      // so it must count toward week 2, never week 1.
      { owner_user_id: 'rep-1', pin_attributed_user_id: null, created_at: WEEK1_END },
      // Week 2
      { owner_user_id: 'rep-1', pin_attributed_user_id: null, created_at: '2026-06-16T12:00:00.000Z' },
    ]
    const appointments: AppointmentFixture[] = [
      { canvasser_user_id: 'rep-1', created_at: '2026-06-09T18:00:00.000Z' },
      // Exactly on the exclusive end of week 2 — outside both windows.
      { canvasser_user_id: 'rep-1', created_at: WEEK2_END },
    ]

    const result = computeEnrollmentCounts([enrollment], leads, appointments)
    const counts = result.get('enr-1')

    expect(counts).toEqual({
      week1_doors: 2, // WEEK1_START + mid-week; the WEEK1_END lead rolls to week 2
      week1_inspections: 1,
      week2_doors: 2, // WEEK1_END boundary lead + mid-week-2 lead
      week2_inspections: 0, // the only week-2 appointment sits on the exclusive end
    })
  })

  it('attributes leads by pin_attributed_user_id over owner_user_id (matches sync)', () => {
    const leads: LeadFixture[] = [
      // Pin attribution wins: counts for rep-1 even though owner is rep-2.
      { owner_user_id: 'rep-2', pin_attributed_user_id: 'rep-1', created_at: '2026-06-08T12:00:00.000Z' },
      // Owner-only attribution: counts for rep-1.
      { owner_user_id: 'rep-1', pin_attributed_user_id: null, created_at: '2026-06-08T13:00:00.000Z' },
      // Neither owner nor pin → excluded entirely.
      { owner_user_id: null, pin_attributed_user_id: null, created_at: '2026-06-08T14:00:00.000Z' },
      // Belongs to a different rep → not counted for rep-1.
      { owner_user_id: 'rep-2', pin_attributed_user_id: null, created_at: '2026-06-08T15:00:00.000Z' },
    ]

    const counts = computeEnrollmentCounts([enrollment], leads, []).get('enr-1')
    expect(counts?.week1_doors).toBe(2)
  })

  it('ignores appointments with a null canvasser', () => {
    const appointments: AppointmentFixture[] = [
      { canvasser_user_id: null, created_at: '2026-06-09T18:00:00.000Z' },
      { canvasser_user_id: 'rep-1', created_at: '2026-06-09T19:00:00.000Z' },
    ]
    const counts = computeEnrollmentCounts([enrollment], [], appointments).get('enr-1')
    expect(counts?.week1_inspections).toBe(1)
  })

  it('excludes close appointments and cancelled reschedule orphans', () => {
    const appointments: AppointmentFixture[] = [
      { canvasser_user_id: 'rep-1', created_at: '2026-06-09T18:00:00.000Z' },
      {
        canvasser_user_id: 'rep-1',
        created_at: '2026-06-09T19:00:00.000Z',
        appointment_type: 'close',
        status: 'scheduled',
      },
      {
        canvasser_user_id: 'rep-1',
        created_at: '2026-06-09T20:00:00.000Z',
        appointment_type: 'inspection',
        status: 'cancelled',
      },
    ]
    const counts = computeEnrollmentCounts([enrollment], [], appointments).get('enr-1')
    expect(counts?.week1_inspections).toBe(1)
  })

  it('keeps each enrollment isolated, including a mid-week-enrolled rep', () => {
    // rep-2 enrolled mid-week — its windows differ from rep-1's. The counter must
    // bucket each rep's activity strictly by that rep's own windows.
    const midWeek: CountableEnrollment = {
      id: 'enr-2',
      user_id: 'rep-2',
      week1_starts_at: '2026-06-14T04:00:00.000Z',
      week1_ends_at: '2026-06-21T04:00:00.000Z',
      week2_starts_at: '2026-06-21T04:00:00.000Z',
      week2_ends_at: '2026-06-28T04:00:00.000Z',
    }
    const leads: LeadFixture[] = [
      { owner_user_id: 'rep-1', pin_attributed_user_id: null, created_at: '2026-06-10T12:00:00.000Z' }, // rep-1 wk1
      { owner_user_id: 'rep-2', pin_attributed_user_id: null, created_at: '2026-06-16T12:00:00.000Z' }, // rep-2 wk1
      { owner_user_id: 'rep-2', pin_attributed_user_id: null, created_at: '2026-06-23T12:00:00.000Z' }, // rep-2 wk2
    ]

    const result = computeEnrollmentCounts([enrollment, midWeek], leads, [])
    expect(result.get('enr-1')).toEqual({ week1_doors: 1, week1_inspections: 0, week2_doors: 0, week2_inspections: 0 })
    expect(result.get('enr-2')).toEqual({ week1_doors: 1, week1_inspections: 0, week2_doors: 1, week2_inspections: 0 })
  })

  it('matches the independent reference implementation across a mixed dataset', () => {
    const enrollments = [
      enrollment,
      {
        id: 'enr-3',
        user_id: 'rep-3',
        week1_starts_at: WEEK1_START,
        week1_ends_at: WEEK1_END,
        week2_starts_at: WEEK2_START,
        week2_ends_at: WEEK2_END,
      },
    ]
    const leads: LeadFixture[] = [
      { owner_user_id: 'rep-2', pin_attributed_user_id: 'rep-1', created_at: '2026-06-07T04:00:00.000Z' },
      { owner_user_id: 'rep-1', pin_attributed_user_id: null, created_at: '2026-06-13T23:59:59.000Z' },
      { owner_user_id: 'rep-1', pin_attributed_user_id: null, created_at: WEEK1_END },
      { owner_user_id: null, pin_attributed_user_id: 'rep-3', created_at: '2026-06-15T10:00:00.000Z' },
      { owner_user_id: 'rep-3', pin_attributed_user_id: null, created_at: '2026-06-20T10:00:00.000Z' },
      { owner_user_id: null, pin_attributed_user_id: null, created_at: '2026-06-10T10:00:00.000Z' },
    ]
    const appointments: AppointmentFixture[] = [
      { canvasser_user_id: 'rep-1', created_at: '2026-06-08T10:00:00.000Z' },
      { canvasser_user_id: 'rep-1', created_at: '2026-06-09T10:00:00.000Z' },
      { canvasser_user_id: 'rep-3', created_at: '2026-06-16T10:00:00.000Z' },
      { canvasser_user_id: null, created_at: '2026-06-16T11:00:00.000Z' },
    ]

    const actual = computeEnrollmentCounts(enrollments, leads, appointments)
    const expected = referenceCounts(enrollments, leads, appointments)

    for (const en of enrollments) {
      expect(actual.get(en.id)).toEqual(expected[en.id])
    }
  })

  it('returns an empty map when there are no enrollments', () => {
    expect(computeEnrollmentCounts([], [], []).size).toBe(0)
  })
})
