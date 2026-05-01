import {
  DEFAULT_INSIDE_SALES_HANDOFF_DELAY_DAYS,
  DEFAULT_INSPECTION_OUTCOMES,
} from '@/lib/inspection-outcomes'
import {
  getInsideSalesCallability,
  getInsideSalesFollowUpKind,
  getInsideSalesFollowUpStatus,
  hasActiveInsideSalesFollowUp,
  REP_WORKING_HANDOFF_PIPELINE_PREFIX,
} from '@/lib/inside-sales-follow-up'

describe('inside sales follow-up queue visibility', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-05-01T13:00:00.000Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('keeps rep-working handoffs visible before they are callable', () => {
    const opportunity = {
      status: 'in_progress',
      inspection_outcome: 'insurance_follow_up',
      inspection_outcome_at: '2026-05-01T13:00:00.000Z',
      pipeline_stage: REP_WORKING_HANDOFF_PIPELINE_PREFIX,
      follow_up_at: '2026-05-03T13:00:00.000Z',
    }

    expect(getInsideSalesFollowUpKind(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe('handoff')
    expect(hasActiveInsideSalesFollowUp(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe(true)
    expect(getInsideSalesFollowUpStatus(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe('rep_working')
    expect(getInsideSalesCallability(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toEqual({
      callableNow: false,
      eligibleAtIso: '2026-05-03T13:00:00.000Z',
      adminHandoffDelayDays: DEFAULT_INSIDE_SALES_HANDOFF_DELAY_DAYS,
    })
  })

  it("surfaces didn't-sit follow-ups immediately", () => {
    const opportunity = {
      status: 'open',
      inspection_outcome: 'not_home',
      inspection_outcome_at: '2026-05-01T13:00:00.000Z',
      pipeline_stage: null,
      follow_up_at: null,
    }

    expect(getInsideSalesFollowUpKind(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe('didnt_sit')
    expect(hasActiveInsideSalesFollowUp(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe(true)
    expect(getInsideSalesFollowUpStatus(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe('new')
    expect(getInsideSalesCallability(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toEqual({
      callableNow: true,
      eligibleAtIso: null,
      adminHandoffDelayDays: null,
    })
  })

  it('keeps empty-pipeline handoffs visible during the admin wait window', () => {
    const opportunity = {
      status: 'in_progress',
      inspection_outcome: 'insurance_follow_up',
      inspection_outcome_at: '2026-04-30T13:00:00.000Z',
      pipeline_stage: null,
      follow_up_at: null,
    }

    expect(getInsideSalesFollowUpKind(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe('handoff')
    expect(hasActiveInsideSalesFollowUp(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe(true)
    expect(getInsideSalesFollowUpStatus(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe('rep_working')
    expect(getInsideSalesCallability(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toEqual({
      callableNow: false,
      eligibleAtIso: '2026-05-02T13:00:00.000Z',
      adminHandoffDelayDays: DEFAULT_INSIDE_SALES_HANDOFF_DELAY_DAYS,
    })
  })

  it('does not surface handoffs once resolved', () => {
    const opportunity = {
      status: 'in_progress',
      inspection_outcome: 'insurance_follow_up',
      inspection_outcome_at: '2026-04-27T13:00:00.000Z',
      pipeline_stage: 'inside_sales_insurance_follow_up_scheduled',
      follow_up_at: null,
    }

    expect(getInsideSalesFollowUpKind(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBeNull()
    expect(hasActiveInsideSalesFollowUp(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe(false)
    expect(getInsideSalesCallability(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBeNull()
  })
})
