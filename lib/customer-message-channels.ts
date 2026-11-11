/**
 * Where an automatic customer message goes out (server only). ONE interface per channel; the sender
 * (lib/customer-messages-db.ts) never talks to SMTP (or, later, an SMS provider) directly.
 *
 * - email: the company copy's SMTP (`getMailTransport`, From = `getCrmEmailFrom`), Reply-To = the company's own email,
 *   List-Unsubscribe + one-click List-Unsubscribe-Post (RFC 8058) pointing at the message's own link.
 * - sms: reserved. `available()` is false until a provider is wired in; nothing writes an sms row today. To add it:
 *   implement `send` with the provider, make `addressFor` return the customer's mobile number, and turn `available` on.
 *
 * Bounces / complaints: plain SMTP only tells us about a recipient the server refuses while we send (a 5xx on that
 * address) — that is reported as `permanent`, and the sender suppresses the address. Bounces that come back later as
 * mail (Gmail / Workspace) and spam complaints are NOT visible over SMTP; a provider with webhooks (SES, Postmark…)
 * would call `suppressAddress` (lib/customer-messages-db.ts) from its webhook — the one writer.
 */
import { getCrmEmailFrom, getMailTransport } from '@/lib/setter-email'
import { isUsableCustomerEmail } from '@/lib/invoice-document'
import type { MessageChannel, RenderedMessage } from '@/lib/customer-messages'

export type SendOutcome =
  | { ok: true; providerId: string | null }
  /** permanent = this address will never work (suppress it); otherwise a later attempt may. */
  | { ok: false; permanent: boolean; error: string }

export type ChannelRecipient = { email: string | null; phone: string | null }

export interface MessageChannelSender {
  channel: MessageChannel
  /** Configured for this deployment? (No SMTP = nothing is sent and nothing is claimed.) */
  available(): boolean
  /** The address this channel would use for a recipient (normalized), or null when there is none usable. */
  addressFor(r: ChannelRecipient): string | null
  send(to: string, m: RenderedMessage, opts: { replyTo: string | null; unsubscribeUrl: string | null; unsubscribePostUrl: string | null }): Promise<SendOutcome>
}

/** Lower-cased, trimmed — the one spelling of an address in the send log and the suppression list. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase()
  return isUsableCustomerEmail(v) && /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(v) ? v : null
}

/** Pure: does an SMTP error mean this address is bad for good? (5xx on the recipient; a 4xx / network error may pass later.) */
export function isPermanentSmtpFailure(e: unknown): boolean {
  const err = e as { responseCode?: number; code?: string; rejected?: unknown[] } | null
  if (!err) return false
  const code = typeof err.responseCode === 'number' ? err.responseCode : null
  // EENVELOPE = the server refused the recipient; 550 / 551 / 553 = no such mailbox / not allowed.
  if (err.code === 'EENVELOPE' && code != null && code >= 500) return true
  return code === 550 || code === 551 || code === 553
}

export const emailChannel: MessageChannelSender = {
  channel: 'email',
  available() {
    return !!process.env.SMTP_HOST && !!getCrmEmailFrom()
  },
  addressFor(r) {
    return normalizeEmail(r.email)
  },
  async send(to, m, opts) {
    try {
      const info = await getMailTransport().sendMail({
        from: getCrmEmailFrom(),
        to,
        ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
        subject: m.subject,
        html: m.html,
        text: m.text,
        ...(opts.unsubscribeUrl
          ? {
              headers: {
                'List-Unsubscribe': `<${opts.unsubscribePostUrl ?? opts.unsubscribeUrl}>`,
                ...(opts.unsubscribePostUrl ? { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {}),
              },
            }
          : {}),
      })
      const rejected = Array.isArray((info as { rejected?: unknown[] }).rejected) ? (info as { rejected: unknown[] }).rejected : []
      if (rejected.length > 0) return { ok: false, permanent: true, error: 'The mail server refused this address' }
      return { ok: true, providerId: typeof (info as { messageId?: unknown }).messageId === 'string' ? (info as { messageId: string }).messageId : null }
    } catch (e) {
      return { ok: false, permanent: isPermanentSmtpFailure(e), error: e instanceof Error ? e.message.slice(0, 300) : 'Send failed' }
    }
  },
}

export const smsChannel: MessageChannelSender = {
  channel: 'sms',
  available: () => false,
  addressFor: () => null,
  async send() {
    return { ok: false, permanent: false, error: 'Text messages are not set up yet' }
  },
}

const CHANNELS: Record<MessageChannel, MessageChannelSender> = { email: emailChannel, sms: smsChannel }

export function channelSender(c: MessageChannel): MessageChannelSender {
  return CHANNELS[c]
}
