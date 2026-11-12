import { NextRequest, NextResponse } from 'next/server'

import { canManageTemplates, canSendDocuments } from '@/lib/signing/access'
import { cleanFields, cleanRoles, LIMITS } from '@/lib/signing/requests/types'
import { PRIVATE, staffSigningGate } from '@/lib/signing/staff-gate'

export const dynamic = 'force-dynamic'
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: PRIVATE })

async function load(g: { admin: any; profile: any }, id: string) {
  const { data } = await g.admin.from('signature_templates').select('*').eq('org_id', g.profile.org_id).eq('id', id).is('archived_at', null).maybeSingle()
  return data as Record<string, any> | null
}

/** GET /api/signing/templates/<id> — the layout (roles + fields) to send from or to edit. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const g = await staffSigningGate(null)
  if ('error' in g) return g.error
  if (!(await canSendDocuments(g.admin, { id: g.userId, role: g.profile.role, custom_role_id: g.profile.custom_role_id }))) return json({ error: 'Forbidden' }, 403)
  const t = await load(g, params.id)
  if (!t) return json({ error: 'Not found' }, 404)
  return json({ id: t.id, name: t.name, pageCount: t.page_count, roles: t.roles, fields: t.fields, updatedAt: t.updated_at })
}

/** PATCH { name?, roles?, fields? } — change the layout (managers and admins). Requests already sent keep the layout they were sent with. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const g = await staffSigningGate(request)
  if ('error' in g) return g.error
  if (!(await canManageTemplates(g.admin, { id: g.userId, role: g.profile.role, custom_role_id: g.profile.custom_role_id }))) return json({ error: 'Forbidden' }, 403)
  const t = await load(g, params.id)
  if (!t) return json({ error: 'Not found' }, 404)
  const body = await request.json().catch(() => ({}))
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.name !== undefined) {
    const name = String(body.name).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, LIMITS.maxTitle)
    if (!name) return json({ error: 'Give the template a name' }, 400)
    patch.name = name
  }
  if (body.roles !== undefined || body.fields !== undefined) {
    const roles = cleanRoles(body.roles ?? t.roles)
    if ('error' in roles) return json({ error: roles.error }, 400)
    const fields = cleanFields(body.fields ?? t.fields, roles, t.page_count)
    if ('error' in fields) return json({ error: fields.error }, 400)
    patch.roles = roles
    patch.fields = fields
  }
  const { error } = await g.admin.from('signature_templates').update(patch).eq('id', params.id).eq('org_id', g.profile.org_id)
  return error ? json({ error: 'Could not save' }, 500) : json({ ok: true })
}

/** DELETE — archive (never deleted: requests sent from it keep pointing at it). */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const g = await staffSigningGate(request)
  if ('error' in g) return g.error
  if (!(await canManageTemplates(g.admin, { id: g.userId, role: g.profile.role, custom_role_id: g.profile.custom_role_id }))) return json({ error: 'Forbidden' }, 403)
  const { data } = await g.admin.from('signature_templates').update({ archived_at: new Date().toISOString() }).eq('id', params.id).eq('org_id', g.profile.org_id).is('archived_at', null).select('id')
  return data && data.length ? json({ ok: true }) : json({ error: 'Not found' }, 404)
}
