/**
 * Envelopes (server only): the ONE lifecycle record per document sent for signature. The contract / change-order ROW stays the
 * source of truth for its own status (every sales and payroll reader filters on it); the envelope mirrors it and carries what
 * the row has no place for — provider, who/why for a void or decline, reminders, the SHA-256s, the certificate.
 *
 * Envelopes are made lazily by `ensureEnvelope` from the row, so a document that was sent months ago works with no backfill.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingTable } from '@/lib/supabase/errors'
import { SIGNING_TABLES } from '@/lib/signing-tokens'
import { recordSigningEvent } from '@/lib/signing/events'
import type { EnvelopeDocument, EnvelopeRow, EnvelopeSigner, EnvelopeStatus, SigningKind } from '@/lib/signing/types'

export const SIGNING_KINDS: readonly SigningKind[] = ['contract', 'change-order']
export function isSigningKind(v: unknown): v is SigningKind {
  return v === 'contract' || v === 'change-order'
}

type DocRow = Record<string, any>

/** Plain-words title of the document, for the certificate, emails and the status line. */
export function documentTitle(kind: SigningKind, row: DocRow): string {
  if (kind === 'change-order') return `Change Order ${row.co_number ?? ''}`.trim()
  const t = row.agreement_type || 'installation'
  return t === 'contingency' ? 'Insurance Contingency Agreement' : t === 'repair' ? 'Repair Agreement' : 'Installation Agreement'
}

/** Pure: the envelope a document row describes today (what ensureEnvelope stores for a document that has none yet). */
export function deriveEnvelope(kind: SigningKind, row: DocRow) {
  const signed = !!row.customer_signed_at
  const status: EnvelopeStatus = signed && (row.status === 'completed' || row.status === 'voided') ? 'completed' : row.status === 'voided' ? 'voided' : 'sent'
  const signers: EnvelopeSigner[] = []
  if (row.rep_name) {
    signers.push({ role: 'company', name: String(row.rep_name), email: null, order: 0, status: row.rep_signature_data || row.rep_signed_at ? 'signed' : 'pending', signedAt: row.rep_signed_at ?? row.signed_at ?? null })
  }
  signers.push({
    role: 'customer',
    name: String(row.customer_print_name || row.customer_name || ''),
    email: row.customer_email ?? null,
    order: 1,
    status: signed ? 'signed' : 'pending',
    signedAt: row.customer_signed_at ?? null,
  })
  const path = String(row.pdf_storage_path || row.pdf_url || '').trim() || null
  const documents: EnvelopeDocument[] = [{ role: 'agreement', title: documentTitle(kind, row), storagePath: path, sha256: null }]
  return {
    status,
    signers,
    documents,
    sent_at: (kind === 'change-order' ? row.sent_at : null) ?? row.created_at ?? null,
    completed_at: signed ? row.customer_signed_at : null,
    consent_version: row.consent_version ?? null,
  }
}

export async function loadDocRow(admin: SupabaseClient, kind: SigningKind, orgId: string, docId: string): Promise<DocRow | null> {
  const { data } = await admin.from(SIGNING_TABLES[kind]).select('*').eq('id', docId).eq('org_id', orgId).maybeSingle()
  return (data as DocRow | null) ?? null
}

export async function findEnvelope(admin: SupabaseClient, kind: SigningKind, orgId: string, docId: string): Promise<EnvelopeRow | null | 'not_ready'> {
  const { data, error } = await admin
    .from('signing_envelopes')
    .select('*')
    .eq('org_id', orgId)
    .eq('doc_kind', kind)
    .eq('doc_id', docId)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error)) return 'not_ready'
    throw new Error(`signing envelope: ${error.message}`)
  }
  return (data as EnvelopeRow | null) ?? null
}

/** The envelope for this document row, made from the row when it has none yet. 'not_ready' = migration 202611180010 not applied. */
export async function ensureEnvelope(admin: SupabaseClient, kind: SigningKind, row: DocRow): Promise<EnvelopeRow | 'not_ready'> {
  const orgId = String(row.org_id)
  const found = await findEnvelope(admin, kind, orgId, String(row.id))
  if (found === 'not_ready') return 'not_ready'
  const env = found ?? (await insertEnvelope(admin, kind, row))
  if (env === 'not_ready') return 'not_ready'
  return reconcileEnvelope(admin, kind, row, env)
}

async function insertEnvelope(admin: SupabaseClient, kind: SigningKind, row: DocRow): Promise<EnvelopeRow | 'not_ready'> {
  const d = deriveEnvelope(kind, row)
  const { data, error } = await admin
    .from('signing_envelopes')
    .insert({
      org_id: row.org_id,
      doc_kind: kind,
      doc_id: row.id,
      provider: 'native',
      status: d.status,
      signers: d.signers,
      documents: d.documents,
      sent_at: d.sent_at,
      completed_at: d.completed_at,
      consent_version: d.consent_version,
    })
    .select('*')
    .single()
  if (!error && data) return data as EnvelopeRow
  if (error && isMissingTable(error)) return 'not_ready'
  // Two requests made it at once: the other one's row is the envelope.
  const again = await findEnvelope(admin, kind, String(row.org_id), String(row.id))
  if (again && again !== 'not_ready') return again
  throw new Error(`signing envelope: ${error?.message ?? 'could not create'}`)
}

/**
 * The document row is the truth for its own status: a contract voided by the existing supersede / cancel paths (not through
 * the engine) is voided here too, so the office never sees "Sent" on a dead link. Writes nothing when they already agree.
 */
async function reconcileEnvelope(admin: SupabaseClient, kind: SigningKind, row: DocRow, env: EnvelopeRow): Promise<EnvelopeRow> {
  const signed = !!row.customer_signed_at
  if ((env.status === 'sent' || env.status === 'viewed') && row.status === 'voided' && !signed) {
    const at = row.updated_at || new Date().toISOString()
    const { data } = await admin
      .from('signing_envelopes')
      .update({ status: 'voided', voided_at: at, void_reason: env.void_reason ?? 'Replaced by a newer agreement or closed by the office', updated_at: new Date().toISOString() })
      .eq('id', env.id)
      .eq('org_id', env.org_id)
      .in('status', ['sent', 'viewed'])
      .select('*')
    await recordSigningEvent(admin, { org_id: env.org_id, envelope_id: env.id, doc_kind: kind, doc_id: env.doc_id, event: 'voided', actor_type: 'system', meta: { reason: 'superseded_or_closed' } })
    return ((data as EnvelopeRow[] | null)?.[0] as EnvelopeRow | undefined) ?? { ...env, status: 'voided' }
  }
  if ((env.status === 'sent' || env.status === 'viewed') && row.status === 'completed' && signed) {
    const { data } = await admin
      .from('signing_envelopes')
      .update({ status: 'completed', completed_at: row.customer_signed_at, updated_at: new Date().toISOString() })
      .eq('id', env.id)
      .eq('org_id', env.org_id)
      .in('status', ['sent', 'viewed'])
      .select('*')
    return ((data as EnvelopeRow[] | null)?.[0] as EnvelopeRow | undefined) ?? { ...env, status: 'completed', completed_at: row.customer_signed_at }
  }
  return env
}

/** Conditional patch of one envelope; returns the new row, or null when its `onlyWhen` guard no longer matched. */
export async function patchEnvelope(
  admin: SupabaseClient,
  env: Pick<EnvelopeRow, 'id' | 'org_id'>,
  patch: Record<string, unknown>,
  guard?: { status?: EnvelopeStatus[]; isNull?: string }
): Promise<EnvelopeRow | null> {
  let q = admin
    .from('signing_envelopes')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', env.id)
    .eq('org_id', env.org_id)
  if (guard?.status) q = q.in('status', guard.status)
  if (guard?.isNull) q = q.is(guard.isNull, null)
  const { data, error } = await q.select('*')
  if (error) {
    console.error('[signing] envelope update failed', error.message)
    return null
  }
  return ((data as EnvelopeRow[] | null)?.[0] as EnvelopeRow | undefined) ?? null
}
