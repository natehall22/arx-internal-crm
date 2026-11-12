import { NextRequest, NextResponse } from 'next/server'

import { canManageTemplates, canSendDocuments } from '@/lib/signing/access'
import { adoptUploadedPdf } from '@/lib/signing/requests/store'
import { cleanFields, cleanRoles, LIMITS } from '@/lib/signing/requests/types'
import { loadSigningSettings } from '@/lib/signing/settings-server'
import { PRIVATE, staffSigningGate } from '@/lib/signing/staff-gate'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: PRIVATE })

/** GET /api/signing/templates — the company's saved layouts (anyone who can send documents sees them to send from them). */
export async function GET() {
  const g = await staffSigningGate(null)
  if ('error' in g) return g.error
  const me = { id: g.userId, role: g.profile.role, custom_role_id: g.profile.custom_role_id }
  if (!(await canSendDocuments(g.admin, me))) return json({ error: 'Forbidden' }, 403)
  const { data, error } = await g.admin.from('signature_templates').select('id, name, page_count, roles, created_at, updated_at').eq('org_id', g.profile.org_id).is('archived_at', null).order('name', { ascending: true })
  if (error) return json({ ready: false, templates: [] })
  return json({ ready: true, canManage: await canManageTemplates(g.admin, me), templates: data ?? [] })
}

/** POST /api/signing/templates — JSON { name, roles, fields, uploadPath } (the PDF was uploaded to a slot from /api/signing/uploads). Managers and admins only. */
export async function POST(request: NextRequest) {
  const g = await staffSigningGate(request)
  if ('error' in g) return g.error
  const me = { id: g.userId, role: g.profile.role, custom_role_id: g.profile.custom_role_id }
  if (!(await canManageTemplates(g.admin, me))) return json({ error: 'Forbidden' }, 403)
  const orgId = g.profile.org_id as string
  if (!(await loadSigningSettings(g.admin, orgId)).customDocuments) return json({ error: 'Sending your own documents is turned off for your company.' }, 403)
  let payload: Record<string, any>
  try { payload = await request.json() } catch { return json({ error: 'Bad request' }, 400) }
  const name = String(payload.name ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, LIMITS.maxTitle)
  if (!name) return json({ error: 'Give the template a name' }, 400)
  const stored = await adoptUploadedPdf(g.admin, orgId, payload.uploadPath)
  if (!stored.ok) return json({ error: stored.error }, stored.status)
  const roles = cleanRoles(payload.roles)
  if ('error' in roles) return json({ error: roles.error }, 400)
  const fields = cleanFields(payload.fields, roles, stored.info.pageCount)
  if ('error' in fields) return json({ error: fields.error }, 400)
  const { data, error } = await g.admin.from('signature_templates').insert({ org_id: orgId, name, source_path: stored.path, source_sha256: stored.sha256, page_count: stored.info.pageCount, roles, fields, created_by: g.userId }).select('id').single()
  if (error || !data) return json({ error: 'Could not save the template' }, 500)
  return json({ id: (data as { id: string }).id }, 201)
}
