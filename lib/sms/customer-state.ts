/**
 * The Customer File's "Texting" card (server only): may this customer be texted, the proof of their OK (who, how, when,
 * which wording), and the last texts both ways. Read-only: recording an OK happens where staff are about to text
 * (the thread composer / the Text button), through /api/threads/[dealId]/texting.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { CONSENT_SOURCE_TEXT, type ConsentSource } from '@/lib/sms/consent'
import { deliveryOf } from '@/lib/sms/delivery'
import { textStatus, type TextStatus } from '@/lib/sms/gate'
import { isMissingTable } from '@/lib/supabase/errors'
import { orgDb } from '@/lib/supabase/org-db'

export type CustomerTextingState = {
  status: TextStatus
  consent: Array<{ id: string; at: string; granted: boolean; how: string; by: string | null; wording: string | null }>
  recent: Array<{ id: string; at: string; direction: 'out' | 'in'; label: string; detail: string | null }>
}

export async function loadCustomerTextingState(admin: SupabaseClient, orgId: string, customerId: string): Promise<CustomerTextingState | null> {
  const status = await textStatus(admin, orgId, customerId)
  if (status.state === 'blocked' && status.code === 'texting_off') return null
  const db = orgDb(admin, orgId)
  const consentQ = db.from('customer_sms_consent').select('id, status, source, wording_version, created_by, created_at')
  const { data: crows, error } = await (status.phone ? consentQ.eq('phone_e164', status.phone) : consentQ.eq('customer_id', customerId)).order('created_at', { ascending: false }).limit(6)
  if (error && !isMissingTable(error)) throw new Error(`texting card: ${error.message}`)
  const rows = (crows ?? []) as Array<{ id: string; status: 'granted' | 'revoked'; source: ConsentSource; wording_version: string | null; created_by: string | null; created_at: string }>
  const ids = Array.from(new Set(rows.map((r) => r.created_by).filter((x): x is string => !!x)))
  const names = new Map<string, string>()
  if (ids.length) {
    const { data: users } = await db.from('users').select('id, full_name').in('id', ids)
    for (const u of (users ?? []) as Array<{ id: string; full_name: string | null }>) if (u.full_name) names.set(u.id, u.full_name)
  }
  const { data: sent } = await db
    .from('customer_messages')
    .select('id, kind, status, delivery_status, skip_reason, provider_error, last_error, sent_at, created_at, message_key')
    .eq('channel', 'sms')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(6)
  const { data: got } = await db.from('sms_inbound').select('id, kind, received_at').eq('customer_id', customerId).order('received_at', { ascending: false }).limit(6)
  const out = ((sent ?? []) as Array<{ id: string; kind: string; status: string; delivery_status: string | null; skip_reason: string | null; provider_error: string | null; last_error: string | null; sent_at: string | null; created_at: string; message_key: string }>).map((r) => {
    const d = deliveryOf(r)
    return { id: r.id, at: r.sent_at ?? r.created_at, direction: 'out' as const, label: d.label, detail: d.detail }
  })
  const inn = ((got ?? []) as Array<{ id: string; kind: string; received_at: string }>).map((r) => ({
    id: r.id,
    at: r.received_at,
    direction: 'in' as const,
    label: r.kind === 'stop' || r.kind === 'optout_phrase' ? 'They asked to stop' : r.kind === 'start' ? 'They texted START' : r.kind === 'help' ? 'They texted HELP' : 'They texted us',
    detail: null,
  }))
  return {
    status,
    consent: rows.map((r) => ({
      id: r.id,
      at: r.created_at,
      granted: r.status === 'granted',
      how: CONSENT_SOURCE_TEXT[r.source] ?? r.source,
      by: r.created_by ? (names.get(r.created_by) ?? 'A staff member') : null,
      wording: r.wording_version,
    })),
    recent: [...out, ...inn].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6),
  }
}
