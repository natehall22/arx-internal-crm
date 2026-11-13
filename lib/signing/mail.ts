/**
 * The ONE way a signing email is sent (server only) — replaces the four hand-built nodemailer blocks (contract create, contract
 * signed, change-order create, change-order signed). Same SMTP settings and the same From as those blocks had
 * (`getCrmEmailFrom`), so what a customer receives is unchanged. Returns false on failure; the caller decides if that matters.
 */
import { getCrmEmailFrom } from '@/lib/crm-email-from'
import { getMailTransport } from '@/lib/setter-email'

export type SigningMail = {
  to: string | string[]
  subject: string
  text: string
  html: string
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>
  replyTo?: string | null
}

/**
 * `orgId` = the company the document belongs to (required, so no caller can forget it): a demo company's signing mail is
 * logged and never sent (the guard lives in getMailTransport → lib/demo-org-mail.ts).
 */
export async function sendSigningEmail(mail: SigningMail, orgId: string | null): Promise<boolean> {
  try {
    const transporter = getMailTransport(orgId)
    await transporter.sendMail({
      from: await getCrmEmailFrom(orgId),
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      ...(mail.attachments?.length ? { attachments: mail.attachments } : {}),
      ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
    })
    return true
  } catch (error) {
    console.error('[signing] email error:', error)
    return false
  }
}
