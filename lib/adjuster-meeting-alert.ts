/**
 * Owner alert for a failed adjuster-meeting calendar push.
 *
 * A failed push means the meeting never reaches the attending rep's phone, and a
 * missed adjuster meeting delays the insurance claim. The DB column and the API
 * response field are both invisible to a human in time, so this email is the safety
 * net.
 *
 * NON-FATAL BY CONTRACT, same as the sync it reports on: the booking succeeding
 * matters more than the alert being delivered. Nothing in here may throw into the
 * scheduling path.
 */

import { getCrmEmailFrom, getMailTransport } from '@/lib/setter-email'
import { formatDateTimeInTimezone } from '@/lib/timezone'

/**
 * Where the alert goes. Env-overridable with a default, matching the existing
 * `stormAlertEmailTo()` pattern in lib/storm-opportunity-alerts.ts — one named
 * place to change the recipient instead of an address buried in the scheduling path.
 */
export function adjusterMeetingAlertEmailTo(): string {
  return (process.env.ADJUSTER_MEETING_ALERT_EMAIL_TO || 'nathan@arxroofing.com').trim()
}

/**
 * Anti-spam rule.
 *
 * Alert when the failure is NEWLY recorded (the row was previously clean), or on
 * every explicit retry — a retry is a human actively trying to fix this, and they
 * need to know it did not work.
 *
 * Suppressed when a failure was already recorded and this is not a retry, so an
 * already-known problem re-touched by some later read or write does not re-send.
 */
export function shouldSendAdjusterMeetingAlert(input: {
  alreadyFailing: boolean
  isRetry: boolean
}): boolean {
  if (input.isRetry) return true
  return !input.alreadyFailing
}

export type AdjusterMeetingAlertInput = {
  appointmentId: string
  customerName: string | null
  address: string | null
  /** UTC ISO from the database. Rendered to Eastern for the reader. */
  scheduledForIso: string
  attendeeName: string | null
  bookedByName: string | null
  error: string
  /** True when this came from an explicit retry rather than the original booking. */
  isRetry?: boolean
}

/**
 * Eastern, human-readable. NEVER the raw UTC ISO string.
 *
 * The live example is Saturday 8am ET stored as `2026-08-08 12:00:00+00`. An alert
 * that said "12:00" would send someone to the wrong time, so this goes through the
 * project's existing Eastern formatter.
 */
export function formatAlertMeetingTime(scheduledForIso: string): string {
  const parsed = new Date(scheduledForIso)
  if (!Number.isFinite(parsed.getTime())) return 'Unknown time'
  return `${formatDateTimeInTimezone(parsed, 'America/New_York')} ET`
}

export function buildAdjusterMeetingAlertSubject(input: AdjusterMeetingAlertInput): string {
  const who = input.customerName?.trim() || 'Customer'
  return `${input.isRetry ? 'STILL FAILING' : 'ACTION NEEDED'}: adjuster meeting not on the calendar — ${who}`
}

export function buildAdjusterMeetingAlertText(input: AdjusterMeetingAlertInput): string {
  return [
    input.isRetry
      ? 'A retry of the Google Calendar sync for this adjuster meeting FAILED AGAIN.'
      : 'An adjuster meeting was booked but could NOT be pushed to Google Calendar.',
    '',
    'The meeting IS booked in the CRM. It is only missing from the calendar, so the',
    'attending rep will not get a reminder on their phone unless this is fixed.',
    '',
    `Customer:      ${input.customerName?.trim() || 'Unknown'}`,
    `Address:       ${input.address?.trim() || 'Not recorded'}`,
    `When:          ${formatAlertMeetingTime(input.scheduledForIso)}`,
    `Attending rep: ${input.attendeeName?.trim() || 'Not assigned'}`,
    `Booked by:     ${input.bookedByName?.trim() || 'Unknown'}`,
    '',
    `Error:         ${input.error}`,
    `Appointment:   ${input.appointmentId}`,
    '',
    'How to fix it:',
    '  1. Open the opportunity in the inside-sales queue.',
    '  2. Press "Retry calendar sync" on the adjuster meeting.',
    '  3. If it fails again, the attending rep most likely has not connected Google',
    '     Calendar — have them connect it, then retry.',
  ].join('\n')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildAdjusterMeetingAlertHtml(input: AdjusterMeetingAlertInput): string {
  const row = (label: string, value: string) =>
    `<tr>
      <td style="padding:6px 12px 6px 0;color:#2c2c2a;font-weight:600;white-space:nowrap;">${escapeHtml(label)}</td>
      <td style="padding:6px 0;color:#2c2c2a;">${escapeHtml(value)}</td>
    </tr>`

  return `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#2c2c2a;">
  <h2 style="color:#2c2c2a;margin:0 0 12px;">${
    input.isRetry
      ? 'Adjuster meeting sync retry failed again'
      : 'Adjuster meeting is not on the calendar'
  }</h2>
  <p style="color:#2c2c2a;margin:0 0 16px;">
    The meeting <strong>is booked in the CRM</strong>. It is only missing from Google
    Calendar, so the attending rep will not get a phone reminder until this is fixed.
  </p>
  <table style="border-collapse:collapse;margin:0 0 16px;">
    ${row('Customer', input.customerName?.trim() || 'Unknown')}
    ${row('Address', input.address?.trim() || 'Not recorded')}
    ${row('When', formatAlertMeetingTime(input.scheduledForIso))}
    ${row('Attending rep', input.attendeeName?.trim() || 'Not assigned')}
    ${row('Booked by', input.bookedByName?.trim() || 'Unknown')}
    ${row('Appointment id', input.appointmentId)}
  </table>
  <p style="color:#2c2c2a;margin:0 0 16px;padding:12px;background:#fdf3f2;border-left:4px solid #b42318;">
    <strong>Error:</strong> ${escapeHtml(input.error)}
  </p>
  <p style="color:#2c2c2a;margin:0;">
    <strong>How to fix it:</strong><br>
    1. Open the opportunity in the inside-sales queue.<br>
    2. Press &ldquo;Retry calendar sync&rdquo; on the adjuster meeting.<br>
    3. If it fails again, the attending rep most likely has not connected Google
    Calendar &mdash; have them connect it, then retry.
  </p>
</div>`
}

/**
 * Fire the alert. Never throws.
 *
 * Returns whether mail was actually handed to the transport, which is what the
 * tests assert on — callers must not branch on it for anything that affects the
 * booking.
 */
export async function sendAdjusterMeetingSyncAlert(
  input: AdjusterMeetingAlertInput
): Promise<{ sent: boolean; skippedReason?: string }> {
  try {
    if (!process.env.SMTP_HOST) {
      return { sent: false, skippedReason: 'smtp_not_configured' }
    }

    const transporter = getMailTransport()
    await transporter.sendMail({
      from: getCrmEmailFrom(),
      to: adjusterMeetingAlertEmailTo(),
      subject: buildAdjusterMeetingAlertSubject(input),
      text: buildAdjusterMeetingAlertText(input),
      html: buildAdjusterMeetingAlertHtml(input),
    })

    return { sent: true }
  } catch (err) {
    // A booking must never fail because an alert could not be delivered.
    console.error('sendAdjusterMeetingSyncAlert: could not send calendar-failure alert', err)
    return { sent: false, skippedReason: 'send_failed' }
  }
}
