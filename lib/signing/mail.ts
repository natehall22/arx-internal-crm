/**
 * The ONE way a signing email is sent (server only) — replaces the four hand-built nodemailer blocks (contract create, contract
 * signed, change-order create, change-order signed). Same SMTP settings and the same From as those blocks had
 * (`getCrmEmailFrom`), so what a customer receives is unchanged. Returns false on failure; the caller decides if that matters.
 */
import nodemailer from 'nodemailer'

import { getCrmEmailFrom } from '@/lib/crm-email-from'

export type SigningMail = {
  to: string | string[]
  subject: string
  text: string
  html: string
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>
  replyTo?: string | null
}

export async function sendSigningEmail(mail: SigningMail): Promise<boolean> {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
    await transporter.sendMail({
      from: getCrmEmailFrom(),
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
