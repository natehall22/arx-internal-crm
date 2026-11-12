import { NextRequest, NextResponse } from 'next/server'

import { signFilesObject } from '@/lib/files/files-object'
import { canActOnSigning } from '@/lib/signing/access'
import { documentTitle, isSigningKind, loadDocRow, peekEnvelope } from '@/lib/signing/envelope'
import { listSigningEvents } from '@/lib/signing/events'
import { getSigningProvider } from '@/lib/signing/provider'
import { loadSigningSettings } from '@/lib/signing/settings-server'
import { effectiveStatus, STATUS_LABELS } from '@/lib/signing/types'
import { PRIVATE, staffSigningGate } from '@/lib/signing/staff-gate'

export const dynamic = 'force-dynamic'

async function gate(request: Request | null, params: { kind: string; id: string }) {
  if (!isSigningKind(params.kind)) return { error: NextResponse.json({ error: 'Not found' }, { status: 404, headers: PRIVATE }) } as const
  const g = await staffSigningGate(request)
  if (g.error) return { error: g.error } as const
  return { admin: g.admin, profile: g.profile, userId: g.userId, kind: params.kind, error: undefined } as const
}

/**
 * GET /api/signing/<contract|change-order>/<id> — where a document stands: status, the record of events, the signed copy and
 * certificate (short-lived links). Same company only; field roles refused.
 */
export async function GET(_request: NextRequest, { params }: { params: { kind: string; id: string } }) {
  const g = await gate(null, params)
  if (g.error) return g.error
  const row = await loadDocRow(g.admin, g.kind, g.profile.org_id, params.id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: PRIVATE })
  const env = await peekEnvelope(g.admin, g.kind, row)
  if (env === 'not_ready') return NextResponse.json({ ready: false }, { headers: PRIVATE })
  const status = effectiveStatus(env, row)
  const events = env.id ? await listSigningEvents(g.admin, g.profile.org_id, env.id) : []
  const signedPath = String(row.pdf_storage_path || row.pdf_url || '').trim()
  const [signedUrl, certificateUrl] = await Promise.all([
    status === 'completed' && signedPath ? signFilesObject(g.admin, signedPath, 600) : null,
    env.certificate_path ? signFilesObject(g.admin, env.certificate_path, 600) : null,
  ])
  const settings = await loadSigningSettings(g.admin, g.profile.org_id)
  return NextResponse.json(
    {
      ready: true,
      title: documentTitle(g.kind, row),
      status,
      statusLabel: STATUS_LABELS[status],
      provider: env.provider,
      sentAt: env.sent_at,
      firstViewedAt: env.first_viewed_at,
      expiresAt: row.token_expires_at ?? null,
      declineReason: env.decline_reason,
      voidReason: env.void_reason,
      reminderCount: env.reminder_count,
      pdfSha256: env.pdf_sha256,
      hasCertificate: !!env.certificate_path,
      signedUrl,
      certificateUrl,
      customerEmail: row.customer_email ?? null,
      remindersOn: settings.reminders.enabled,
      extendDays: settings.extendDays,
      events: events.map((e) => ({ event: e.event, at: e.created_at, actor: e.actor_name ?? e.actor_type, ip: e.ip ?? null })),
    },
    { headers: PRIVATE }
  )
}

/** POST { action: 'resend' | 'remind' | 'extend' | 'void' | 'certificate', days?, reason? } — the office's one-tap lifecycle actions. */
export async function POST(request: NextRequest, { params }: { params: { kind: string; id: string } }) {
  const g = await gate(request, params)
  if (g.error) return g.error
  const body = await request.json().catch(() => ({}))
  const row = await loadDocRow(g.admin, g.kind, g.profile.org_id as string, params.id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: PRIVATE })
  if (!(await canActOnSigning(g.admin, { id: g.userId, role: g.profile.role, custom_role_id: g.profile.custom_role_id }, row, String(body?.action)))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: PRIVATE })
  }
  const ref = { kind: g.kind, orgId: g.profile.org_id as string, docId: params.id }
  const actor = { userId: g.profile.id as string, name: (g.profile.full_name as string | undefined) ?? null }
  const provider = await getSigningProvider(g.admin, ref.orgId, g.kind)
  let result
  switch (body?.action) {
    case 'resend':
      result = await provider.resend(g.admin, ref, actor)
      break
    case 'remind':
      result = await provider.remind(g.admin, ref, actor)
      break
    case 'extend': {
      const settings = await loadSigningSettings(g.admin, ref.orgId)
      result = await provider.extend(g.admin, ref, body?.days == null ? settings.extendDays : Number(body.days), actor)
      break
    }
    case 'void':
      result = await provider.void(g.admin, ref, body?.reason, actor)
      break
    case 'certificate': {
      // For a document signed before certificates existed (or one whose certificate failed): issue it now from what is stored.
      const done = await provider.complete(g.admin, ref)
      return done.ok
        ? NextResponse.json({ ok: true }, { headers: PRIVATE })
        : NextResponse.json({ ok: false, message: done.reason === 'pdf_pending' ? 'The signed PDF is not ready yet. Generate it first.' : 'Could not issue the certificate.' }, { status: 409, headers: PRIVATE })
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400, headers: PRIVATE })
  }
  if (result.ok) return NextResponse.json(result, { headers: PRIVATE })
  const status = result.reason === 'not_found' ? 404 : result.reason === 'too_soon' ? 429 : result.reason === 'error' || result.reason === 'send_failed' ? 502 : 409
  return NextResponse.json({ ok: false, reason: result.reason, message: result.message }, { status, headers: PRIVATE })
}
