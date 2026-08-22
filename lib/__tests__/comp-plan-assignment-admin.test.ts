import { primaryCompPlanRowActions } from '@/lib/comp-plan-assignment-admin'

const TODAY = '2026-08-19'

describe('primaryCompPlanRowActions', () => {
  it('shows Assign plan when the user has never had a primary assignment', () => {
    expect(
      primaryCompPlanRowActions({
        hasCurrent: false,
        hasScheduled: false,
        currentEffectiveTo: null,
        today: TODAY,
      })
    ).toEqual({
      showEndPlan: false,
      showCancelScheduled: false,
      showAssignPlan: true,
      assignPlanLabel: 'Assign plan',
    })
  })

  it('still shows Assign after a plan has ended — historical rows must not hide it', () => {
    expect(
      primaryCompPlanRowActions({
        hasCurrent: false,
        hasScheduled: false,
        currentEffectiveTo: '2026-08-18',
        today: TODAY,
      })
    ).toEqual({
      showEndPlan: false,
      showCancelScheduled: false,
      showAssignPlan: true,
      assignPlanLabel: 'Assign plan',
    })
  })

  it('lets a current open-ended plan be replaced tomorrow without ending first', () => {
    expect(
      primaryCompPlanRowActions({
        hasCurrent: true,
        hasScheduled: false,
        currentEffectiveTo: null,
        today: TODAY,
      })
    ).toEqual({
      showEndPlan: true,
      showCancelScheduled: false,
      showAssignPlan: true,
      assignPlanLabel: 'Assign next plan',
    })
  })

  it('hides End plan once the current assignment already ends today, and still offers Assign next plan', () => {
    expect(
      primaryCompPlanRowActions({
        hasCurrent: true,
        hasScheduled: false,
        currentEffectiveTo: TODAY,
        today: TODAY,
      })
    ).toEqual({
      showEndPlan: false,
      showCancelScheduled: false,
      showAssignPlan: true,
      assignPlanLabel: 'Assign next plan',
    })
  })

  it('does not offer a second scheduled assignment — cancel the existing one first', () => {
    expect(
      primaryCompPlanRowActions({
        hasCurrent: true,
        hasScheduled: true,
        currentEffectiveTo: TODAY,
        today: TODAY,
      })
    ).toEqual({
      showEndPlan: false,
      showCancelScheduled: true,
      showAssignPlan: false,
      assignPlanLabel: 'Assign next plan',
    })
  })

  it('keeps End plan when a current assignment is still open-ended and a replacement is already scheduled', () => {
    expect(
      primaryCompPlanRowActions({
        hasCurrent: true,
        hasScheduled: true,
        currentEffectiveTo: null,
        today: TODAY,
      })
    ).toEqual({
      showEndPlan: true,
      showCancelScheduled: true,
      showAssignPlan: false,
      assignPlanLabel: 'Assign next plan',
    })
  })
})
