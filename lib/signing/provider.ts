/**
 * The provider seam. A document is sent for signature THROUGH a provider; the stored records (envelope, events, hashes,
 * certificate, the customer's filed copy) are identical whichever one carries it.
 *
 *   'native'   our own signing pages (today, every company)
 *   'docusign' a company that must use DocuSign (a separate design; NOT built here — the slot below is where it plugs in)
 *
 * What a provider must do (the same five verbs for both):
 *   send      put the document in front of its signers; leaves an envelope (provider + provider_ref) and a 'sent' event
 *   getStatus the envelope's current state (a provider that is asked, not told, reads its own API and mirrors it here)
 *   resend / remind / void / extend   lifecycle, each leaving an event
 *   complete  the document is signed: the signed PDF is stored on the document row, then `completeEnvelope`
 *             (lib/signing/complete.ts) — the ONE completion every provider ends in — records the events, SHA-256, certificate,
 *             filing on the customer and copies. A DocuSign webhook therefore does: set the row's signed fields + PDF path, append
 *             its own events (actor_type 'provider') with `recordSigningEvent`, call `completeEnvelope`. Nothing else is new.
 *
 * `getSigningProvider` is the ONE resolver (company setting `signing.provider`, default 'native'). A company set to a provider
 * that is not registered gets a clear refusal, never a silent fall-back to another provider.
 *
 * NARROW BY DESIGN (DocuSign design, 2026-11-11): a provider may carry ONLY "send my own PDF" documents (`PROVIDER_ELIGIBLE_KINDS`,
 * empty until that kind exists). Contracts, change orders (and quote approval, selections, comp agreements when they move onto
 * the engine) are ALWAYS native: their completion creates the sale, the job and the commission base, their terms have one source
 * and a parity test, and a provider cannot call those hooks or unwind sales counts on a void. `getSigningProvider` takes the
 * kind and answers native for every kind that is not eligible, whatever the company setting says.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { completeEnvelope, type CompleteResult } from '@/lib/signing/complete'
import { ensureEnvelope } from '@/lib/signing/envelope'
import { recordSigningEvent } from '@/lib/signing/events'
import { extendEnvelope, remindEnvelopeNow, resendEnvelope, voidEnvelope, type LifecycleResult } from '@/lib/signing/lifecycle'
import { sendSigningEmail, type SigningMail } from '@/lib/signing/mail'
import { loadSigningSettings } from '@/lib/signing/settings-server'
import type { EffectiveStatus, SigningKind, SigningProviderId } from '@/lib/signing/types'
import { effectiveStatus } from '@/lib/signing/types'

type DocRow = Record<string, any>
export type DocRef = { kind: SigningKind; orgId: string; docId: string }
export type Actor = { userId: string | null; name?: string | null }

export type SendResult = { ok: true; envelopeId: string | null; emailed: boolean } | { ok: false; reason: 'provider_not_configured' | 'not_ready' | 'error'; message: string }
export type StatusResult = { ok: true; status: EffectiveStatus; providerRef: string | null } | { ok: false; reason: 'provider_not_configured' | 'not_found' | 'not_ready'; message: string }

export interface SigningProvider {
  readonly id: SigningProviderId
  /** `deliver` = the email that carries the link (native only; built by the caller so the customer's wording is unchanged). */
  send(admin: SupabaseClient, input: { kind: SigningKind; row: DocRow; actor: Actor; deliver?: SigningMail | null }): Promise<SendResult>
  getStatus(admin: SupabaseClient, ref: DocRef): Promise<StatusResult>
  resend(admin: SupabaseClient, ref: DocRef, actor: Actor): Promise<LifecycleResult<{ extended: boolean }>>
  remind(admin: SupabaseClient, ref: DocRef, actor: Actor): Promise<LifecycleResult<{ extended: boolean }>>
  void(admin: SupabaseClient, ref: DocRef, reason: unknown, actor: Actor): Promise<LifecycleResult>
  extend(admin: SupabaseClient, ref: DocRef, days: number, actor: Actor): Promise<LifecycleResult<{ expiresAt: string }>>
  complete(admin: SupabaseClient, ref: DocRef): Promise<CompleteResult>
}

export const nativeProvider: SigningProvider = {
  id: 'native',

  async send(admin, { kind, row, actor, deliver }) {
    const env = await ensureEnvelope(admin, kind, row)
    if (env === 'not_ready') {
      // Records not set up yet: the document is still sent exactly as before.
      const emailed = deliver ? await sendSigningEmail(deliver) : false
      return { ok: true, envelopeId: null, emailed }
    }
    const emailed = deliver ? await sendSigningEmail(deliver) : false
    await recordSigningEvent(admin, {
      org_id: row.org_id, envelope_id: env.id, doc_kind: kind, doc_id: row.id, event: 'sent',
      actor_type: 'staff', actor_user_id: actor.userId, actor_name: actor.name ?? null,
      actor_email: row.customer_email ?? null, meta: { emailed },
    })
    return { ok: true, envelopeId: env.id, emailed }
  },

  async getStatus(admin, ref) {
    const { data } = await admin.from(ref.kind === 'contract' ? 'order_form_contracts' : 'job_change_orders').select('*').eq('id', ref.docId).eq('org_id', ref.orgId).maybeSingle()
    if (!data) return { ok: false, reason: 'not_found', message: 'That document was not found.' }
    const env = await ensureEnvelope(admin, ref.kind, data as DocRow)
    if (env === 'not_ready') return { ok: false, reason: 'not_ready', message: 'Signing records are not set up yet.' }
    return { ok: true, status: effectiveStatus(env, data as DocRow), providerRef: env.provider_ref }
  },

  resend: (admin, ref, actor) => resendEnvelope(admin, { ...ref, actor }),
  remind: (admin, ref, actor) => remindEnvelopeNow(admin, { ...ref, actor }),
  void: (admin, ref, reason, actor) => voidEnvelope(admin, { ...ref, reason, actor }),
  extend: (admin, ref, days, actor) => extendEnvelope(admin, { ...ref, days, actor }),
  complete: (admin, ref) => completeEnvelope(admin, ref),
}

const REGISTRY: Partial<Record<SigningProviderId, SigningProvider>> = { native: nativeProvider }

/** The DocuSign design registers its provider here (`registerSigningProvider(docusignProvider)`); nothing else changes. */
export function registerSigningProvider(p: SigningProvider): void {
  REGISTRY[p.id] = p
}

export class ProviderNotConfigured extends Error {
  constructor(public readonly providerId: SigningProviderId) {
    super(`The signing provider "${providerId}" is not set up for this company.`)
  }
}

/** Document kinds a non-native provider may carry. Only "send my own PDF" / template documents (added with that kind, engine PR3a). */
export const PROVIDER_ELIGIBLE_KINDS: readonly string[] = []

/** The provider this company sends this kind of document through. Throws ProviderNotConfigured for a provider nobody registered. */
export async function getSigningProvider(admin: SupabaseClient, orgId: string, kind: string): Promise<SigningProvider> {
  if (!PROVIDER_ELIGIBLE_KINDS.includes(kind)) return nativeProvider
  const { provider } = await loadSigningSettings(admin, orgId)
  const p = REGISTRY[provider]
  if (!p) throw new ProviderNotConfigured(provider)
  return p
}
