/** Matches DB trigger: end of slot + row buffer + org feedback buffer. */
export function computeInspectionFeedbackPromptAt(
  scheduledForIso: string,
  durationMinutes: number,
  bufferAfterMinutes: number,
  orgFeedbackBufferMinutes: number
): string {
  const total =
    (durationMinutes || 60) +
    (bufferAfterMinutes || 0) +
    (orgFeedbackBufferMinutes || 0)
  return new Date(new Date(scheduledForIso).getTime() + total * 60 * 1000).toISOString()
}

