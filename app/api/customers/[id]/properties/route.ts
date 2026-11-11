import { NextResponse } from 'next/server'

import { resolveCustomerAccess } from '@/lib/customer-file/customer-access'
import { createProperty, loadCustomerProperties } from '@/lib/properties-db'
import { PROPERTIES_NOT_READY } from '@/lib/properties'
import { threadAuth } from '@/lib/threads/api'

export const dynamic = 'force-dynamic'

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

/** GET — the customer's properties (?all=1 includes turned-off ones). Gate/access notes only for non-field roles. */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const access = await resolveCustomerAccess(ctx.admin, ctx.viewer, params.id)
  if (!access?.read) return notFound()
  const includeInactive = new URL(request.url).searchParams.get('all') === '1'
  const { ready, properties } = await loadCustomerProperties(ctx.admin, ctx.viewer.orgId, params.id, { includeInactive, accessNotes: access.accessNotes })
  return NextResponse.json({ ready, properties, canEdit: access.edit, accessNotes: access.accessNotes })
}

/** POST — add a property to the customer. body: PropertyInput (lib/properties.ts). */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const access = await resolveCustomerAccess(ctx.admin, ctx.viewer, params.id)
  if (!access?.read) return notFound()
  if (!access.edit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await request.json().catch(() => null)
  const result = await createProperty(ctx.admin, ctx.viewer.orgId, ctx.profile.id, params.id, body, { accessNotes: access.accessNotes })
  if (!result.ok) return NextResponse.json({ error: result.status === 503 ? PROPERTIES_NOT_READY : result.error }, { status: result.status })
  return NextResponse.json({ property: result.property }, { status: 201 })
}
