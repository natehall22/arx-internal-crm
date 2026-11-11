import { NextResponse } from 'next/server'

import { isCustomFieldEntity } from '@/lib/custom-fields'
import { customFieldRecordAccess } from '@/lib/custom-fields-access'
import { saveCustomFieldValues } from '@/lib/custom-fields-db'
import { threadAuth } from '@/lib/threads/api'

export const dynamic = 'force-dynamic'

/** PATCH { entity: 'customer'|'property'|'job', id, values: { [fieldId]: value | null } } → { values } (the merged record values). */
export async function PATCH(request: Request) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const body = (await request.json().catch(() => null)) as { entity?: unknown; id?: unknown; values?: unknown } | null
  if (!body || !isCustomFieldEntity(body.entity) || typeof body.id !== 'string' || !body.id) {
    return NextResponse.json({ error: 'entity and id are required' }, { status: 400 })
  }
  const access = await customFieldRecordAccess(ctx.admin, ctx.viewer, body.entity, body.id)
  if (!access.read) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!access.edit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const result = await saveCustomFieldValues(ctx.admin, ctx.viewer.orgId, body.entity, body.id, body.values)
  if (!result.ok) return NextResponse.json({ error: result.error, fieldId: result.fieldId }, { status: result.status })
  return NextResponse.json({ values: result.value })
}
