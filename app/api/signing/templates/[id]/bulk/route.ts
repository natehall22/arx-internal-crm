import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'

import { firstForeignRef } from '@/lib/supabase/org-db'
import { canSendDocuments } from '@/lib/signing/access'
import { createRequest, inviteSigners } from '@/lib/signing/requests/db'
import { LIMITS } from '@/lib/signing/requests/types'
import { loadSigningSettings } from '@/lib/signing/settings-server'
import { PRIVATE, staffSigningGate } from '@/lib/signing/staff-gate'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: PRIVATE })

/**
 * POST /api/signing/templates/<id>/bulk { recipients: [{ name, email, customerId? }], title?, message?, expiresInDays? }
 * One request per recipient from ONE template (a template with a single signer role). Each recipient is its own request with its
 * own link; a bad row is reported and skipped, never blocking the rest. Up to LIMITS.maxBulk at a time.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const g = await staffSigningGate(request)
  if ('error' in g) return g.error
  if (!(await canSendDocuments(g.admin, { id: g.userId, role: g.profile.role, custom_role_id: g.profile.custom_role_id }))) return json({ error: 'Forbidden' }, 403)
  const orgId = g.profile.org_id as string
  if (!(await loadSigningSettings(g.admin, orgId)).customDocuments) return json({ error: 'Sending your own documents is turned off for your company.' }, 403)
  const body = await request.json().catch(() => ({}))
  const recipients = Array.isArray(body?.recipients) ? body.recipients : []
  if (recipients.length === 0) return json({ error: 'Add at least one person' }, 400)
  if (recipients.length > LIMITS.maxBulk) return json({ error: `Send to at most ${LIMITS.maxBulk} people at a time` }, 400)
  const { data: t } = await g.admin.from('signature_templates').select('*').eq('org_id', orgId).eq('id', params.id).is('archived_at', null).maybeSingle()
  if (!t) return json({ error: 'Template not found' }, 404)
  const roles = (t.roles ?? []) as Array<{ key: string; label: string }>
  if (roles.length !== 1) return json({ error: 'Bulk send needs a template with exactly one signer' }, 400)
  const batchId = randomUUID()
  const seen = new Set<string>()
  const results: Array<{ row: number; name: string; email: string; ok: boolean; id?: string; error?: string }> = []
  for (let i = 0; i < recipients.length; i++) {
    const r = (recipients[i] ?? {}) as Record<string, unknown>
    const name = String(r.name ?? '').trim()
    const email = String(r.email ?? '').trim().toLowerCase()
    const fail = (error: string) => results.push({ row: i + 1, name, email, ok: false, error })
    if (seen.has(email)) { fail('Listed twice'); continue }
    seen.add(email)
    if (r.customerId && (await firstForeignRef(g.admin, orgId, { customerId: ['customers', String(r.customerId)] }))) { fail('Customer not found'); continue }
    const made = await createRequest(g.admin, {
      orgId, createdBy: g.userId, title: String(body.title || t.name), sourcePath: t.source_path, sourceSha256: t.source_sha256, pageCount: t.page_count, templateId: t.id, batchId,
      signingOrder: 'parallel', message: body.message, expiresInDays: body.expiresInDays, roles: t.roles, fields: t.fields, signers: [{ roleKey: roles[0].key, name, email }], customerId: (r.customerId as string) ?? null,
    })
    if (!made.ok) { fail(made.error); continue }
    const sent = await inviteSigners(g.admin, made.created.request, made.created.signers, new Map(made.created.signers.map((s) => [s.id, s.token])))
    results.push({ row: i + 1, name, email, ok: sent.sent > 0, id: made.created.request.id, ...(sent.sent > 0 ? {} : { error: 'Created, but the email could not be sent. Resend it from the list.' }) })
  }
  return json({ batchId, sent: results.filter((x) => x.ok).length, results }, 201)
}
