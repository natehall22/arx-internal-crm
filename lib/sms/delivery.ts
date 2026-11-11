/**
 * What happened to a text a staff member sent from the thread (server only; the words are plain, for the screen). One
 * lookup for a page of messages: the send log row of each thread message (key `staff_reply:sms:<message id>`).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingTable } from '@/lib/supabase/errors'
import { orgDb } from '@/lib/supabase/org-db'

export type TextDelivery = { state: 'waiting' | 'sent' | 'delivered' | 'failed' | 'not_sent'; label: string; detail: string | null }

const REASONS: Record<string, string> = {
  no_consent: 'No OK to text on file',
  suppressed: 'This number stopped texts',
  customer_opted_out: 'Messages are off for this customer',
  no_address: 'No phone number',
  expired: 'Too late to send',
  bounced: 'That number can’t get texts',
  message_gone: 'The message was removed',
  daily_limit: 'Too many texts to this number today',
  turned_off: 'Texting was turned off',
  missing_company_name: 'Add your company name in Settings',
}

type Row = { message_key: string; status: string; delivery_status: string | null; skip_reason: string | null; provider_error: string | null; last_error: string | null; sent_at: string | null }

/** Pure: a send log row → what to show. */
export function deliveryOf(r: Row): TextDelivery {
  if (r.status === 'sent') {
    if (r.delivery_status === 'delivered') return { state: 'delivered', label: 'Texted · delivered', detail: null }
    if (r.delivery_status === 'failed') return { state: 'failed', label: 'Text not delivered', detail: r.provider_error ?? null }
    return { state: 'sent', label: 'Texted', detail: null }
  }
  if (r.status === 'queued' || r.status === 'sending') return { state: 'waiting', label: 'Text waiting to go out', detail: 'Texts only go out between your texting hours.' }
  if (r.status === 'failed') return { state: 'waiting', label: 'Text will be tried again', detail: r.last_error ?? null }
  return { state: 'not_sent', label: 'Text not sent', detail: (r.skip_reason && REASONS[r.skip_reason]) || r.skip_reason || null }
}

/** thread message id → its text delivery (messages that were not texted are absent). */
export async function loadTextDeliveries(admin: SupabaseClient, orgId: string, messageIds: string[]): Promise<Record<string, TextDelivery>> {
  const out: Record<string, TextDelivery> = {}
  for (let i = 0; i < messageIds.length; i += 50) {
    const keys = messageIds.slice(i, i + 50).map((id) => `staff_reply:sms:${id}`)
    const { data, error } = await orgDb(admin, orgId).from('customer_messages').select('message_key, status, delivery_status, skip_reason, provider_error, last_error, sent_at').in('message_key', keys)
    if (error) {
      if (isMissingTable(error)) return out
      throw new Error(`text deliveries: ${error.message}`)
    }
    for (const r of (data ?? []) as Row[]) out[r.message_key.slice('staff_reply:sms:'.length)] = deliveryOf(r)
  }
  return out
}
