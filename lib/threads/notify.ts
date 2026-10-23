import nodemailer from 'nodemailer'
import type { SupabaseClient } from '@supabase/supabase-js'

import { getCrmEmailFrom } from '@/lib/crm-email-from'
import { resolveAppUrl } from '@/lib/job-trades'
import { sendPushToUserBackground } from '@/lib/push-apns'
import type { ThreadMessage } from '@/lib/threads/get-thread'
import type { Priority } from '@/lib/threads/visibility'

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Deep link to one message: IDs in the path so login keeps them (middleware keeps pathname only). */
export function messageLink(appUrl: string, d: { customerId: string | null; dealId: string; leadId?: string | null }, messageId: string): string {
  const base = appUrl.replace(/\/+$/, '')
  if (d.customerId) return `${base}/c/${d.customerId}/d/${d.dealId}/overview/n/${messageId}`
  return `${base}/c/lead/${d.leadId ?? d.dealId}`
}

export type NotifyInput = {
  orgId: string
  senderId: string
  senderName: string
  message: ThreadMessage
  deal: { id: string; customerId: string | null; leadId: string | null; label: string }
  recipients: { userId: string; priority: Priority; reason: string }[]
  blindMentions: string[]
}

/**
 * Notification rows are the "Waiting on you" inbox: needs_reply and urgent stay open until
 * the person replies, taps Done, or turns it into a task. FYI mentions are one-way.
 * Push/email never carry more than the recipient may read.
 */
export async function notifyMessage(admin: SupabaseClient, input: NotifyInput): Promise<void> {
  const appUrl = resolveAppUrl()
  const link = messageLink(appUrl, { customerId: input.deal.customerId, dealId: input.deal.id, leadId: input.deal.leadId }, input.message.id)
  const path = link.replace(appUrl.replace(/\/+$/, ''), '')
  const rows = [
    ...input.recipients.map((r) => ({ ...r, blind: false })),
    ...input.blindMentions.map((userId) => ({ userId, priority: 'fyi' as Priority, reason: 'mention', blind: true })),
  ]
  if (rows.length === 0) return

  await admin.from('notifications').insert(
    rows.map((r) => ({
      org_id: input.orgId,
      recipient_user_id: r.userId,
      actor_user_id: input.senderId,
      type: r.blind ? 'thread_mention_blind' : `thread_${r.priority}`,
      title: r.blind ? `${input.senderName} mentioned you` : `${input.senderName} · ${input.deal.label}`,
      body: r.blind ? 'Mentioned you in a message you do not have access to' : input.message.body.slice(0, 200),
      link_url: path,
      activity_id: input.message.id,
      priority: r.priority,
      data: { reason: r.reason },
    }))
  )

  for (const r of rows) {
    if (r.priority === 'fyi' && r.reason === 'reply') continue
    sendPushToUserBackground(
      r.userId,
      r.blind ? 'ARX CRM' : r.priority === 'urgent' ? `URGENT · ${input.deal.label}` : input.deal.label,
      r.blind ? `${input.senderName} mentioned you` : `${input.senderName}: ${input.message.body.slice(0, 140)}`,
      { type: 'thread_message', url: path, activity_id: input.message.id }
    )
  }

  // Email: mentions and needs-reply/urgent only. Blind mentions carry no text.
  try {
    if (!process.env.SMTP_HOST) return
    const { data: users } = await admin.from('users').select('id, email, full_name').in('id', rows.map((r) => r.userId))
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
    await Promise.allSettled(
      rows.map((r) => {
        const u = (users ?? []).find((x) => x.id === r.userId)
        if (!u?.email) return Promise.resolve()
        const text = r.blind
          ? `${input.senderName} mentioned you in a job conversation.`
          : `${input.senderName} on ${input.deal.label}:\n\n${input.message.body}`
        const subject = r.blind
          ? `${input.senderName} mentioned you`
          : r.priority === 'urgent'
            ? `URGENT from ${input.senderName} · ${input.deal.label}`
            : r.priority === 'needs_reply'
              ? `${input.senderName} needs a reply · ${input.deal.label}`
              : `${input.senderName} mentioned you · ${input.deal.label}`
        return transporter.sendMail({
          from: getCrmEmailFrom(),
          to: u.email,
          subject,
          text: `${text}\n\nOpen: ${link}`,
          html: `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p><p><a href="${escapeHtml(link)}">Open in thread</a></p>`,
        })
      })
    )
  } catch (e) {
    console.error('thread email failed', e)
  }
}

/**
 * Notifications copy the first 200 chars at send time. When the message is removed, narrowed or newly price-flagged, that
 * copy must not outlive it. System-side (service role) across all recipients of ONE activity — not a read, so it is the
 * one place besides the recipient-scoped routes that touches `notifications` by activity_id (allow-listed in
 * lib/__tests__/notifications-recipient-only.test.ts).
 */
export async function scrubNotificationsForActivity(admin: SupabaseClient, activityId: string, resolve = false): Promise<void> {
  await admin
    .from('notifications')
    .update({ body: 'This message was changed. Open the job to read it.', ...(resolve ? { resolved_at: new Date().toISOString(), resolution: 'removed' } : {}) })
    .eq('activity_id', activityId)
}
