/**
 * THE opt-out list (server only): addresses — an email, or a phone in E.164 — that get no automatic message from a company
 * again, per channel. `customer_message_suppressions` (migration 202611120050). The first reason is kept. Written by an
 * email unsubscribe, a bounce, and — for texts — STOP and a carrier "invalid number"; read by the sender before every send.
 * (Split out of customer-messages-db.ts so the texting rules can read it without importing the sender.)
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { normalizeEmail } from '@/lib/customer-message-channels'
import type { MessageChannel } from '@/lib/customer-messages'
import { orgDb } from '@/lib/supabase/org-db'

export type SuppressionReason = 'unsubscribed' | 'bounced' | 'complained'

/** The spelling stored: an email normalized, a phone as given (E.164, lower-cased/trimmed like the table's check). */
function addressKey(channel: MessageChannel, raw: string): string | null {
  return channel === 'email' ? normalizeEmail(raw) : raw.trim().toLowerCase() || null
}

export async function suppressAddress(
  admin: SupabaseClient,
  orgId: string,
  channel: MessageChannel,
  rawAddress: string,
  reason: SuppressionReason,
  opts: { messageId?: string | null; detail?: string | null } = {}
): Promise<void> {
  const address = addressKey(channel, rawAddress)
  if (!address) return
  const { error } = await orgDb(admin, orgId)
    .from('customer_message_suppressions')
    .upsert({ channel, address, reason, message_id: opts.messageId ?? null, detail: opts.detail?.slice(0, 300) ?? null }, { onConflict: 'org_id,channel,address', ignoreDuplicates: true })
  if (error) throw new Error(`suppress address: ${error.message}`)
}

export async function suppressionOf(admin: SupabaseClient, orgId: string, channel: MessageChannel, address: string): Promise<{ reason: SuppressionReason; created_at: string; detail?: string | null } | null> {
  const { data } = await orgDb(admin, orgId).from('customer_message_suppressions').select('reason, created_at, detail').eq('channel', channel).eq('address', address).maybeSingle()
  return (data as { reason: SuppressionReason; created_at: string; detail: string | null } | null) ?? null
}

/** Take an address off the list (the person asked to hear from us again: texted START). */
export async function unsuppressAddress(admin: SupabaseClient, orgId: string, channel: MessageChannel, rawAddress: string): Promise<void> {
  const address = addressKey(channel, rawAddress)
  if (!address) return
  const { error } = await orgDb(admin, orgId).from('customer_message_suppressions').delete().eq('channel', channel).eq('address', address)
  if (error) throw new Error(`unsuppress address: ${error.message}`)
}
