import { resolveCloseOutcomeLabel } from '@/lib/close-outcomes'

/** Stored in close_appointments.outcome — any string id from org close outcomes settings. */
export type CloseFeedbackOutcome = string

export function labelForCloseOutcome(outcome: string | null | undefined): string {
  return resolveCloseOutcomeLabel(outcome, null)
}
