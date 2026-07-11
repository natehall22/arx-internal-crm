import {
  DEFAULT_INSIDE_SALES_HANDOFF_DELAY_DAYS,
  DEFAULT_INSPECTION_OUTCOMES,
} from '@/lib/inspection-outcomes'
import {
  DIDNT_SIT_PIPELINE_PREFIX,
  getInsideSalesCallability,
  getInsideSalesFollowUpKind,
  getInsideSalesFollowUpStatus,
  hasActiveInsideSalesFollowUp,
  HANDOFF_INSIDE_SALES_PIPELINE_PREFIX,
  KNOCKBACK_PIPELINE_PREFIX,
  REP_WORKING_HANDOFF_PIPELINE_PREFIX,
  canViewInsideSalesFollowUp,
  isInsideSalesRoleLike,
  isOpportunityInInsideSalesWorkerScope,
} from '@/lib/inside-sales-follow-up'

describe('inside sales access identity', () => {
  it('recognizes legacy inside_sales and call_center roles', () => {
    expect(isInsideSalesRoleLike({ role: 'inside_sales' })).toBe(true)
    expect(isInsideSalesRoleLike({ role: 'call_center' })).toBe(true)
    expect(canViewInsideSalesFollowUp({ role: 'sales_rep' })).toBe(false)
  })

  it('recognizes custom roles labeled Inside Sales', () => {
    expect(
      isInsideSalesRoleLike({
        role: 'sales_rep',
        customRoleDisplayName: 'Inside Sales (Call Center)',
      })
    ).toBe(true)
  })

  it('recognizes Inside Sales permission preset grants without custom role', () => {
    const presetPerms = new Set(['opportunities:view', 'opportunities:edit', 'leads:claim_inbound', 'scheduling:create'])
    expect(
      isInsideSalesRoleLike({
        role: 'sales_rep',
        permissionNames: presetPerms,
      })
    ).toBe(true)
    expect(
      canViewInsideSalesFollowUp({
        role: 'sales_rep',
        permissionNames: presetPerms,
      })
    ).toBe(true)
  })

  it('does not treat regional managers with manage_inbound as inside sales reps', () => {
    expect(
      isInsideSalesRoleLike({
        role: 'regional_manager',
        permissionNames: new Set(['opportunities:view', 'leads:manage_inbound', 'leads:view_inbound']),
      })
    ).toBe(false)
  })

  it('does not give managers rep conveyor access via claim_inbound grants', () => {
    expect(
      isInsideSalesRoleLike({
        role: 'sales_manager',
        permissionNames: new Set(['opportunities:view', 'leads:claim_inbound']),
      })
    ).toBe(false)
    expect(
      canViewInsideSalesFollowUp({
        role: 'sales_manager',
        permissionNames: new Set(['opportunities:view', 'leads:claim_inbound']),
      })
    ).toBe(true)
  })

  it('does not scope managers to inside-sales lead visibility', () => {
    const { shouldScopeLeadsToInsideSalesWorker } = require('@/lib/inside-sales-follow-up')
    expect(
      shouldScopeLeadsToInsideSalesWorker({
        role: 'regional_manager',
        permissionNames: new Set(['opportunities:view', 'leads:claim_inbound']),
      })
    ).toBe(false)
  })

  it('documents the default Inside Sales preset permission bundle', () => {
    const { INSIDE_SALES_PRESET_PERMISSION_NAMES, hasInsideSalesQueuePermissionGrant } = require('@/lib/inside-sales-follow-up')
    expect(INSIDE_SALES_PRESET_PERMISSION_NAMES).toEqual(
      expect.arrayContaining(['leads:view', 'leads:claim_inbound', 'opportunities:view'])
    )
    expect(hasInsideSalesQueuePermissionGrant(INSIDE_SALES_PRESET_PERMISSION_NAMES)).toBe(true)
  })

  it('scopes opportunity list access to queue, ownership, assignment, and inbound', () => {
    const queueOpportunity = {
      status: 'open',
      pipeline_stage: 'inside_sales_didnt_sit',
      owner_user_id: 'other-user',
      assigned_user_id: null,
    }
    expect(isOpportunityInInsideSalesWorkerScope(queueOpportunity, 'worker-1', null)).toBe(true)
    expect(
      isOpportunityInInsideSalesWorkerScope(
        { status: 'open', owner_user_id: 'worker-1' },
        'worker-1',
        null
      )
    ).toBe(true)
    expect(
      isOpportunityInInsideSalesWorkerScope(
        { status: 'open', assigned_user_id: 'worker-1' },
        'worker-1',
        null
      )
    ).toBe(true)
    expect(
      isOpportunityInInsideSalesWorkerScope(
        { status: 'open', owner_user_id: 'other-user' },
        'worker-1',
        'inbound'
      )
    ).toBe(true)
    expect(
      isOpportunityInInsideSalesWorkerScope(
        { status: 'won', pipeline_stage: 'inside_sales_didnt_sit' },
        'worker-1',
        null
      )
    ).toBe(false)
    expect(
      isOpportunityInInsideSalesWorkerScope(
        { status: 'open', owner_user_id: 'other-user' },
        'worker-1',
        'door_to_door'
      )
    ).toBe(false)
  })
})

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

  it('uses admin-configured inside sales delay days for queue callability', () => {
    const orgOutcomes = DEFAULT_INSPECTION_OUTCOMES.map((outcome) =>
      outcome.id === 'insurance_follow_up'
        ? { ...outcome, inside_sales_handoff_enabled: true, inside_sales_handoff_delay_days: 7 }
        : outcome
    )
    const opportunity = {
      status: 'in_progress',
      inspection_outcome: 'insurance_follow_up',
      inspection_outcome_at: '2026-04-30T13:00:00.000Z',
      pipeline_stage: null,
      follow_up_at: null,
    }

    expect(getInsideSalesFollowUpKind(opportunity, orgOutcomes)).toBe('handoff')
    expect(hasActiveInsideSalesFollowUp(opportunity, orgOutcomes)).toBe(true)
    expect(getInsideSalesFollowUpStatus(opportunity, orgOutcomes)).toBe('rep_working')
    expect(getInsideSalesCallability(opportunity, orgOutcomes)).toEqual({
      callableNow: false,
      eligibleAtIso: '2026-05-07T13:00:00.000Z',
      adminHandoffDelayDays: 7,
    })
  })

  it('marks admin-configured handoffs callable after the configured delay passes', () => {
    const orgOutcomes = DEFAULT_INSPECTION_OUTCOMES.map((outcome) =>
      outcome.id === 'insurance_follow_up'
        ? { ...outcome, inside_sales_handoff_enabled: true, inside_sales_handoff_delay_days: 7 }
        : outcome
    )
    const opportunity = {
      status: 'in_progress',
      inspection_outcome: 'insurance_follow_up',
      inspection_outcome_at: '2026-04-23T12:59:59.000Z',
      pipeline_stage: null,
      follow_up_at: null,
    }

    expect(getInsideSalesFollowUpStatus(opportunity, orgOutcomes)).toBe('new')
    expect(getInsideSalesCallability(opportunity, orgOutcomes)).toEqual({
      callableNow: true,
      eligibleAtIso: null,
      adminHandoffDelayDays: 7,
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

  it("does not surface didn't-sit follow-ups once scheduled back to closer", () => {
    const opportunity = {
      status: 'open',
      inspection_outcome: null,
      inspection_outcome_at: null,
      pipeline_stage: `${DIDNT_SIT_PIPELINE_PREFIX}_rescheduled`,
      follow_up_at: null,
    }

    expect(getInsideSalesFollowUpKind(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBeNull()
    expect(hasActiveInsideSalesFollowUp(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe(false)
    expect(getInsideSalesCallability(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBeNull()
  })

  it('surfaces close-feedback handoffs even without an inspection outcome', () => {
    const opportunity = {
      status: 'in_progress',
      inspection_outcome: null,
      inspection_outcome_at: null,
      pipeline_stage: 'inside_sales_insurance_follow_up',
      follow_up_at: '2026-05-01T13:00:00.000Z',
    }

    expect(getInsideSalesFollowUpKind(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe('handoff')
    expect(hasActiveInsideSalesFollowUp(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe(true)
    expect(getInsideSalesFollowUpStatus(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe('new')
    expect(getInsideSalesCallability(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toEqual({
      callableNow: true,
      eligibleAtIso: null,
      adminHandoffDelayDays: null,
    })
  })

  it('keeps close-feedback rep-working handoffs visible before the follow-up time', () => {
    const opportunity = {
      status: 'in_progress',
      inspection_outcome: null,
      inspection_outcome_at: null,
      pipeline_stage: REP_WORKING_HANDOFF_PIPELINE_PREFIX,
      follow_up_at: '2026-05-03T13:00:00.000Z',
    }

    expect(getInsideSalesFollowUpKind(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe('handoff')
    expect(hasActiveInsideSalesFollowUp(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe(true)
    expect(getInsideSalesFollowUpStatus(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe('rep_working')
    expect(getInsideSalesCallability(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toEqual({
      callableNow: false,
      eligibleAtIso: '2026-05-03T13:00:00.000Z',
      adminHandoffDelayDays: null,
    })
  })

  it('makes close-feedback rep-working handoffs callable when follow-up time is due', () => {
    const opportunity = {
      status: 'in_progress',
      inspection_outcome: null,
      inspection_outcome_at: null,
      pipeline_stage: REP_WORKING_HANDOFF_PIPELINE_PREFIX,
      follow_up_at: '2026-05-01T12:59:00.000Z',
    }

    expect(getInsideSalesFollowUpKind(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe('handoff')
    expect(getInsideSalesFollowUpStatus(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe('new')
    expect(getInsideSalesCallability(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toEqual({
      callableNow: true,
      eligibleAtIso: '2026-05-01T12:59:00.000Z',
      adminHandoffDelayDays: null,
    })
  })

  it('keeps active handoffs out of ready calls until their next follow-up time', () => {
    const opportunity = {
      status: 'in_progress',
      inspection_outcome: null,
      inspection_outcome_at: null,
      pipeline_stage: HANDOFF_INSIDE_SALES_PIPELINE_PREFIX,
      follow_up_at: '2026-05-01T18:00:00.000Z',
    }

    expect(getInsideSalesCallability(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toEqual({
      callableNow: false,
      eligibleAtIso: '2026-05-01T18:00:00.000Z',
      adminHandoffDelayDays: null,
    })
  })

  it('does not surface close-feedback handoffs when the opportunity is lost', () => {
    const opportunity = {
      status: 'lost',
      inspection_outcome: null,
      inspection_outcome_at: null,
      pipeline_stage: 'inside_sales_insurance_follow_up',
      follow_up_at: '2026-05-01T13:00:00.000Z',
    }

    expect(hasActiveInsideSalesFollowUp(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe(false)
    expect(getInsideSalesCallability(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBeNull()
  })

  it('detects knockback pipeline before didnt_sit inspection routing', () => {
    const opportunity = {
      status: 'open',
      inspection_outcome: 'not_home',
      inspection_outcome_at: '2026-05-01T13:00:00.000Z',
      pipeline_stage: KNOCKBACK_PIPELINE_PREFIX,
      follow_up_at: '2026-07-01T13:00:00.000Z',
    }

    expect(getInsideSalesFollowUpKind(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe('knockback')
    expect(hasActiveInsideSalesFollowUp(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe(true)
    expect(getInsideSalesFollowUpStatus(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe('new')
  })

  it('treats future knockback follow_up_at as not callable yet', () => {
    const opportunity = {
      status: 'open',
      inspection_outcome: null,
      inspection_outcome_at: null,
      pipeline_stage: KNOCKBACK_PIPELINE_PREFIX,
      follow_up_at: '2026-07-01T13:00:00.000Z',
    }

    expect(getInsideSalesCallability(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toEqual({
      callableNow: false,
      eligibleAtIso: '2026-07-01T13:00:00.000Z',
      adminHandoffDelayDays: null,
    })
  })

  it('excludes resolved knockback stages from the active queue', () => {
    const opportunity = {
      status: 'open',
      inspection_outcome: null,
      inspection_outcome_at: null,
      pipeline_stage: `${KNOCKBACK_PIPELINE_PREFIX}_lost`,
      follow_up_at: null,
    }

    expect(getInsideSalesFollowUpKind(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBeNull()
    expect(hasActiveInsideSalesFollowUp(opportunity, DEFAULT_INSPECTION_OUTCOMES)).toBe(false)
  })
})
