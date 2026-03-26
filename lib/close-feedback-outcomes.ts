import { resolveCloseOutcomeLabel } from '@/lib/close-outcomes'

/** Stored in close_appointments.outcome — any string id from org close outcomes settings. */
export type CloseFeedbackOutcome = string

/** @deprecated Use org-configured outcomes; kept for typing only. */
export const CLOSE_FEEDBACK_OUTCOME_LABELS: Record<
  string,
  { label: string; description: string; icon: string }
> = {}

export function labelForCloseOutcome(outcome: string | null | undefined): string {
  return resolveCloseOutcomeLabel(outcome, null)
}
