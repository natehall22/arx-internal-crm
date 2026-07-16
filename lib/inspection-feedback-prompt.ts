/** Snoozing ("Later") this many times makes a prompt non-dismissible — blocking modal until resolved. */
export const FEEDBACK_PROMPT_ESCALATION_THRESHOLD = 2

/** How long a non-escalating "Later" snooze hides a prompt before it resurfaces on its own. */
export const FEEDBACK_PROMPT_SNOOZE_DURATION_MS = 4 * 60 * 60 * 1000

export function isPromptEscalated(snoozeCount: number): boolean {
  return snoozeCount >= FEEDBACK_PROMPT_ESCALATION_THRESHOLD
}

/** Minimal shape for `pending_status_prompts` rows with joined `appointment` for due-date logic */
export type InspectionFeedbackPromptRow = {
  prompt_at?: string | null
  appointment?: { scheduled_for?: string | null } | null
}

export function isPromptDue(prompt: InspectionFeedbackPromptRow, nowMs: number): boolean {
  const scheduledFor = prompt.appointment?.scheduled_for
    ? Date.parse(prompt.appointment.scheduled_for)
    : NaN
  const promptAt = prompt.prompt_at ? Date.parse(prompt.prompt_at) : NaN

  const appointmentIsDue = Number.isNaN(scheduledFor) || scheduledFor <= nowMs
  const promptIsDue = Number.isNaN(promptAt) || promptAt <= nowMs

  return appointmentIsDue && promptIsDue
}
