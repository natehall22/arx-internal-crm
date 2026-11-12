import { NextRequest, NextResponse } from 'next/server'

import { firstForeignRef } from '@/lib/supabase/org-db'
import { canSendDocuments } from '@/lib/signing/access'
import { createRequest, inviteSigners, type NewSigner } from '@/lib/signing/requests/db'
import { storeUploadedPdf } from '@/lib/signing/requests/store'
import { firstWave, LIMITS } from '@/lib/signing/requests/types'
import { loadSigningSettings } from '@/lib/signing/settings-server'
import { PRIVATE, staffSigningGate } from '@/lib/signing/staff-gate'
import { tryOrgAppUrl } from '@/lib/company-links'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: PRIVATE })

/** GET /api/signing/requests?customerId=&limit= — the company's signature requests, newest first, with each signer's state. */
export async function GET(request: NextRequest) {
  const g = await staffSigningGate(null)
  if ('error' in g) return g.error
  const url = new URL(request.url)
  const customerId = url.searchParams.get('customerId')
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 100))
  let q = g.admin.from('signature_requests').select('id, title, status, signing_order, page_count, customer_id, batch_id, expires_at, completed_at, created_by, created_at').eq('org_id', g.profile.org_id).order('created_at', { ascending: false }).limit(limit)
  if (customerId) q = q.eq('customer_id', customerId)
  const { data, error } = await q
  if (error) return json({ ready: false, requests: [] })
  const ids = (data ?? []).map((r: { id: string }) => r.id)
  const { data: signers } = ids.length
    ? await g.admin.from('signature_request_signers').select('request_id, role_label, name, status, order_index').eq('org_id', g.profile.org_id).in('request_id', ids)
    : { data: [] as Array<Record<string, unknown>> }
  const by = new Map<string, Array<Record<string, unknown>>>()
  for (const s of signers ?? []) { const k = String(s.request_id); by.set(k, [...(by.get(k) ?? []), s]) }
  return json({ ready: true, requests: (data ?? []).map((r: { id: string }) => ({ ...r, signers: (by.get(r.id) ?? []).sort((a, b) => Number(a.order_index) - Number(b.order_index)) })) })
}

/**
 * POST /api/signing/requests — multipart: `file` (a PDF; or none when `payload.templateId` is given) + `payload` JSON
 * { title, templateId?, roles, fields, signers: [{roleKey, name, email}], signingOrder?, message?, expiresInDays?, customerId?, opportunityId?, jobId? }.
 * Stores the PDF, checks the plan, creates the request and emails the signers (all at once, or the first in line).
 */
export async function POST(request: NextRequest) {
  const g = await staffSigningGate(request)
  if ('error' in g) return g.error
  const me = { id: g.userId, role: g.profile.role, custom_role_id: g.profile.custom_role_id }
  if (!(await canSendDocuments(g.admin, me))) return json({ error: 'Forbidden' }, 403)
  const orgId = g.profile.org_id as string
  if (!(await loadSigningSettings(g.admin, orgId)).customDocuments) return json({ error: 'Sending your own documents is turned off for your company.' }, 403)

  let form: FormData
  try { form = await request.formData() } catch { return json({ error: 'Send the document as a form upload' }, 400) }
  let payload: Record<string, any>
  try { payload = JSON.parse(String(form.get('payload') ?? '{}')) } catch { return json({ error: 'Bad request' }, 400) }

  // Whose record this is about: all of it must be this company's.
  const refs: Record<string, [string, string]> = {}
  if (payload.customerId) refs.customerId = ['customers', String(payload.customerId)]
  if (payload.opportunityId) refs.opportunityId = ['opportunities', String(payload.opportunityId)]
  if (payload.jobId) refs.jobId = ['production_jobs', String(payload.jobId)]
  if (await firstForeignRef(g.admin, orgId, refs)) return json({ error: 'Not found' }, 404)

  let source: { path: string; sha256: string; pageCount: number }
  let roles = payload.roles
  let fields = payload.fields
  let templateId: string | null = null
  if (payload.templateId) {
    const { data: t } = await g.admin.from('signature_templates').select('*').eq('org_id', orgId).eq('id', String(payload.templateId)).is('archived_at', null).maybeSingle()
    if (!t) return json({ error: 'Template not found' }, 404)
    source = { path: t.source_path, sha256: t.source_sha256, pageCount: t.page_count }
    roles = t.roles
    fields = t.fields
    templateId = t.id
  } else {
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) return json({ error: 'Choose a PDF to send' }, 400)
    if (file.size > LIMITS.maxPdfBytes) return json({ error: 'That PDF is too large' }, 413)
    const stored = await storeUploadedPdf(g.admin, orgId, new Uint8Array(await file.arrayBuffer()))
    if (!stored.ok) return json({ error: stored.error }, stored.status)
    source = { path: stored.path, sha256: stored.sha256, pageCount: stored.info.pageCount }
  }

  const made = await createRequest(g.admin, {
    orgId, createdBy: g.userId, title: payload.title, sourcePath: source.path, sourceSha256: source.sha256, pageCount: source.pageCount, templateId,
    signingOrder: 'parallel', // everyone at once (Nathan); only the company's countersignature waits, automatically
    message: payload.message, expiresInDays: payload.expiresInDays, roles, fields,
    signers: (Array.isArray(payload.signers) ? payload.signers : []) as NewSigner[], customerId: payload.customerId ?? null, opportunityId: payload.opportunityId ?? null, jobId: payload.jobId ?? null,
  })
  if (!made.ok) return json({ error: made.error }, made.status)
  const { request: row, signers } = made.created
  const tokens = new Map(signers.map((s) => [s.id, s.token]))
  const result = await inviteSigners(g.admin, row, firstWave(row.signing_order, signers), tokens)
  const base = await tryOrgAppUrl(orgId, 'signature request links')
  return json({
    id: row.id, sent: result.sent, failed: result.failed,
    links: base ? signers.map((s) => ({ name: s.name, role: s.role_label, url: `${base}/sign/${s.token}` })) : [],
  }, 201)
}
