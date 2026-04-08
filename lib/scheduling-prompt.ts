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

/**
 * When the closer feedback popup becomes due: **appointment start** (`scheduled_for`), as an absolute instant (ISO UTC).
 * Same wall-clock moment the slot was booked for in the calendar — compare with `new Date().toISOString()` on the server.
 *
 * Extra args are kept for call-site compatibility; they are **not** added to the prompt time anymore.
 */
export function computeInspectionFeedbackPromptAt(
  scheduledForIso: string,
  _durationMinutes?: number,
  _bufferAfterMinutes?: number,
  _orgFeedbackBufferMinutes?: number
): string {
  const t = new Date(scheduledForIso)
  if (Number.isNaN(t.getTime())) {
    return new Date().toISOString()
  }
  return t.toISOString()
}

