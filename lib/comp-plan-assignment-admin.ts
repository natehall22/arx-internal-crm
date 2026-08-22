/**
 * Primary-plan row actions on /admin/comp-plans.
 *
 * Replacing a plan is done by assigning the next one (RPC starts it after today and
 * closes the current assignment the day before). Ending is only for leaving a gap.
 * The row used to hide Assign whenever a current OR historical assignment existed,
 * so End plan could never unlock a new assignment.
 */

export type PrimaryCompPlanAssignLabel = 'Assign plan' | 'Assign next plan'

export type PrimaryCompPlanRowActions = {
  showEndPlan: boolean
  showCancelScheduled: boolean
  showAssignPlan: boolean
  assignPlanLabel: PrimaryCompPlanAssignLabel
}

export function primaryCompPlanRowActions(input: {
  hasCurrent: boolean
  hasScheduled: boolean
  currentEffectiveTo: string | null | undefined
  today: string
}): PrimaryCompPlanRowActions {
  const alreadyEndingToday = input.hasCurrent && input.currentEffectiveTo === input.today
  return {
    showEndPlan: input.hasCurrent && !alreadyEndingToday,
    showCancelScheduled: input.hasScheduled,
    // One future primary assignment per user — cancel the scheduled one before replacing it.
    showAssignPlan: !input.hasScheduled,
    assignPlanLabel: input.hasCurrent ? 'Assign next plan' : 'Assign plan',
  }
}
