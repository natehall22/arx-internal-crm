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
