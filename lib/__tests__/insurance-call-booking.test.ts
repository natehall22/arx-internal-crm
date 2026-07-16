import {
  buildInsuranceHandoffContext,
  isInsuranceFollowUpOutcomeId,
} from '@/lib/insurance-call-booking'

describe('insurance call booking form helpers', () => {
  it('uses the strict normalized insurance follow-up outcome check', () => {
    expect(isInsuranceFollowUpOutcomeId('insurance_follow_up')).toBe(true)
    expect(isInsuranceFollowUpOutcomeId('Insurance Follow Up')).toBe(false)
    expect(isInsuranceFollowUpOutcomeId('insurance')).toBe(false)
    expect(isInsuranceFollowUpOutcomeId(null)).toBe(false)
  })

  it('builds the complete sanitized handoff payload', () => {
    expect(
      buildInsuranceHandoffContext({
        claimFiled: 'yes',
        insuranceCarrier: ' State Farm ',
        claimNumber: ' 12345 ',
        adjusterMeeting: '2026-07-17T10:00',
        decisionMaker: ' Homeowner ',
        bestCallWindow: 'morning',
        contextLine: ' Call after the adjuster meeting ',
      })
    ).toEqual({
      claim_filed: 'yes',
      insurance_carrier: 'State Farm',
      claim_number: '12345',
      adjuster_meeting_at: '2026-07-17T14:00:00.000Z',
      decision_maker: 'Homeowner',
      best_call_window: 'morning',
      context_line: 'Call after the adjuster meeting',
    })
  })
})
