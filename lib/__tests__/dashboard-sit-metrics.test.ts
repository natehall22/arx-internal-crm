import {
  countSitsByOwner,
  countSitsBySetter,
  countSitsScoped,
  pickFirstQualifyingInspection,
  type EffectiveSitOpportunity,
  type OpportunityRowForSitMetrics,
} from '@/lib/dashboard-sit-metrics'

const sitOutcomeIdSet = new Set(['failed_credit', 'no_problems_found', 'moving_to_close'])
const nonSitOutcomeOpp: OpportunityRowForSitMetrics = { id: 'opp-x', lead_id: 'lead-x' }

const sampleSits: EffectiveSitOpportunity[] = [
  {
    id: 'opp-1',
    lead_id: 'lead-1',
    setter_user_id: 'setter-a',
    owner_user_id: 'closer-a',
    inspection_outcome: 'moving_to_close',
    inspection_outcome_at: '2026-05-29T20:03:06.798Z',
  },
  {
    id: 'opp-2',
    lead_id: 'lead-2',
    setter_user_id: 'setter-a',
    owner_user_id: 'closer-a',
    inspection_outcome: 'insurance_follow_up',
    inspection_outcome_at: '2026-05-26T19:48:47.691Z',
  },
  {
    id: 'opp-3',
    lead_id: 'lead-3',
    setter_user_id: 'setter-b',
    owner_user_id: 'closer-a',
    inspection_outcome: 'insurance_follow_up',
    inspection_outcome_at: '2026-05-28T12:00:00.000Z',
  },
]

describe('dashboard-sit-metrics attribution', () => {
  it('counts sits per setter', () => {
    const counts = countSitsBySetter(sampleSits, ['setter-a', 'setter-b', 'closer-a'])
    expect(counts.get('setter-a')).toBe(2)
    expect(counts.get('setter-b')).toBe(1)
    expect(counts.get('closer-a')).toBeUndefined()
  })

  it('counts sits per closer owner', () => {
    const counts = countSitsByOwner(sampleSits, ['closer-a', 'setter-a'])
    expect(counts.get('closer-a')).toBe(3)
  })

  it('counts scoped personal sits for setter lane', () => {
    expect(countSitsScoped(sampleSits, ['setter-a'], true)).toBe(2)
    expect(countSitsScoped(sampleSits, ['closer-a'], false)).toBe(3)
    expect(countSitsScoped(sampleSits, [], true)).toBe(3)
  })
})

describe('pickFirstQualifyingInspection', () => {
  it('uses the first sit, ignoring a later re-attempt at the same opportunity (Jeremy Laws)', () => {
    const opp: OpportunityRowForSitMetrics = { id: 'opp-jeremy', lead_id: 'lead-jeremy' }
    const statusRows = [
      { opportunity_id: 'opp-jeremy', lead_id: 'lead-jeremy', outcome: 'failed_credit', created_at: '2026-07-08T23:30:02.978Z' },
      { opportunity_id: 'opp-jeremy', lead_id: 'lead-jeremy', outcome: 'failed_credit', created_at: '2026-07-01T12:46:12.778Z' },
    ]
    expect(pickFirstQualifyingInspection(opp, statusRows, sitOutcomeIdSet)).toEqual({
      outcome: 'failed_credit',
      outcome_at: '2026-07-01T12:46:12.778Z',
    })
  })

  it('skips a not_home/rescheduled first attempt and uses the first outcome that actually counts as a sit', () => {
    const opp: OpportunityRowForSitMetrics = { id: 'opp-reset', lead_id: 'lead-reset' }
    const statusRows = [
      { opportunity_id: 'opp-reset', lead_id: 'lead-reset', outcome: 'no_problems_found', created_at: '2026-07-08T20:00:00.000Z' },
      { opportunity_id: 'opp-reset', lead_id: 'lead-reset', outcome: 'rescheduled', created_at: '2026-07-03T18:00:00.000Z' },
      { opportunity_id: 'opp-reset', lead_id: 'lead-reset', outcome: 'not_home', created_at: '2026-07-01T15:00:00.000Z' },
    ]
    expect(pickFirstQualifyingInspection(opp, statusRows, sitOutcomeIdSet)).toEqual({
      outcome: 'no_problems_found',
      outcome_at: '2026-07-08T20:00:00.000Z',
    })
  })

  it('returns null when no candidate outcome counts as a sit', () => {
    const statusRows = [
      { opportunity_id: 'opp-x', lead_id: 'lead-x', outcome: 'not_home', created_at: '2026-07-01T15:00:00.000Z' },
    ]
    expect(pickFirstQualifyingInspection(nonSitOutcomeOpp, statusRows, sitOutcomeIdSet)).toBeNull()
  })

  it('ignores a status row tied to a different opportunity on the same re-knocked lead', () => {
    const currentOpp: OpportunityRowForSitMetrics = { id: 'opp-new', lead_id: 'lead-shared' }
    const statusRows = [
      // Belongs to an older, unrelated opportunity on the same lead (lead re-knocked later).
      { opportunity_id: 'opp-old', lead_id: 'lead-shared', outcome: 'no_problems_found', created_at: '2025-01-01T12:00:00.000Z' },
      // This opportunity's own, more recent sit.
      { opportunity_id: 'opp-new', lead_id: 'lead-shared', outcome: 'moving_to_close', created_at: '2026-07-08T20:00:00.000Z' },
    ]
    expect(pickFirstQualifyingInspection(currentOpp, statusRows, sitOutcomeIdSet)).toEqual({
      outcome: 'moving_to_close',
      outcome_at: '2026-07-08T20:00:00.000Z',
    })
  })

  it('does not let an orphaned status row match a lead with more than one opportunity in the batch (no double-pay)', () => {
    // Same shared lead, but this time there's no non-orphaned row disambiguating
    // which opportunity the legacy row belongs to — without the ambiguousLeadIds
    // guard, both opp-old and opp-new would independently claim this one row.
    const oppOld: OpportunityRowForSitMetrics = { id: 'opp-old', lead_id: 'lead-shared' }
    const oppNew: OpportunityRowForSitMetrics = { id: 'opp-new', lead_id: 'lead-shared' }
    const statusRows = [
      { opportunity_id: null, lead_id: 'lead-shared', outcome: 'moving_to_close', created_at: '2026-07-01T12:00:00.000Z' },
    ]
    const ambiguousLeadIds = new Set(['lead-shared'])

    expect(pickFirstQualifyingInspection(oppOld, statusRows, sitOutcomeIdSet, ambiguousLeadIds)).toBeNull()
    expect(pickFirstQualifyingInspection(oppNew, statusRows, sitOutcomeIdSet, ambiguousLeadIds)).toBeNull()
  })

  it('still falls back to a legacy status row that has a lead_id but no opportunity_id', () => {
    const opp: OpportunityRowForSitMetrics = { id: 'opp-legacy', lead_id: 'lead-legacy' }
    const statusRows = [
      { opportunity_id: null, lead_id: 'lead-legacy', outcome: 'said_no', created_at: '2026-07-02T10:00:00.000Z' },
    ]
    expect(pickFirstQualifyingInspection(opp, statusRows, new Set(['said_no']))).toEqual({
      outcome: 'said_no',
      outcome_at: '2026-07-02T10:00:00.000Z',
    })
  })

  it('skips a candidate with an unparseable created_at instead of letting it corrupt the sort', () => {
    const opp: OpportunityRowForSitMetrics = { id: 'opp-bad-ts', lead_id: 'lead-bad-ts' }
    const statusRows = [
      { opportunity_id: 'opp-bad-ts', lead_id: 'lead-bad-ts', outcome: 'no_problems_found', created_at: 'not-a-date' },
      { opportunity_id: 'opp-bad-ts', lead_id: 'lead-bad-ts', outcome: 'no_problems_found', created_at: '2026-07-05T09:00:00.000Z' },
    ]
    expect(pickFirstQualifyingInspection(opp, statusRows, sitOutcomeIdSet)).toEqual({
      outcome: 'no_problems_found',
      outcome_at: '2026-07-05T09:00:00.000Z',
    })
  })

  it('falls back to the opportunity columns when there are no status-update rows', () => {
    const opp: OpportunityRowForSitMetrics = {
      id: 'opp-james',
      lead_id: 'lead-james',
      inspection_outcome: 'no_problems_found',
      inspection_outcome_at: '2026-07-08T23:30:57.382Z',
    }
    expect(pickFirstQualifyingInspection(opp, [], sitOutcomeIdSet)).toEqual({
      outcome: 'no_problems_found',
      outcome_at: '2026-07-08T23:30:57.382Z',
    })
  })
})
