/**
 * The email sent to someone @mentioned in a job note.
 *
 * Owner rule (2026-10-21): anyone active can be mentioned (jobs get reassigned and
 * people may need to look at something), but the EMAIL only carries what that
 * recipient may see. Someone who can read job notes (canReadJobNotes) gets the note
 * text; anyone else gets "{Sender} mentioned you on Job {#} – {address}" and the
 * link, with no note text — the job page enforces access itself.
 *
 * All links are built from the configured app URL, never from request headers or
 * client input. Every interpolated value in the HTML is escaped.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export type MentionEmailInput = {
  appUrl: string
  jobId: string
  jobNumber: string | null
  jobAddress: string | null
  customerId: string | null
  customerName: string | null
  senderName: string
  recipientName: string | null
  note: string
  /** canReadJobNotes for the RECIPIENT. */
  recipientCanReadNote: boolean
}

export type MentionEmail = { subject: string; html: string; text: string }

export function buildMentionEmail(input: MentionEmailInput): MentionEmail {
  const appUrl = input.appUrl.replace(/\/+$/, '')
  const jobLink = `${appUrl}/ops/jobs/${encodeURIComponent(input.jobId)}`
  const jobLabel = input.jobNumber?.trim() ? `Job ${input.jobNumber.trim()}` : 'a job'
  const address = input.jobAddress?.trim() || ''
  const sender = input.senderName.trim() || 'ARX Team'
  const hi = input.recipientName?.trim() || 'there'
  const e = escapeHtml

  if (!input.recipientCanReadNote) {
    const line = `${sender} mentioned you on ${jobLabel}${address ? ` – ${address}` : ''}`
    return {
      subject: line,
      html: `
                <p>Hi ${e(hi)},</p>
                <p>${e(line)}.</p>
                <p><a href="${e(jobLink)}">Open in CRM</a></p>
              `,
      text: `Hi ${hi},\n\n${line}.\n\nOpen in CRM: ${jobLink}`,
    }
  }

  const customerLink = input.customerId ? `${appUrl}/customers/${encodeURIComponent(input.customerId)}` : null
  const customerLabel = input.customerName?.trim() || 'Customer'
  const subject = `${customerLabel} • ${input.jobNumber?.trim() || jobLabel} • New tagged note`
  return {
    subject,
    html: `
                <p>Hi ${e(hi)},</p>
                <p><strong>${e(sender)}</strong> mentioned you in an internal note.</p>
                <p><strong>Comment:</strong><br/>${e(input.note).replace(/\n/g, '<br/>')}</p>
                <p><a href="${e(jobLink)}">Open Job in CRM</a></p>
                ${customerLink ? `<p><a href="${e(customerLink)}">Open Customer in CRM</a></p>` : ''}
              `,
    text: `Hi ${hi},\n\n${sender} mentioned you in an internal note.\n\nComment:\n${input.note}\n\nOpen Job in CRM: ${jobLink}${customerLink ? `\nOpen Customer in CRM: ${customerLink}` : ''}`,
  }
}
