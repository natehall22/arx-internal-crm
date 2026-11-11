import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { orgFeatureOffResponse } from '@/lib/org-features-server'
import { loadCostCodes, saveCostCodes } from '@/lib/project-tools/budget-db'
import { isSuperAdmin } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'

/** The company's cost code list (empty setup = the built-in defaults). Anyone signed in may read it; owners change it. */
export async function GET() {
  let session
  try {
    session = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const off = await orgFeatureOffResponse(session.profile.org_id, 'projectTools')
  if (off) return off
  return NextResponse.json({ codes: await loadCostCodes(createServiceClient(), session.profile.org_id), canEdit: isSuperAdmin(session.profile) })
}

/** PUT { codes: [{ code?, label, costType?, active? }] } — the whole list, in order. Left-out codes are turned off, never deleted. */
export async function PUT(request: Request) {
  let session
  try {
    session = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const off = await orgFeatureOffResponse(session.profile.org_id, 'projectTools')
  if (off) return off
  if (!isSuperAdmin(session.profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await request.json().catch(() => ({}))) as { codes?: unknown }
  const r = await saveCostCodes(createServiceClient(), session.profile.org_id, body.codes)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ codes: r.codes })
}
