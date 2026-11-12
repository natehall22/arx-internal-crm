/**
 * Evidence: ONE append-only event record per thing that happens to an envelope (server only). A write that fails never breaks
 * what it describes (a customer's signature is saved first, recorded here second) — `completeEnvelope` re-derives anything
 * missing from what the document row itself stores, so a lost event is repaired, not lost.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingTable } from '@/lib/supabase/errors'
import type { SigningEventRow } from '@/lib/signing/types'

export type RecordEventResult = { ok: boolean; duplicate?: boolean; notReady?: boolean }

/** Recorded once per envelope (the database has a unique index on the same list). */
export const ONCE_EVENTS: ReadonlySet<string> = new Set(['signed', 'completed', 'declined', 'voided', 'certificate_issued', 'filed', 'consent_given', 'viewed'])
/** Of those, the ones that belong to a signer (once per signer, not once per envelope). */
export const SIGNER_EVENTS: ReadonlySet<string> = new Set(['signed', 'declined', 'consent_given', 'viewed'])

export async function recordSigningEvent(admin: SupabaseClient, event: SigningEventRow): Promise<RecordEventResult> {
  if (ONCE_EVENTS.has(event.event)) {
    const { data: existing } = await admin
      .from('signing_events')
      .select('id')
      .eq('org_id', event.org_id)
      .eq('envelope_id', event.envelope_id)
      .eq('event', event.event)
      .eq('signer_key', event.signer_key ?? '')
      .limit(1)
    if (existing && existing.length > 0) return { ok: true, duplicate: true }
  }
  const { error } = await admin.from('signing_events').insert({
    org_id: event.org_id,
    envelope_id: event.envelope_id,
    doc_kind: event.doc_kind,
    doc_id: event.doc_id,
    event: event.event,
    signer_key: event.signer_key ?? '',
    actor_type: event.actor_type,
    actor_user_id: event.actor_user_id ?? null,
    actor_name: event.actor_name ?? null,
    actor_email: event.actor_email ?? null,
    ip: event.ip ?? null,
    user_agent: event.user_agent ?? null,
    consent_version: event.consent_version ?? null,
    meta: event.meta ?? {},
    ...(event.created_at ? { created_at: event.created_at } : {}),
  })
  if (!error) return { ok: true }
  // The once-per-envelope index (signed / completed / viewed …): already recorded, which is the answer we want.
  if (error.code === '23505') return { ok: true, duplicate: true }
  if (isMissingTable(error)) return { ok: false, notReady: true }
  console.error('[signing] could not record event', event.event, error.message)
  return { ok: false }
}

export async function listSigningEvents(admin: SupabaseClient, orgId: string, envelopeId: string): Promise<SigningEventRow[]> {
  const { data, error } = await admin
    .from('signing_events')
    .select('*')
    .eq('org_id', orgId)
    .eq('envelope_id', envelopeId)
    .order('created_at', { ascending: true })
  if (error) {
    if (!isMissingTable(error)) console.error('[signing] could not read events', error.message)
    return []
  }
  return (data ?? []) as SigningEventRow[]
}

/** Latest event of the given types, for "not more than once every N minutes" rules. */
export async function latestEventAt(admin: SupabaseClient, orgId: string, envelopeId: string, events: string[]): Promise<number | null> {
  const { data } = await admin
    .from('signing_events')
    .select('created_at')
    .eq('org_id', orgId)
    .eq('envelope_id', envelopeId)
    .in('event', events)
    .order('created_at', { ascending: false })
    .limit(1)
  const at = (data as Array<{ created_at: string }> | null)?.[0]?.created_at
  return at ? new Date(at).getTime() : null
}
