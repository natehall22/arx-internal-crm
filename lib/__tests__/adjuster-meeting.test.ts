import {
  ADJUSTER_MEETING_APPOINTMENT_TYPE,
  DEFAULT_ADJUSTER_MEETING_DURATION_MINUTES,
  canCompleteAdjusterMeeting,
  insideSalesMayMutateAppointmentStatus,
  isAdjusterMeeting,
  normalizeAdjusterMeetingDuration,
} from '@/lib/adjuster-meeting'
import {
  INSPECTION_SET_APPOINTMENT_TYPE_OR,
  countsAsInspectionSet,
} from '@/lib/inspection-set-metrics'
import {
  countsAsInsideSalesSitCredit,
  INSIDE_SALES_SIT_CREDIT_APPOINTMENT_TYPE_LIST,
} from '@/lib/inside-sales-booker-attribution'

const RODA = 'user-roda'
const NATHAN = 'user-nathan'
const ANDREW = 'user-andrew'
const CUTOFF = '2026-08-01'

const meeting = {
  appointment_type: ADJUSTER_MEETING_APPOINTMENT_TYPE,
  closer_user_id: NATHAN,
  inside_sales_booked_by_user_id: RODA,
}

describe('adjuster_meeting type basics', () => {
  it('recognises the type and defaults to a physical-meeting duration', () => {
    expect(isAdjusterMeeting(meeting)).toBe(true)
    expect(isAdjusterMeeting({ appointment_type: 'insurance_call' })).toBe(false)
    // 15 minutes is a phone-call default and wrong for driving out and walking a roof.
    expect(DEFAULT_ADJUSTER_MEETING_DURATION_MINUTES).toBe(60)
  })

  it('clamps caller-supplied durations to a sane range', () => {
    expect(normalizeAdjusterMeetingDuration(90)).toBe(90)
    expect(normalizeAdjusterMeetingDuration(2)).toBe(15)
    expect(normalizeAdjusterMeetingDuration(99999)).toBe(480)
    expect(normalizeAdjusterMeetingDuration('nonsense')).toBe(60)
    expect(normalizeAdjusterMeetingDuration(undefined)).toBe(60)
  })
})

describe('completion authority — the person paid must not certify the work', () => {
  it('lets the attending rep complete it', () => {
    const d = canCompleteAdjusterMeeting({ appointment: meeting, userId: NATHAN, role: 'sales_rep' })
    expect(d).toEqual({ allowed: true, reason: 'allowed_attendee' })
  })

  it('rejects the inside-sales booker completing their own payday', () => {
    const d = canCompleteAdjusterMeeting({ appointment: meeting, userId: RODA, role: 'canvasser' })
    expect(d).toEqual({ allowed: false, reason: 'booker_cannot_self_complete' })
  })

  it('still rejects the booker even when they hold a payroll-admin role', () => {
    // Otherwise an admin-flagged inside rep walks straight back into the self-serve hole.
    const d = canCompleteAdjusterMeeting({ appointment: meeting, userId: RODA, role: 'admin' })
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('booker_cannot_self_complete')
  })

  it('lets a payroll/ops admin who is not the booker close the loop', () => {
    for (const role of ['admin', 'owner', 'operations']) {
      const d = canCompleteAdjusterMeeting({ appointment: meeting, userId: ANDREW, role })
      expect(d).toEqual({ allowed: true, reason: 'allowed_admin' })
    }
  })

  it('rejects an unrelated rep', () => {
    const d = canCompleteAdjusterMeeting({ appointment: meeting, userId: 'user-someone', role: 'sales_rep' })
    expect(d).toEqual({ allowed: false, reason: 'not_attendee_or_admin' })
  })

  it('rejects completion when nobody is assigned to attend', () => {
    const d = canCompleteAdjusterMeeting({
      appointment: { ...meeting, closer_user_id: null },
      userId: NATHAN,
      role: 'admin',
    })
    expect(d).toEqual({ allowed: false, reason: 'no_attendee_assigned' })
  })

  it('rejects the booker even when a bad row also assigns them as attendee', () => {
    const d = canCompleteAdjusterMeeting({
      appointment: { ...meeting, closer_user_id: RODA },
      userId: RODA,
      role: 'canvasser',
    })
    expect(d).toEqual({ allowed: false, reason: 'booker_cannot_self_complete' })
  })

  it('does not interfere with any other appointment type', () => {
    const d = canCompleteAdjusterMeeting({
      appointment: { appointment_type: 'inspection', closer_user_id: NATHAN },
      userId: 'anyone',
      role: null,
    })
    expect(d).toEqual({ allowed: true, reason: 'not_an_adjuster_meeting' })
  })
})

describe('the inside-sales path can never complete an adjuster meeting', () => {
  it('excludes adjuster_meeting from the statuses inside sales may mutate', () => {
    expect(insideSalesMayMutateAppointmentStatus('insurance_call')).toBe(true)
    expect(insideSalesMayMutateAppointmentStatus(ADJUSTER_MEETING_APPOINTMENT_TYPE)).toBe(false)
    expect(insideSalesMayMutateAppointmentStatus('inspection')).toBe(false)
  })
})

describe('adjuster_meeting must never be treated as an inspection set', () => {
  it('does not count as an inspection set, so it mints no 1.5% inspection line', () => {
    // countsAsInspectionSet feeds lib/job-inspector-attribution.ts. If adjuster_meeting
    // slipped in, every meeting would create an inspection commission line and inflate
    // setter "inspections set" metrics.
    expect(
      countsAsInspectionSet({ appointment_type: ADJUSTER_MEETING_APPOINTMENT_TYPE, status: 'completed' })
    ).toBe(false)
    expect(
      countsAsInspectionSet({ appointment_type: ADJUSTER_MEETING_APPOINTMENT_TYPE, status: 'scheduled' })
    ).toBe(false)
  })

  it('is not selectable by the inspection-set PostgREST filter', () => {
    expect(INSPECTION_SET_APPOINTMENT_TYPE_OR).toBe(
      'appointment_type.is.null,appointment_type.eq.inspection'
    )
    expect(INSPECTION_SET_APPOINTMENT_TYPE_OR).not.toContain('adjuster_meeting')
  })

  it('still counts a real inspection, proving the guard is not over-broad', () => {
    expect(countsAsInspectionSet({ appointment_type: 'inspection', status: 'completed' })).toBe(true)
  })
})

describe('adjuster_meeting sit credit eligibility', () => {
  const base = {
    id: 'appt-1',
    opportunity_id: 'opp-1',
    lead_id: 'lead-1',
    appointment_type: ADJUSTER_MEETING_APPOINTMENT_TYPE,
    scheduled_for: '2026-08-08T12:00:00.000Z',
    inside_sales_booked_by_user_id: RODA,
    inside_sales_sit_credit_excluded: false,
  }

  it('is a creditable type', () => {
    expect(INSIDE_SALES_SIT_CREDIT_APPOINTMENT_TYPE_LIST).toContain(ADJUSTER_MEETING_APPOINTMENT_TYPE)
  })

  it('no longer credits insurance_follow_up — those are closer-booked, not inside sales', () => {
    expect(INSIDE_SALES_SIT_CREDIT_APPOINTMENT_TYPE_LIST).not.toContain('insurance_follow_up')
    expect(
      countsAsInsideSalesSitCredit(
        { ...base, appointment_type: 'insurance_follow_up', status: 'completed' },
        CUTOFF
      )
    ).toBe(false)
  })

  it('pays only on completed', () => {
    expect(countsAsInsideSalesSitCredit({ ...base, status: 'completed' }, CUTOFF)).toBe(true)
  })

  it('pays nothing on no_show or cancelled — both common in prod', () => {
    expect(countsAsInsideSalesSitCredit({ ...base, status: 'no_show' }, CUTOFF)).toBe(false)
    expect(countsAsInsideSalesSitCredit({ ...base, status: 'cancelled' }, CUTOFF)).toBe(false)
    expect(countsAsInsideSalesSitCredit({ ...base, status: 'scheduled' }, CUTOFF)).toBe(false)
  })
})
