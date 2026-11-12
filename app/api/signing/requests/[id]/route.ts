import { NextRequest, NextResponse } from 'next/server'

import { canActOnSigning, canViewDocuments } from '@/lib/signing/access'
import { listSigningEvents } from '@/lib/signing/events'
import { REQUEST_KIND, loadRequest } from '@/lib/signing/requests/db'
import { completeRequest, resendToSigner, voidRequest } from '@/lib/signing/requests/sign'
import { loadSigningSettings } from '@/lib/signing/settings-server'
import { PRIVATE, staffSigningGate } from '@/lib/signing/staff-gate'
import { effectiveStatus, STATUS_LABELS, type EnvelopeRow } from '@/lib/signing/types'

export const dynamic = 'force-dynamic'
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: PRIVATE })

/** GET /api/signing/requests/<id> — status, signers, the record of events and links to the files. Same company only. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const g = await staffSigningGate(null)
  if ('error' in g) return g.error
  const orgId = g.profile.org_id as string
  const loaded = await loadRequest(g.admin, orgId, params.id)
  if (!loaded) return json({ error: 'Not found' }, 404)
  if (!(await canViewDocuments(g.admin, g.profile)) && loaded.request.created_by !== g.userId) return json({ error: 'Forbidden' }, 403)
  const { data: env } = await g.admin.from('signing_envelopes').select('*').eq('org_id', orgId).eq('doc_kind', REQUEST_KIND).eq('doc_id', params.id).maybeSingle()
  const events = env ? await listSigningEvents(g.admin, orgId, (env as EnvelopeRow).id) : []
  const r = loaded.request
  const status = env ? effectiveStatus(env as EnvelopeRow, { token_expires_at: r.expires_at }) : r.status
  return json({
    ready: true, id: r.id, title: r.title, status, statusLabel: STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status, signingOrder: r.signing_order,
    expiresAt: r.expires_at, completedAt: r.completed_at, createdAt: r.created_at, pageCount: r.page_count, customerId: r.customer_id,
    pdfSha256: (env as EnvelopeRow | null)?.pdf_sha256 ?? null, hasCertificate: !!(env as EnvelopeRow | null)?.certificate_path,
    hasSigned: !!r.signed_path, declineReason: (env as EnvelopeRow | null)?.decline_reason ?? null, voidReason: (env as EnvelopeRow | null)?.void_reason ?? null,
    signers: loaded.signers.map((s) => ({ id: s.id, role: s.role_label, name: s.name, email: s.email, order: s.order_index, status: s.status, signedAt: s.signed_at, viewedAt: s.viewed_at, declineReason: s.decline_reason })),
    events: events.map((e) => ({ event: e.event, at: e.created_at, actor: e.actor_name ?? e.actor_type, signer: e.signer_key || null, ip: e.ip ?? null })),
  })
}

/** POST { action: 'resend' | 'remind' | 'void' | 'certificate', signerId?, reason? } — the office's actions. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const g = await staffSigningGate(request)
  if ('error' in g) return g.error
  const orgId = g.profile.org_id as string
  const body = await request.json().catch(() => ({}))
  const loaded = await loadRequest(g.admin, orgId, params.id)
  if (!loaded) return json({ error: 'Not found' }, 404)
  const action = String(body?.action)
  if (!(await canActOnSigning(g.admin, { id: g.userId, role: g.profile.role, custom_role_id: g.profile.custom_role_id }, loaded.request, action))) return json({ error: 'Forbidden' }, 403)
  const actor = { userId: g.userId, name: (g.profile.full_name as string | undefined) ?? null }
  let result: { ok: true } | { ok: false; status: number; error: string }
  if (action === 'void') result = await voidRequest(g.admin, { orgId, requestId: params.id, reason: body?.reason, actor })
  else if (action === 'resend' || action === 'remind') {
    const settings = await loadSigningSettings(g.admin, orgId)
    result = await resendToSigner(g.admin, { orgId, requestId: params.id, signerId: String(body?.signerId ?? ''), extendDays: settings.extendDays, reminder: action === 'remind', actor })
  } else if (action === 'certificate') {
    const done = await completeRequest(g.admin, orgId, params.id)
    result = done.ok ? { ok: true } : { ok: false, status: 409, error: 'Not finished yet' }
  } else return json({ error: 'Unknown action' }, 400)
  return result.ok ? json({ ok: true }) : json({ ok: false, error: result.error, message: result.error }, result.status)
}
