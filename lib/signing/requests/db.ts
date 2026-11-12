/**
 * Send-any-PDF: the database side (server only). One request = a PDF + signers (each with their own hashed link and turn) +
 * placed fields, tracked by the SAME engine envelope and event record as a contract (doc_kind 'signature-request').
 * Every query is scoped to the company; a signer's link only ever resolves inside its own company (host fence).
 */
import { randomBytes } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import { fenceAllowsOrg } from '@/lib/company-host'
import { getRequestHostFence } from '@/lib/company-host-server'
import { tryOrgAppUrl } from '@/lib/company-links'
import { renderCustomerEmail } from '@/lib/customer-email-layout'
import { getDocumentBrand } from '@/lib/org-brand'
import { hashSigningToken, openSigningToken, sealSigningToken } from '@/lib/signing-tokens'
import { emailCompanyFromBrand } from '@/lib/signing/complete'
import { recordSigningEvent } from '@/lib/signing/events'
import { sendSigningEmail } from '@/lib/signing/mail'
import { cleanFields, cleanRoles, LIMITS, nextToNotify, type PlacedField, type RoleDef, type SigningOrder } from '@/lib/signing/requests/types'
import type { EnvelopeRow } from '@/lib/signing/types'

export const REQUEST_KIND = 'signature-request' as const

export type RequestRow = {
  id: string; org_id: string; title: string; status: 'pending' | 'completed' | 'voided' | 'declined'; signing_order: SigningOrder
  source_path: string; source_sha256: string; page_count: number; template_id: string | null; batch_id: string | null
  customer_id: string | null; opportunity_id: string | null; job_id: string | null; message: string | null
  expires_at: string; signed_path: string | null; completed_at: string | null; created_by: string | null; created_at: string; updated_at: string
}
export type SignerRow = {
  id: string; org_id: string; request_id: string; role_key: string; role_label: string; name: string; email: string | null; phone: string | null
  order_index: number; status: 'pending' | 'viewed' | 'signed' | 'declined'; token_hash: string; token_enc: string | null
  notified_at: string | null; reminder_count: number; viewed_at: string | null; signed_at: string | null; declined_at: string | null; decline_reason: string | null
  ip: string | null; user_agent: string | null; consent_version: string | null; consent_at: string | null; signature_data: string | null; initials_data: string | null
}
export type FieldRow = { id: string; org_id: string; request_id: string; role_key: string; kind: PlacedField['kind']; page: number; x: number; y: number; w: number; h: number; required: boolean; label: string | null; value: string | null; filled_at: string | null }

const cleanText = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type NewSigner = { roleKey: string; name: string; email: string; phone?: string | null }
export type NewRequest = {
  orgId: string
  createdBy: string | null
  title: string
  sourcePath: string
  sourceSha256: string
  pageCount: number
  templateId?: string | null
  batchId?: string | null
  signingOrder?: SigningOrder
  message?: string | null
  expiresInDays?: number
  roles: unknown
  signers: NewSigner[]
  fields: unknown
  customerId?: string | null
  opportunityId?: string | null
  jobId?: string | null
}
export type CreatedRequest = { request: RequestRow; signers: Array<SignerRow & { token: string }>; fields: FieldRow[] }
export type CreateFailure = { ok: false; error: string; status: number }

function newToken(): string {
  return randomBytes(32).toString('hex')
}

/** Check the plan (roles, signers, fields) and write the request, its signers, its fields and its envelope. Nothing is emailed here. */
export async function createRequest(admin: SupabaseClient, a: NewRequest): Promise<{ ok: true; created: CreatedRequest } | CreateFailure> {
  const title = cleanText(a.title, LIMITS.maxTitle)
  if (!title) return { ok: false, error: 'Give the document a title', status: 400 }
  const roles = cleanRoles(a.roles)
  if ('error' in roles) return { ok: false, error: roles.error, status: 400 }
  const fields = cleanFields(a.fields, roles, a.pageCount)
  if ('error' in fields) return { ok: false, error: fields.error, status: 400 }
  const order: SigningOrder = a.signingOrder === 'serial' ? 'serial' : 'parallel'
  const days = Math.min(LIMITS.maxExpiryDays, Math.max(LIMITS.minExpiryDays, Math.round(Number(a.expiresInDays ?? LIMITS.defaultExpiryDays)) || LIMITS.defaultExpiryDays))

  const byRole = new Map(a.signers.map((s) => [s.roleKey, s]))
  if (a.signers.length !== roles.length || roles.some((r: RoleDef) => !byRole.has(r.key))) return { ok: false, error: 'Every signer needs a name and an email', status: 400 }
  const emails = new Set<string>()
  for (const r of roles) {
    const s = byRole.get(r.key) as NewSigner
    if (!cleanText(s.name, 120)) return { ok: false, error: `Add a name for ${r.label}`, status: 400 }
    const email = cleanText(s.email, 200).toLowerCase()
    if (!EMAIL_RE.test(email)) return { ok: false, error: `${r.label} needs a valid email`, status: 400 }
    // Two roles on one address would share a mailbox but not a link; it is allowed (a couple sharing an inbox), the links differ.
    emails.add(email)
  }

  const expiresAt = new Date(Date.now() + days * 86400000).toISOString()
  const { data: reqRow, error: reqErr } = await admin
    .from('signature_requests')
    .insert({
      org_id: a.orgId, title, status: 'pending', signing_order: order, source_path: a.sourcePath, source_sha256: a.sourceSha256, page_count: a.pageCount,
      template_id: a.templateId ?? null, batch_id: a.batchId ?? null, customer_id: a.customerId ?? null, opportunity_id: a.opportunityId ?? null, job_id: a.jobId ?? null,
      message: cleanText(a.message, LIMITS.maxMessage) || null, expires_at: expiresAt, created_by: a.createdBy,
    })
    .select('*')
    .single()
  if (reqErr || !reqRow) return { ok: false, error: 'Could not create the request', status: 500 }
  const request = reqRow as RequestRow

  const undo = async () => { await admin.from('signature_requests').delete().eq('id', request.id).eq('org_id', a.orgId) }
  const signerRows = roles.map((r: RoleDef) => {
    const s = byRole.get(r.key) as NewSigner
    const token = newToken()
    return { token, row: { org_id: a.orgId, request_id: request.id, role_key: r.key, role_label: r.label, name: cleanText(s.name, 120), email: cleanText(s.email, 200).toLowerCase(), phone: cleanText(s.phone, 40) || null, order_index: r.order, status: 'pending', token_hash: hashSigningToken(token), token_enc: sealSigningToken(token) } }
  })
  const { data: signerData, error: signerErr } = await admin.from('signature_request_signers').insert(signerRows.map((s) => s.row)).select('*')
  if (signerErr || !signerData) { await undo(); return { ok: false, error: 'Could not add the signers', status: 500 } }
  const { data: fieldData, error: fieldErr } = await admin
    .from('signature_fields')
    .insert(fields.map((f: PlacedField) => ({ org_id: a.orgId, request_id: request.id, role_key: f.roleKey, kind: f.kind, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required, label: f.label ?? null })))
    .select('*')
  if (fieldErr || !fieldData) { await undo(); return { ok: false, error: 'Could not save the fields', status: 500 } }

  const signers = (signerData as SignerRow[]).map((row) => ({ ...row, token: signerRows.find((s) => s.row.role_key === row.role_key)?.token as string }))
  const env = await ensureRequestEnvelope(admin, request, signers)
  void env
  return { ok: true, created: { request, signers, fields: fieldData as FieldRow[] } }
}

function envelopeSigners(signers: readonly SignerRow[]) {
  return signers.map((s) => ({ role: s.role_key, label: s.role_label, name: s.name, email: s.email, order: s.order_index, status: s.status, signedAt: s.signed_at }))
}

/** The envelope for this request (made at creation; made here if a request somehow lacks one). 'not_ready' = migration not applied. */
export async function ensureRequestEnvelope(admin: SupabaseClient, request: RequestRow, signers: readonly SignerRow[]): Promise<EnvelopeRow | 'not_ready'> {
  // org-scope-ok: org_id comes from the request row this function was handed (already loaded company-scoped); its name only looks like an HTTP request to the checker
  const { data, error } = await admin.from('signing_envelopes').select('*').eq('org_id', request.org_id).eq('doc_kind', REQUEST_KIND).eq('doc_id', request.id).maybeSingle()
  if (error) return 'not_ready'
  if (data) return data as EnvelopeRow
  const { data: created, error: insErr } = await admin
    // org-scope-ok: insert for the same already-loaded request row's company
    .from('signing_envelopes')
    .insert({
      org_id: request.org_id, doc_kind: REQUEST_KIND, doc_id: request.id, provider: 'native', status: 'sent', signers: envelopeSigners(signers),
      documents: [{ role: 'agreement', title: request.title, storagePath: request.signed_path ?? request.source_path, sha256: null }], sent_at: request.created_at,
    })
    .select('*')
    .single()
  if (created) return created as EnvelopeRow
  // org-scope-ok: same loaded request row's company
  const { data: again } = await admin.from('signing_envelopes').select('*').eq('org_id', request.org_id).eq('doc_kind', REQUEST_KIND).eq('doc_id', request.id).maybeSingle()
  void insErr
  return (again as EnvelopeRow | null) ?? 'not_ready'
}

export async function loadRequest(admin: SupabaseClient, orgId: string, id: string): Promise<{ request: RequestRow; signers: SignerRow[]; fields: FieldRow[] } | null> {
  const { data: request } = await admin.from('signature_requests').select('*').eq('org_id', orgId).eq('id', id).maybeSingle()
  if (!request) return null
  const [{ data: signers }, { data: fields }] = await Promise.all([
    admin.from('signature_request_signers').select('*').eq('org_id', orgId).eq('request_id', id).order('order_index', { ascending: true }),
    admin.from('signature_fields').select('*').eq('org_id', orgId).eq('request_id', id),
  ])
  return { request: request as RequestRow, signers: (signers ?? []) as SignerRow[], fields: (fields ?? []) as FieldRow[] }
}

/** The signer a link belongs to, with its request and fields — null for a bad token or another company's address. */
export async function findSignerByToken(admin: SupabaseClient, token: unknown): Promise<{ signer: SignerRow; request: RequestRow; signers: SignerRow[]; fields: FieldRow[] } | null> {
  const t = typeof token === 'string' ? token.trim() : ''
  if (!/^[0-9a-f]{64}$/i.test(t)) return null
  // org-scope-ok: the hashed signer token IS the access: a public link reaches exactly the row it names, in whichever company owns it
  const { data: signer } = await admin.from('signature_request_signers').select('*').eq('token_hash', hashSigningToken(t)).maybeSingle()
  if (!signer) return null
  const s = signer as SignerRow
  if (!fenceAllowsOrg(await getRequestHostFence(), s.org_id)) return null
  const loaded = await loadRequest(admin, s.org_id, s.request_id)
  if (!loaded) return null
  return { signer: s, ...loaded }
}

export function signerLinkToken(s: Pick<SignerRow, 'token_enc'>): string | null {
  return openSigningToken(s.token_enc)
}

export const requestExpired = (r: Pick<RequestRow, 'expires_at'>, now = new Date()) => new Date(r.expires_at).getTime() <= now.getTime()

// ── invitations ───────────────────────────────────────────────────────────────────────────────────────────────────

export type InviteVariant = 'invite' | 'reminder' | 'resend'

/** Email one signer their link. Returns false when it could not be sent (the caller decides if that matters). */
export async function emailSigner(admin: SupabaseClient, a: { request: RequestRow; signer: SignerRow; token: string; variant: InviteVariant }): Promise<boolean> {
  const to = String(a.signer.email ?? '').trim()
  if (!to) return false
  const base = await tryOrgAppUrl(a.request.org_id, 'signature request')
  if (!base) return false
  const brand = await getDocumentBrand(admin, a.request.org_id)
  const reminder = a.variant === 'reminder'
  const until = new Date(a.request.expires_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
  const phone = String(brand.phone ?? '').trim()
  const email = String(brand.email ?? '').trim()
  const contact = phone && email ? `Questions? Call ${phone} or email ${email}.` : phone ? `Questions? Call ${phone}.` : email ? `Questions? Email ${email}.` : null
  const rendered = renderCustomerEmail({
    company: emailCompanyFromBrand(brand),
    heading: reminder ? `Reminder: ${a.request.title} is waiting for your signature` : `${a.request.title} is ready to sign`,
    paragraphs: [
      `Hi ${a.signer.name.split(' ')[0] || 'there'}, ${reminder ? 'a quick reminder that ' : ''}${brand.name} sent you ${a.request.title} to review and sign. It takes about a minute on your phone, with no account or app.`,
      ...(a.request.message ? [a.request.message] : []),
      `This link works until ${until}.`,
    ],
    button: { label: 'Review & sign', href: `${base}/sign/${a.token}` },
    footnote: contact,
    unsubscribeUrl: null,
  })
  return sendSigningEmail({ to, subject: `${reminder ? 'Reminder: ' : ''}${a.request.title} — ${brand.casualName}`, text: rendered.text, html: rendered.html })
}

/** Send the invitations that are due: everyone (parallel) or the first in line (serial). Marks each notified; records 'sent'. */
export async function sendInvitations(admin: SupabaseClient, loaded: { request: RequestRow; signers: SignerRow[] }, tokens: Map<string, string>): Promise<{ sent: number; failed: string[] }> {
  const lowest = Math.min(...loaded.signers.map((s) => s.order_index))
  const due = loaded.request.signing_order === 'serial' ? loaded.signers.filter((s) => s.order_index === lowest) : loaded.signers
  return inviteSigners(admin, loaded.request, due, tokens)
}

export async function inviteSigners(admin: SupabaseClient, request: RequestRow, due: readonly SignerRow[], tokens: Map<string, string>): Promise<{ sent: number; failed: string[] }> {
  const env = await ensureRequestEnvelope(admin, request, due)
  let sent = 0
  const failed: string[] = []
  for (const s of due) {
    const token = tokens.get(s.id) ?? signerLinkToken(s)
    const ok = token ? await emailSigner(admin, { request, signer: s, token, variant: 'invite' }) : false
    if (!ok) { failed.push(s.name); continue }
    sent++
    // org-scope-ok: filtered by the signer id and the loaded request row's company
    await admin.from('signature_request_signers').update({ notified_at: new Date().toISOString() }).eq('id', s.id).eq('org_id', request.org_id)
    if (env !== 'not_ready') await recordSigningEvent(admin, { org_id: request.org_id, envelope_id: env.id, doc_kind: REQUEST_KIND, doc_id: request.id, event: 'sent', signer_key: s.role_key, actor_type: 'system', actor_email: s.email, meta: { role: s.role_label } })
  }
  return { sent, failed }
}

/** After one signer signs on a serial request: email whoever is next in line. */
export async function notifyNext(admin: SupabaseClient, loaded: { request: RequestRow; signers: SignerRow[] }, justSigned: string): Promise<void> {
  const next = nextToNotify(loaded.request.signing_order, loaded.signers, justSigned).map((n) => loaded.signers.find((s) => s.id === n.id) as SignerRow)
  const fresh = next.filter((s) => !s.notified_at)
  if (fresh.length) await inviteSigners(admin, loaded.request, fresh, new Map())
}
