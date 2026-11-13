import { createGuardedTransport } from '@/lib/demo-org-mail'
import { getCrmEmailFrom } from '@/lib/crm-email-from'
import { createServiceClient } from '@/lib/supabase/service'
import { isUserActiveForTransactionalEmail } from '@/lib/user-email-eligibility'
export { pickValidEmail } from '@/lib/email-address'
export { getCrmEmailFrom }

/**
 * THE one way to open an SMTP connection. `sendingOrgId` = the company the mail is sent for (required: a demo company's mail is
 * logged, never sent); null only for the two public marketing forms that belong to no company. `extra` overrides SMTP options
 * (daily logs / selections pin `secure: false`; employee agreements add timeouts) — the same values they had before.
 */
export function getMailTransport(sendingOrgId: string | null, extra: { secure?: boolean; connectionTimeout?: number; greetingTimeout?: number; socketTimeout?: number } = {}) {
  return createGuardedTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    ...extra,
  }, sendingOrgId)
}

type SetterEmailRow = { label: string; value: string }

/**
 * Sends HTML email to setter (non-fatal if SMTP not configured).
 */
export async function sendSetterEmail(params: {
  to: string
  /** When set, email is skipped if this CRM user is disabled. */
  recipientUserId?: string | null
  /** The sending company (a demo company's mail is logged, never sent). */
  orgId: string | null
  setterName?: string | null
  subject: string
  introHtml: string
  rows: SetterEmailRow[]
}): Promise<void> {
  if (!process.env.SMTP_HOST || !params.to?.includes('@')) {
    return
  }
  if (params.recipientUserId) {
    const admin = createServiceClient()
    if (!(await isUserActiveForTransactionalEmail(admin, params.recipientUserId))) {
      console.warn('sendSetterEmail: skipped inactive recipient', params.recipientUserId)
      return
    }
  }
  const transporter = getMailTransport(params.orgId)
  const name = params.setterName || 'Setter'
  const rowsHtml = params.rows
    .map(
      (r) =>
        `<tr><td style="padding: 8px 0; color: #6B7280; width: 180px;">${escapeHtml(r.label)}</td><td style="padding: 8px 0; color: #111827;">${escapeHtml(r.value)}</td></tr>`
    )
    .join('')

  await transporter.sendMail({
    from: await getCrmEmailFrom(params.orgId),
    to: params.to,
    subject: params.subject,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #111827; margin-bottom: 16px;">${escapeHtml(params.subject)}</h2>
        <p style="color: #374151;">Hi ${escapeHtml(name)},</p>
        ${params.introHtml}
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          ${rowsHtml}
        </table>
        <p style="color: #6B7280; font-size: 12px; margin-top: 16px;">This is an automated update from ARX CRM.</p>
      </div>
    `,
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
