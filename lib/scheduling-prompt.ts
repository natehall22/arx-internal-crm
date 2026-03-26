/** Display/compare calendar dates in this zone (not UTC) for UI min= attributes and labels. */
export const FEEDBACK_PROMPT_DISPLAY_TIMEZONE = 'America/New_York'

/** Today as YYYY-MM-DD in `tz` (for &lt;input type="date" min&gt; so "today" matches local business day). */
export function calendarDateYmdInTimezone(tz: string, date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const d = parts.find((p) => p.type === 'day')?.value
  return `${y}-${m}-${d}`
}

/** Matches DB trigger: end of slot + row buffer + org feedback buffer (absolute instant, stored as ISO UTC). */
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

