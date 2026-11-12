/**
 * Where an automatic customer message goes out (server only). ONE interface per channel; the sender
 * (lib/customer-messages-db.ts) never talks to SMTP (or, later, an SMS provider) directly.
 *
 * - email: the copy's SMTP (`getMailTransport`); From = the COMPANY's name + email (orgs row; a company missing either is
 *   blocked, never sent under another identity — the SMTP account must be allowed to send as that address: Workspace
 *   "Send mail as" / a verified domain at the provider), Reply-To = the company's email, a stable Message-ID per message,
 *   List-Unsubscribe + one-click List-Unsubscribe-Post (RFC 8058) pointing at the message's own link.
 * - sms: the company's own local number through ONE carrier adapter (lib/sms/provider.ts). `available()` = a carrier is
 *   configured (env SMS_PROVIDER + its keys); `addressFor` = the customer's number as US E.164; `send` sends `m.sms` from
 *   `opts.smsFrom` (the company's number). Consent, opt-out, quiet hours, the daily cap and the per-company limit are the
 *   sender's rules (lib/customer-messages-db.ts `deliver` + lib/sms/gate.ts), the same path as email — there is no second sender.
 *
 * Bounces / complaints: plain SMTP only tells us about a recipient the server refuses while we send (a 5xx on that
 * address) — that is reported as `permanent`, and the sender suppresses the address. Bounces that come back later as
 * mail (Gmail / Workspace) and spam complaints are NOT visible over SMTP; a provider with webhooks (SES, Postmark…)
 * would call `suppressAddress` (lib/customer-messages-db.ts) from its webhook — the one writer.
 */
import { getMailTransport } from '@/lib/setter-email'
import { isUsableCustomerEmail } from '@/lib/invoice-document'
import type { MessageChannel, RenderedMessage } from '@/lib/customer-messages'
import { normalizeUsPhone } from '@/lib/sms/phone'
import { getSmsProvider } from '@/lib/sms/provider'
import { countSegments } from '@/lib/sms/segments'

export type SendOutcome =
  | { ok: true; providerId: string | null; /** Texts: billable segments and the carrier's cost estimate. */ segments?: number; costMicros?: number | null }
  /**
   * permanent = this address will never work (suppress it). unknown = the server may have taken it before the line went
   * quiet (a timeout / dropped connection after we started): retried only after a long delay, with the SAME Message-ID so
   * mail systems can recognize a copy. Otherwise a definite "not sent" that a later attempt may fix.
   */
  | { ok: false; permanent: boolean; unknown?: boolean; /** Texts: the carrier says the person already opted out there. */ optedOut?: boolean; error: string }

export type SendOptions = {
  /** The sending company (required: a demo company's mail is logged, never sent — lib/demo-org-mail.ts). */
  orgId: string
  /** The company's own sender: its name and email (never a product / other company's fallback). */
  from: { name: string; address: string }
  replyTo: string | null
  /** Stable per message (the same on every retry). */
  messageId: string
  unsubscribeUrl: string | null
  unsubscribePostUrl: string | null
  /** Texts: the company's own number (E.164) the message goes out from. */
  smsFrom?: string | null
}

export type ChannelRecipient = { email: string | null; phone: string | null }

export interface MessageChannelSender {
  channel: MessageChannel
  /** Configured for this deployment? (No SMTP = nothing is sent and nothing is claimed.) */
  available(): boolean
  /** The address this channel would use for a recipient (normalized), or null when there is none usable. */
  addressFor(r: ChannelRecipient): string | null
  send(to: string, m: RenderedMessage, opts: SendOptions): Promise<SendOutcome>
}

/** Lower-cased, trimmed — the one spelling of an address in the send log and the suppression list. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase()
  return isUsableCustomerEmail(v) && /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(v) ? v : null
}

/**
 * Pure: did the send end without a definite answer? A timeout or a dropped socket once talking to the server may mean
 * the message was accepted. A failure to connect at all (ECONNECTION / ECONNREFUSED / DNS) or an SMTP reply is definite.
 */
export function isUnknownSmtpOutcome(e: unknown): boolean {
  const err = e as { code?: string; responseCode?: number } | null
  if (!err || typeof err.responseCode === 'number') return false
  return err.code === 'ETIMEDOUT' || err.code === 'ESOCKET' || err.code === 'ECONNRESET' || err.code === 'EPIPE'
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
  /** An outgoing mail server for this copy. The From is the company's own (SendOptions.from), not the copy's. */
  available() {
    return !!process.env.SMTP_HOST
  },
  addressFor(r) {
    return normalizeEmail(r.email)
  },
  async send(to, m, opts) {
    try {
      const info = await getMailTransport(opts.orgId).sendMail({
        from: opts.from,
        messageId: opts.messageId,
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
      return { ok: false, permanent: isPermanentSmtpFailure(e), unknown: isUnknownSmtpOutcome(e), error: e instanceof Error ? e.message.slice(0, 300) : 'Send failed' }
    }
  },
}

export const smsChannel: MessageChannelSender = {
  channel: 'sms',
  available() {
    return !!getSmsProvider()?.canSend()
  },
  addressFor(r) {
    return normalizeUsPhone(r.phone)
  },
  async send(to, m, opts) {
    const provider = getSmsProvider()
    if (!provider?.canSend()) return { ok: false, permanent: false, error: 'Text messages are not set up yet' }
    if (!opts.smsFrom) return { ok: false, permanent: false, error: 'This company has no texting number yet' }
    const out = await provider.send({ from: opts.smsFrom, to, text: m.sms, idempotencyKey: opts.messageId })
    if (out.ok) return { ok: true, providerId: out.providerMessageId, segments: out.segments ?? countSegments(m.sms).segments, costMicros: out.costMicros }
    return { ok: false, permanent: out.permanent, unknown: out.unknown, optedOut: out.optedOut, error: out.error }
  },
}

const CHANNELS: Record<MessageChannel, MessageChannelSender> = { email: emailChannel, sms: smsChannel }

/**
 * A DEMO company's channel (lib/demo-org.ts): the same pipeline (claim, caps, quiet hours, the send log) runs, but the
 * message is only LOGGED — nothing is mailed or texted, so the log screens fill in like a real company's. Always
 * "available" (a demo copy needs no mail server or carrier).
 */
export function demoSuppressedChannel(base: MessageChannelSender): MessageChannelSender {
  return {
    channel: base.channel,
    available: () => true,
    addressFor: (r) => base.addressFor(r),
    async send(to, m, opts) {
      console.info('[demo] suppressed outbound message', { channel: base.channel, to, subject: m.subject, messageId: opts.messageId })
      return { ok: true, providerId: `demo-suppressed:${opts.messageId}`, ...(base.channel === 'sms' ? { segments: countSegments(m.sms).segments, costMicros: 0 } : {}) }
    },
  }
}

export function channelSender(c: MessageChannel): MessageChannelSender {
  return CHANNELS[c]
}
