/** Stored in close_appointments.outcome */
export type CloseFeedbackOutcome =
  | 'sold'
  | 'needs_another_visit'
  | 'waiting_on_insurance'
  | 'insurance_follow_up'
  | 'said_no'
  | 'not_home'
  | 'rescheduled'

export const CLOSE_FEEDBACK_OUTCOME_LABELS: Record<
  CloseFeedbackOutcome,
  { label: string; description: string; icon: string }
> = {
  sold: {
    label: 'Sold',
    description: 'Customer signed the contract',
    icon: '✅',
  },
  needs_another_visit: {
    label: 'Needs Another Visit',
    description: 'Requires a follow-up close appointment',
    icon: '🔄',
  },
  waiting_on_insurance: {
    label: 'Waiting on Insurance',
    description: 'Pending insurance approval (no follow-up time yet)',
    icon: '📋',
  },
  insurance_follow_up: {
    label: 'Insurance Follow Up',
    description: 'Schedule when to return (same as inspection feedback)',
    icon: '📅',
  },
  said_no: {
    label: 'Said No',
    description: 'Customer declined',
    icon: '❌',
  },
  not_home: {
    label: 'Not Home',
    description: "Customer wasn't there",
    icon: '❓',
  },
  rescheduled: {
    label: 'Rescheduled',
    description: 'Moved to a new date',
    icon: '🔃',
  },
}

export function labelForCloseOutcome(outcome: string | null | undefined): string {
  if (!outcome) return 'Recorded'
  const known = CLOSE_FEEDBACK_OUTCOME_LABELS[outcome as CloseFeedbackOutcome]
  if (known) return known.label
  return outcome.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
