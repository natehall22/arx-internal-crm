import { NextResponse } from 'next/server'

import { createServiceClient } from '@/lib/supabase/service'
import { listPlanCompanies, setPlanEntitlement } from '@/lib/support/plans'
import { requirePlatformStaffApi } from '@/lib/support/staff'

export const dynamic = 'force-dynamic'

/** GET — every company with its plan. Platform staff only (anyone else: 404). No support grant needed. */
export async function GET(request: Request) {
  const staff = await requirePlatformStaffApi(request)
  if ('error' in staff) return staff.error
  try {
    return NextResponse.json({ companies: await listPlanCompanies(createServiceClient()) })
  } catch (e) {
    console.error('[plans] list failed', e)
    return NextResponse.json({ error: 'Could not load plans' }, { status: 500 })
  }
}

/** PATCH { orgId, feature, entitled } — one module for one company. Platform staff only; logged in the same transaction. */
export async function PATCH(request: Request) {
  const staff = await requirePlatformStaffApi(request)
  if ('error' in staff) return staff.error
  const body = (await request.json().catch(() => null)) as { orgId?: unknown; feature?: unknown; entitled?: unknown } | null
  if (!body || typeof body.orgId !== 'string' || !body.orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  const result = await setPlanEntitlement(createServiceClient(), { orgId: body.orgId, staffUserId: staff.ctx.authUser.id, feature: body.feature, entitled: body.entitled })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, entitlements: result.entitlements })
}
