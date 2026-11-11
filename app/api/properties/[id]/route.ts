import { NextResponse } from 'next/server'

import { resolveCustomerAccess } from '@/lib/customer-file/customer-access'
import { loadProperty, updateProperty } from '@/lib/properties-db'
import { threadAuth } from '@/lib/threads/api'

export const dynamic = 'force-dynamic'

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

/**
 * PATCH — edit a property (address parts, name, notes, gate/access notes) or turn it off/on (`active`). Never deletes:
 * deals, jobs, crew visits and files keep pointing at a turned-off property. Access = the property's customer's rule.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const existing = await loadProperty(ctx.admin, ctx.viewer.orgId, params.id, true)
  if (!existing) return notFound()
  const access = await resolveCustomerAccess(ctx.admin, ctx.viewer, existing.customer_id)
  if (!access?.read) return notFound()
  if (!access.edit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await request.json().catch(() => null)
  const result = await updateProperty(ctx.admin, ctx.viewer.orgId, ctx.profile.id, existing, body, { accessNotes: access.accessNotes })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ property: result.property })
}
