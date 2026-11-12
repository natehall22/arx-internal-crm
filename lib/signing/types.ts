/**
 * The signing engine's shared vocabulary (client-safe, no imports beyond types). ONE shape for every document kind and every
 * provider: a document sent for signature is an ENVELOPE (documents + signers in order + fields), each thing that happens to
 * it is an EVENT, and its end state is a signed PDF + a completion certificate, both with SHA-256 hashes.
 */
import type { SigningDocKind } from '@/lib/signing-tokens'

export type SigningKind = SigningDocKind

/** 'native' = our own signing pages. 'docusign' is the seam for companies that must use it (see lib/signing/provider.ts). */
export type SigningProviderId = 'native' | 'docusign'
export const SIGNING_PROVIDER_IDS: readonly SigningProviderId[] = ['native', 'docusign']

/** Stored envelope states. "Expired" is never stored: it is a pending envelope whose link date has passed (`effectiveStatus`). */
export type EnvelopeStatus = 'sent' | 'viewed' | 'completed' | 'declined' | 'voided'

export const SIGNING_EVENT_TYPES = [
  'sent', 'resent', 'reminder_sent', 'viewed', 'consent_given', 'signed', 'declined', 'voided', 'extended',
  'completed', 'certificate_issued', 'copy_sent', 'filed',
] as const
export type SigningEventType = (typeof SIGNING_EVENT_TYPES)[number]

export type SignerRole = 'customer' | 'company'
export type SignerStatus = 'pending' | 'viewed' | 'signed' | 'declined'

export interface EnvelopeSigner {
  role: SignerRole
  name: string
  email: string | null
  /** 0 signs first. A contract's company rep signs at creation (order 0), the customer after (order 1). */
  order: number
  status: SignerStatus
  signedAt: string | null
}

export interface EnvelopeDocument {
  role: 'agreement' | 'certificate'
  title: string
  storagePath: string | null
  sha256: string | null
}

/** Reserved for placed fields (send-any-PDF); a contract and a change order keep the fields their own form has. */
export interface EnvelopeField {
  id: string
  signerRole: SignerRole
  type: 'signature' | 'initials' | 'date' | 'text' | 'checkbox'
  label: string
  required: boolean
}

export interface EnvelopeRow {
  id: string
  org_id: string
  doc_kind: SigningKind
  doc_id: string
  provider: SigningProviderId
  provider_ref: string | null
  status: EnvelopeStatus
  signers: EnvelopeSigner[]
  documents: EnvelopeDocument[]
  fields: EnvelopeField[]
  sent_at: string | null
  first_viewed_at: string | null
  completed_at: string | null
  declined_at: string | null
  decline_reason: string | null
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
  reminder_count: number
  last_reminder_at: string | null
  consent_version: string | null
  pdf_sha256: string | null
  pdf_hashed_at: string | null
  certificate_path: string | null
  certificate_sha256: string | null
  filed_at: string | null
  copies_sent_at: string | null
  created_at: string
  updated_at: string
}

export interface SigningEventRow {
  id?: string
  org_id: string
  envelope_id: string
  doc_kind: SigningKind
  doc_id: string
  event: SigningEventType
  /** Which signer the event is about ('customer', 'company', …); '' (default) for envelope-level events. */
  signer_key?: string
  actor_type: 'signer' | 'staff' | 'system' | 'provider'
  actor_user_id?: string | null
  actor_name?: string | null
  actor_email?: string | null
  ip?: string | null
  user_agent?: string | null
  consent_version?: string | null
  meta?: Record<string, unknown>
  created_at?: string
}

/** What a person looking at the deal sees. */
export type EffectiveStatus = 'sent' | 'viewed' | 'expired' | 'completed' | 'declined' | 'voided'

export const STATUS_LABELS: Record<EffectiveStatus, string> = {
  sent: 'Sent',
  viewed: 'Opened',
  expired: 'Expired',
  completed: 'Signed',
  declined: 'Declined',
  voided: 'Voided',
}

/** Pure: the status to show, from the stored envelope and the document's own link date. */
export function effectiveStatus(
  env: Pick<EnvelopeRow, 'status'>,
  doc: { token_expires_at?: string | null },
  now: Date = new Date()
): EffectiveStatus {
  if (env.status === 'completed' || env.status === 'declined' || env.status === 'voided') return env.status
  const exp = doc.token_expires_at ? new Date(doc.token_expires_at).getTime() : 0
  if (!exp || exp <= now.getTime()) return 'expired'
  return env.status
}
