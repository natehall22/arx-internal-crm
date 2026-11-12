/**
 * Send-any-PDF: signing, finishing and the office's actions (server only). The signer's page calls `submitSignature`; the last
 * signature runs `completeRequest`, which is idempotent (every step records itself) so a retry only fills what is missing.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { renderCustomerEmail } from '@/lib/customer-email-layout'
import { newDocumentInsert } from '@/lib/files/documents'
import { getDocumentBrand } from '@/lib/org-brand'
import { cleanPrintName, cleanSignatureImage } from '@/lib/signing-input'
import { buildCertificatePdf } from '@/lib/signing/certificate'
import { emailCompanyFromBrand } from '@/lib/signing/complete'
import { consentCheck } from '@/lib/signing/consent'
import { patchEnvelope } from '@/lib/signing/envelope'
import { listSigningEvents, recordSigningEvent } from '@/lib/signing/events'
import { sha256Hex } from '@/lib/signing/hash'
import { sendSigningEmail } from '@/lib/signing/mail'
import {
  emailSigner, ensureRequestEnvelope, findSignerByToken, loadRequest, notifyNext, REQUEST_KIND, requestExpired, signerLinkToken, type FieldRow, type RequestRow, type SignerRow,
} from '@/lib/signing/requests/db'
import { stampSignedPdf } from '@/lib/signing/requests/pdf'
import { canSignNow, missingFields, type FieldValue, type PlacedField } from '@/lib/signing/requests/types'
import { loadSigningSettings } from '@/lib/signing/settings-server'
import { orgTimeZone } from '@/lib/timezone'

export type SubmitInput = { token: unknown; consent?: unknown; signature?: unknown; initials?: unknown; printName?: unknown; values?: unknown; ip: string | null; userAgent: string | null; /** The signed-in staff user, if any (required for the company signer). */ actingUserId?: string | null }
export type SubmitResult =
  | { ok: true; state: 'signed' | 'completed'; alreadySigned?: boolean }
  | { ok: false; status: number; error: string; code?: string; missing?: string[] }

const TYPED = /^typed:.{1,120}$/
const cleanMark = (v: unknown): string | null => cleanSignatureImage(v) ?? (typeof v === 'string' && TYPED.test(v.trim()) ? v.trim() : null)

/** Today's date as the company writes it on a document ("11/11/2026"), in the company's own time zone. */
export function dateStamp(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function fieldsOf(rows: readonly FieldRow[]): PlacedField[] {
  return rows.map((f) => ({ id: f.id, roleKey: f.role_key, kind: f.kind, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required, ...(f.label ? { label: f.label } : {}) }))
}

async function envelopeSignersPatch(admin: SupabaseClient, request: RequestRow, signers: readonly SignerRow[]) {
  const env = await ensureRequestEnvelope(admin, request, signers)
  if (env === 'not_ready') return null
  await patchEnvelope(admin, env, { signers: signers.map((s) => ({ role: s.role_key, label: s.role_label, name: s.name, email: s.email, order: s.order_index, status: s.status, signedAt: s.signed_at })) })
  return env
}

/** The signer opened their link (a beacon from the page, so a mail scanner's prefetch does not count). */
export async function markSignerViewed(admin: SupabaseClient, token: unknown, ip: string | null, userAgent: string | null): Promise<void> {
  const found = await findSignerByToken(admin, token)
  if (!found || found.request.status !== 'pending' || found.signer.status === 'signed' || requestExpired(found.request)) return
  const now = new Date().toISOString()
  if (found.signer.status === 'pending') {
    await admin.from('signature_request_signers').update({ status: 'viewed', viewed_at: now }).eq('id', found.signer.id).eq('org_id', found.signer.org_id).eq('status', 'pending')
  }
  const env = await ensureRequestEnvelope(admin, found.request, found.signers)
  if (env === 'not_ready') return
  if (env.status === 'sent') await patchEnvelope(admin, env, { status: 'viewed', first_viewed_at: now }, { status: ['sent'] })
  await recordSigningEvent(admin, { org_id: found.request.org_id, envelope_id: env.id, doc_kind: REQUEST_KIND, doc_id: found.request.id, event: 'viewed', signer_key: found.signer.role_key, actor_type: 'signer', actor_name: found.signer.name, ip, user_agent: userAgent })
}

export async function submitSignature(admin: SupabaseClient, input: SubmitInput): Promise<SubmitResult> {
  const found = await findSignerByToken(admin, input.token)
  if (!found) return { ok: false, status: 404, error: 'This signing link was not found' }
  const { signer, request } = found
  if (signer.status === 'signed') return { ok: true, state: request.status === 'completed' ? 'completed' : 'signed', alreadySigned: true }
  if (request.status !== 'pending') return { ok: false, status: 409, error: request.status === 'completed' ? 'This document is already complete' : 'This document is no longer open for signing' }
  if (requestExpired(request)) return { ok: false, status: 410, error: 'This signing link has expired. Ask the sender for a new one.' }
  // The company's countersignature is made signed in, as that staff user (the emailed link alone is not enough).
  if (signer.is_company && (!input.actingUserId || input.actingUserId !== signer.company_user_id)) return { ok: false, status: 401, error: 'Sign in with your company login to sign this.', code: 'login_required' }
  if (!canSignNow(request.signing_order, found.signers, signer.id)) return { ok: false, status: 409, error: 'This is waiting for an earlier signer. You will get an email when it is your turn.', code: 'not_your_turn' }

  const settings = await loadSigningSettings(admin, request.org_id)
  const consent = consentCheck(settings.consentStep, input.consent)
  if (!consent.ok) return { ok: false, status: 400, error: consent.error, code: consent.code }

  const mine = found.fields.filter((f) => f.role_key === signer.role_key)
  const signature = cleanMark(input.signature)
  const initials = cleanMark(input.initials) ?? (typeof input.initials === 'string' && input.initials.trim().length > 0 && input.initials.trim().length <= 8 ? `typed:${input.initials.trim()}` : null)
  const printName = cleanPrintName(input.printName) ?? signer.name
  const raw = (input.values && typeof input.values === 'object' ? input.values : {}) as Record<string, unknown>
  const timeZone = await orgTimeZoneOf(admin, request.org_id)
  const today = dateStamp(new Date(), timeZone)

  const values: Record<string, FieldValue> = {}
  for (const f of mine) {
    const v = raw[f.id]
    if (f.kind === 'checkbox') values[f.id] = v === true
    else if (f.kind === 'text') values[f.id] = typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 500) : ''
    else if (f.kind === 'date') values[f.id] = today
    else if (f.kind === 'name') values[f.id] = printName
  }
  const missing = missingFields(fieldsOf(mine), signer.role_key, values, { signature: !!signature, initials: !!initials })
  if (missing.length > 0) return { ok: false, status: 400, error: 'Some required fields are not filled in', missing: missing.map((m) => m.id) }

  // Field values first: a failed claim afterwards leaves harmless values on an unsigned signer; the reverse would leave a signed one with blanks.
  const nowIso = new Date().toISOString()
  for (const f of mine) {
    if (f.kind === 'signature' || f.kind === 'initials') continue
    const v = values[f.id]
    const { error } = await admin.from('signature_fields').update({ value: v === true ? 'true' : v === false || v == null ? null : String(v), filled_at: nowIso }).eq('id', f.id).eq('org_id', request.org_id).eq('request_id', request.id)
    if (error) return { ok: false, status: 500, error: 'Could not save your answers. Please try again.' }
  }
  const { data: claimed, error: claimError } = await admin
    .from('signature_request_signers')
    .update({
      status: 'signed', signed_at: nowIso, name: printName, ip: input.ip, user_agent: input.userAgent, signature_data: signature, initials_data: initials,
      ...(consent.version ? { consent_version: consent.version, consent_at: nowIso } : {}),
    })
    .eq('id', signer.id)
    .eq('org_id', request.org_id)
    .in('status', ['pending', 'viewed'])
    .select('id')
  if (claimError) return { ok: false, status: 500, error: 'Could not save your signature. Please try again.' }
  if (!claimed || claimed.length === 0) return { ok: true, state: 'signed', alreadySigned: true }

  const env = await ensureRequestEnvelope(admin, request, found.signers)
  if (env !== 'not_ready') {
    const base = { org_id: request.org_id, envelope_id: env.id, doc_kind: REQUEST_KIND, doc_id: request.id, signer_key: signer.role_key, actor_type: 'signer' as const, actor_name: printName, actor_email: signer.email, ip: input.ip, user_agent: input.userAgent }
    if (consent.version) await recordSigningEvent(admin, { ...base, event: 'consent_given', consent_version: consent.version })
    await recordSigningEvent(admin, { ...base, event: 'signed', consent_version: consent.version })
  }
  const after = await loadRequest(admin, request.org_id, request.id)
  if (!after) return { ok: true, state: 'signed' }
  await envelopeSignersPatch(admin, after.request, after.signers)
  if (after.signers.every((s) => s.status === 'signed')) {
    const done = await completeRequest(admin, request.org_id, request.id)
    return { ok: true, state: done.ok ? 'completed' : 'signed' }
  }
  await notifyNext(admin, after, signer.id).catch((e) => console.error('[signing] next signer email failed', e))
  return { ok: true, state: 'signed' }
}

async function orgTimeZoneOf(admin: SupabaseClient, orgId: string): Promise<string> {
  const { data } = await admin.from('orgs').select('timezone').eq('id', orgId).maybeSingle()
  return orgTimeZone((data as { timezone?: unknown } | null)?.timezone)
}

async function download(admin: SupabaseClient, path: string): Promise<Buffer | null> {
  const { data, error } = await admin.storage.from('files').download(path)
  if (error || !data) return null
  return Buffer.from(await (data as Blob).arrayBuffer())
}

export type CompleteRequestResult = { ok: true; sha256: string; certificatePath: string | null } | { ok: false; reason: 'not_found' | 'not_signed' | 'source_changed' | 'error'; error?: string }

/** All signers signed: stamp the PDF, fingerprint it, issue the certificate, file it, send the copies. Every step is claimed once. */
export async function completeRequest(admin: SupabaseClient, orgId: string, requestId: string): Promise<CompleteRequestResult> {
  try {
    let loaded = await loadRequest(admin, orgId, requestId)
    if (!loaded) return { ok: false, reason: 'not_found' }
    if (loaded.signers.length === 0 || !loaded.signers.every((s) => s.status === 'signed')) return { ok: false, reason: 'not_signed' }
    const completedAt = loaded.signers.map((s) => s.signed_at ?? '').sort().slice(-1)[0] || new Date().toISOString()
    if (loaded.request.status === 'pending') {
      await admin.from('signature_requests').update({ status: 'completed', completed_at: completedAt, updated_at: new Date().toISOString() }).eq('id', requestId).eq('org_id', orgId).eq('status', 'pending')
      loaded = (await loadRequest(admin, orgId, requestId)) as NonNullable<typeof loaded>
    }
    if (loaded.request.status !== 'completed') return { ok: false, reason: 'not_signed' }
    const { request, signers, fields } = loaded
    const settings = await loadSigningSettings(admin, orgId)
    const brand = await getDocumentBrand(admin, orgId)

    // 1. The signed PDF (the original bytes + marks). Set once.
    let signedPath = request.signed_path
    if (!signedPath) {
      const source = await download(admin, request.source_path)
      if (!source) return { ok: false, reason: 'error', error: 'The document could not be read from storage' }
      if (sha256Hex(source) !== request.source_sha256) return { ok: false, reason: 'source_changed' }
      const stamped = await stampSignedPdf(source, fields.map((f) => ({ ...fieldsOf([f])[0], value: f.kind === 'checkbox' ? f.value === 'true' : f.value })), signers)
      const path = `org/${orgId}/signing/requests/${requestId}_signed.pdf`
      const { error: upErr } = await admin.storage.from('files').upload(path, Buffer.from(stamped), { contentType: 'application/pdf', upsert: false })
      // upsert:false: the first completer's file is THE signed copy; a second one finds it already there and reads that back (the hash is taken from what is stored).
      if (upErr && !/exist|duplicate/i.test(upErr.message)) return { ok: false, reason: 'error', error: `Upload failed: ${upErr.message}` }
      await admin.from('signature_requests').update({ signed_path: path, updated_at: new Date().toISOString() }).eq('id', requestId).eq('org_id', orgId).is('signed_path', null)
      signedPath = path
    }

    // 2. Envelope: events re-derived from the signer rows, status, hash.
    const envOrNot = await ensureRequestEnvelope(admin, request, signers)
    if (envOrNot === 'not_ready') return { ok: true, sha256: '', certificatePath: null }
    let env = envOrNot
    const base = { org_id: orgId, envelope_id: env.id, doc_kind: REQUEST_KIND, doc_id: requestId }
    for (const s of signers) {
      const who = { signer_key: s.role_key, actor_type: 'signer' as const, actor_name: s.name, actor_email: s.email, ip: s.ip, user_agent: s.user_agent }
      if (s.consent_version) await recordSigningEvent(admin, { ...base, ...who, event: 'consent_given', consent_version: s.consent_version, created_at: s.consent_at ?? s.signed_at ?? undefined })
      await recordSigningEvent(admin, { ...base, ...who, event: 'signed', consent_version: s.consent_version, created_at: s.signed_at ?? undefined })
    }
    await recordSigningEvent(admin, { ...base, event: 'completed', actor_type: 'system', created_at: completedAt })
    if (env.status !== 'completed') env = (await patchEnvelope(admin, env, { status: 'completed', completed_at: completedAt, signers: signers.map((s) => ({ role: s.role_key, label: s.role_label, name: s.name, email: s.email, order: s.order_index, status: 'signed', signedAt: s.signed_at })) }, { status: ['sent', 'viewed'] })) ?? { ...env, status: 'completed' }

    let sha = env.pdf_sha256
    if (!sha) {
      const bytes = await download(admin, signedPath)
      if (!bytes) return { ok: false, reason: 'error', error: 'The signed PDF could not be read back' }
      sha = sha256Hex(bytes)
      const documents = [{ role: 'agreement' as const, title: request.title, storagePath: signedPath, sha256: sha }, ...(env.documents ?? []).filter((d) => d.role === 'certificate')]
      env = (await patchEnvelope(admin, env, { pdf_sha256: sha, pdf_hashed_at: new Date().toISOString(), documents }, { isNull: 'pdf_sha256' })) ?? { ...env, pdf_sha256: sha }
    }

    // 3. Certificate. Set once.
    let certificatePath = env.certificate_path
    if (!certificatePath) {
      const events = await listSigningEvents(admin, orgId, env.id)
      const pdf = buildCertificatePdf({
        brand, certificateId: env.id, documentTitle: request.title, documentSha256: sha as string, hashedAt: env.pdf_hashed_at ?? new Date().toISOString(), provider: env.provider, providerRef: env.provider_ref, sentAt: env.sent_at,
        signers: signers.map((s) => ({ role: s.role_key, label: s.role_label, name: s.name, email: s.email, order: s.order_index, status: 'signed' as const, signedAt: s.signed_at })),
        evidence: Object.fromEntries(signers.map((s) => [s.role_key, { ip: s.ip, userAgent: s.user_agent, consentVersion: s.consent_version, consentAt: s.consent_at }])),
        events: events.map((e) => ({ event: e.event, actor_type: e.actor_type, actor_name: e.actor_name, ip: e.ip, created_at: e.created_at, meta: e.meta })),
        generatedAt: new Date().toISOString(),
      })
      const certPath = `org/${orgId}/signing/requests/${requestId}_certificate_${Date.now()}.pdf`
      const { error: certErr } = await admin.storage.from('files').upload(certPath, pdf, { contentType: 'application/pdf', upsert: false })
      if (certErr) return { ok: false, reason: 'error', error: `Certificate upload failed: ${certErr.message}` }
      const certSha = sha256Hex(pdf)
      const patched = await patchEnvelope(admin, env, { certificate_path: certPath, certificate_sha256: certSha, documents: [...(env.documents ?? []).filter((d) => d.role !== 'certificate'), { role: 'certificate' as const, title: `Certificate of completion — ${request.title}`, storagePath: certPath, sha256: certSha }] }, { isNull: 'certificate_path' })
      if (patched) {
        env = patched
        certificatePath = certPath
        await recordSigningEvent(admin, { ...base, event: 'certificate_issued', actor_type: 'system', meta: { sha256: certSha } })
      } else {
        const again = await ensureRequestEnvelope(admin, request, signers)
        if (again !== 'not_ready') env = again
        certificatePath = env.certificate_path
      }
    }

    // 4. Filed on the customer (when the request is about one), once.
    if (settings.autoFile && request.customer_id && !env.filed_at) {
      const claimed = await patchEnvelope(admin, env, { filed_at: new Date().toISOString() }, { isNull: 'filed_at' })
      if (claimed) {
        const common = { orgId, jobId: request.job_id, customerId: request.customer_id, category: 'contract', uploadedBy: request.created_by as string, mimeType: 'application/pdf' }
        const rows: Array<Record<string, unknown>> = [{ ...newDocumentInsert({ ...common, documentRole: 'signed_executed', storagePath: signedPath, filename: `${request.title}.pdf`, title: `Signed — ${request.title}` }), is_protected: true }]
        if (certificatePath) rows.push({ ...newDocumentInsert({ ...common, documentRole: 'supporting_attachment', storagePath: certificatePath, filename: `${request.title} - certificate of completion.pdf`, title: `Certificate of completion — ${request.title}` }), is_protected: true })
        const { error } = await admin.from('documents').insert(rows)
        if (error) await patchEnvelope(admin, env, { filed_at: null })
        else await recordSigningEvent(admin, { ...base, event: 'filed', actor_type: 'system', meta: { customerId: request.customer_id } })
      }
    }

    // 5. The signed copy to every signer, the sender and the company inbox (company switch), once.
    if (settings.emails.signedCopy && !env.copies_sent_at && certificatePath) {
      const claimed = await patchEnvelope(admin, env, { copies_sent_at: new Date().toISOString() }, { isNull: 'copies_sent_at' })
      if (claimed) {
        const to = new Set(signers.map((s) => String(s.email ?? '').trim().toLowerCase()).filter(Boolean))
        if (request.created_by) {
          const { data } = await admin.from('users').select('email').eq('id', request.created_by).eq('org_id', orgId).maybeSingle()
          const e = String((data as { email?: string } | null)?.email ?? '').trim().toLowerCase()
          if (e) to.add(e)
        }
        const { data: org } = await admin.from('orgs').select('email').eq('id', orgId).maybeSingle()
        const oe = String((org as { email?: string } | null)?.email ?? '').trim().toLowerCase()
        if (oe) to.add(oe)
        const [pdf, cert] = await Promise.all([download(admin, signedPath), download(admin, certificatePath)])
        const rendered = renderCustomerEmail({ company: emailCompanyFromBrand(brand), heading: `${request.title} is signed`, paragraphs: ['Everyone has signed. The signed PDF and its certificate of completion are attached.'], unsubscribeUrl: null })
        const ok = pdf && cert && to.size > 0 && (await sendSigningEmail({ to: Array.from(to), subject: `Signed: ${request.title}`, text: rendered.text, html: rendered.html, attachments: [{ filename: `${request.title}.pdf`, content: pdf, contentType: 'application/pdf' }, { filename: `${request.title} - certificate of completion.pdf`, content: cert, contentType: 'application/pdf' }] }, orgId))
        if (ok) await recordSigningEvent(admin, { ...base, event: 'copy_sent', actor_type: 'system', meta: { to: Array.from(to) } })
        else await patchEnvelope(admin, env, { copies_sent_at: null })
      }
    }
    return { ok: true, sha256: sha as string, certificatePath }
  } catch (error) {
    console.error('[signing] completeRequest failed', error)
    return { ok: false, reason: 'error', error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// ── the office ────────────────────────────────────────────────────────────────────────────────────────────────────

export type ActionResult = { ok: true } | { ok: false; status: number; error: string }
const cleanReason = (v: unknown): string | null => { const s = String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim(); return s.length >= 3 ? s.slice(0, 500) : null }

/** Take a request back: voided (kept), every link stops working, a reason is required. */
export async function voidRequest(admin: SupabaseClient, a: { orgId: string; requestId: string; reason: unknown; actor: { userId: string | null; name?: string | null } }): Promise<ActionResult> {
  const reason = cleanReason(a.reason)
  if (!reason) return { ok: false, status: 400, error: 'Say why you are voiding it' }
  const loaded = await loadRequest(admin, a.orgId, a.requestId)
  if (!loaded) return { ok: false, status: 404, error: 'Not found' }
  const { data } = await admin.from('signature_requests').update({ status: 'voided', updated_at: new Date().toISOString() }).eq('id', a.requestId).eq('org_id', a.orgId).eq('status', 'pending').select('id')
  if (!data || data.length === 0) return { ok: false, status: 409, error: 'This document is no longer open' }
  const env = await ensureRequestEnvelope(admin, loaded.request, loaded.signers)
  if (env !== 'not_ready') {
    await patchEnvelope(admin, env, { status: 'voided', voided_at: new Date().toISOString(), void_reason: reason, voided_by: a.actor.userId }, { status: ['sent', 'viewed'] })
    await recordSigningEvent(admin, { org_id: a.orgId, envelope_id: env.id, doc_kind: REQUEST_KIND, doc_id: a.requestId, event: 'voided', actor_type: 'staff', actor_user_id: a.actor.userId, actor_name: a.actor.name ?? null, meta: { reason } })
  }
  return { ok: true }
}

/** A signer says they will not sign: the whole request ends as declined, with their reason, and stays on record. */
export async function declineRequest(admin: SupabaseClient, a: { token: unknown; reason: unknown; ip: string | null; userAgent: string | null }): Promise<ActionResult> {
  const reason = cleanReason(a.reason)
  if (!reason) return { ok: false, status: 400, error: 'Please tell us why' }
  const found = await findSignerByToken(admin, a.token)
  if (!found) return { ok: false, status: 404, error: 'This signing link was not found' }
  const settings = await loadSigningSettings(admin, found.request.org_id)
  if (!settings.declineEnabled) return { ok: false, status: 409, error: 'This document cannot be declined here. Please contact the sender.' }
  // A signer who already signed cannot decline: their signed evidence stays exactly as it is.
  if (found.signer.status !== 'pending' && found.signer.status !== 'viewed') return { ok: false, status: 409, error: found.signer.status === 'signed' ? 'You have already signed this document.' : 'This document is no longer open' }
  const nowIso = new Date().toISOString()
  // Claim the signer first (only while still pending/viewed: a signature landing a moment ago wins), then end the request.
  const { data: mine } = await admin.from('signature_request_signers').update({ status: 'declined', declined_at: nowIso, decline_reason: reason, ip: a.ip, user_agent: a.userAgent }).eq('id', found.signer.id).eq('org_id', found.request.org_id).in('status', ['pending', 'viewed']).select('id')
  if (!mine || mine.length === 0) return { ok: false, status: 409, error: 'You have already signed this document.' }
  const { data } = await admin.from('signature_requests').update({ status: 'declined', updated_at: nowIso }).eq('id', found.request.id).eq('org_id', found.request.org_id).eq('status', 'pending').gt('expires_at', nowIso).select('id')
  if (!data || data.length === 0) {
    await admin.from('signature_request_signers').update({ status: found.signer.status, declined_at: null, decline_reason: null }).eq('id', found.signer.id).eq('org_id', found.request.org_id).eq('status', 'declined')
    return { ok: false, status: 409, error: 'This document is no longer open' }
  }
  const env = await ensureRequestEnvelope(admin, found.request, found.signers)
  if (env !== 'not_ready') {
    await patchEnvelope(admin, env, { status: 'declined', declined_at: nowIso, decline_reason: reason }, { status: ['sent', 'viewed'] })
    await recordSigningEvent(admin, { org_id: found.request.org_id, envelope_id: env.id, doc_kind: REQUEST_KIND, doc_id: found.request.id, event: 'declined', signer_key: found.signer.role_key, actor_type: 'signer', actor_name: found.signer.name, actor_email: found.signer.email, ip: a.ip, user_agent: a.userAgent, meta: { reason } })
  }
  return { ok: true }
}

/** Send a signer their link again (or a reminder). Throttled to one every 5 minutes; an expired request is extended first. */
export async function resendToSigner(admin: SupabaseClient, a: { orgId: string; requestId: string; signerId: string; extendDays: number; reminder: boolean; actor: { userId: string | null; name?: string | null } }): Promise<ActionResult> {
  const loaded = await loadRequest(admin, a.orgId, a.requestId)
  if (!loaded) return { ok: false, status: 404, error: 'Not found' }
  if (loaded.request.status !== 'pending') return { ok: false, status: 409, error: 'This document is no longer open' }
  const signer = loaded.signers.find((s) => s.id === a.signerId)
  if (!signer || signer.status === 'signed') return { ok: false, status: 409, error: 'That person has already signed' }
  if (!canSignNow(loaded.request.signing_order, loaded.signers, signer.id)) return { ok: false, status: 409, error: 'It is not their turn yet' }
  const env = await ensureRequestEnvelope(admin, loaded.request, loaded.signers)
  if (env !== 'not_ready') {
    const events = await listSigningEvents(admin, a.orgId, env.id)
    const last = events.filter((e) => e.signer_key === signer.role_key && (e.event === 'sent' || e.event === 'resent' || e.event === 'reminder_sent')).map((e) => Date.parse(String(e.created_at))).filter(Number.isFinite).sort().slice(-1)[0]
    if (last && Date.now() - last < 5 * 60 * 1000) return { ok: false, status: 429, error: 'Sent a moment ago. Give it a few minutes.' }
  }
  let request = loaded.request
  if (requestExpired(request)) {
    const expires = new Date(Date.now() + a.extendDays * 86400000).toISOString()
    await admin.from('signature_requests').update({ expires_at: expires, updated_at: new Date().toISOString() }).eq('id', request.id).eq('org_id', a.orgId).eq('status', 'pending')
    request = { ...request, expires_at: expires }
  }
  const token = signerLinkToken(signer)
  if (!token) return { ok: false, status: 409, error: 'This link cannot be sent again' }
  const ok = await emailSigner(admin, { request, signer, token, variant: a.reminder ? 'reminder' : 'resend' })
  if (!ok) return { ok: false, status: 502, error: 'The email could not be sent' }
  if (env !== 'not_ready') await recordSigningEvent(admin, { org_id: a.orgId, envelope_id: env.id, doc_kind: REQUEST_KIND, doc_id: a.requestId, event: a.reminder ? 'reminder_sent' : 'resent', signer_key: signer.role_key, actor_type: 'staff', actor_user_id: a.actor.userId, actor_name: a.actor.name ?? null, actor_email: signer.email })
  return { ok: true }
}
