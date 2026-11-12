import { NextResponse } from 'next/server'

import { parseAreaMeasureSettingsPatch } from '@/lib/area-measure'
import { loadAreaMeasureSettings, saveAreaMeasureSettings } from '@/lib/area-measure-db'
import { requireAuthApi } from '@/lib/auth'
import { crossSiteWrite } from '@/lib/online-payments/access'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { isSuperAdmin } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type Caller = { ok: false; response: NextResponse } | { ok: true; admin: ReturnType<typeof createServiceClient>; orgId: string; isOwner: boolean }

const refuse = (error: string, status: number): Caller => ({ ok: false, response: NextResponse.json({ error }, { status }) })

async function caller(request: Request | null, ownerOnly: boolean): Promise<Caller> {
  if (request && crossSiteWrite(request)) return refuse('Forbidden', 403)
  let orgId: string
  let owner: boolean
  try {
    const { profile } = await requireAuthApi()
    orgId = profile.org_id
    owner = isSuperAdmin(profile as never)
  } catch {
    return refuse('Unauthorized', 401)
  }
  if (!(await isOrgFeatureOn(orgId, 'areaMeasure'))) return refuse('Not found', 404)
  if (ownerOnly && !owner) return refuse('Only owners can change these', 403)
  return { ok: true, admin: createServiceClient(), orgId, isOwner: owner }
}

/** The company's mulch depth and pine straw coverage (anyone who can open the tool reads them). */
export async function GET(): Promise<NextResponse> {
  const c = await caller(null, false)
  if (!c.ok) return c.response
  return NextResponse.json({ settings: await loadAreaMeasureSettings(c.admin, c.orgId), canEdit: c.isOwner })
}

/** Owners change them: { mulchDepthIn?, strawSqftPerBale? }. Saved per key, so no other company setting is touched. */
export async function PATCH(request: Request): Promise<NextResponse> {
  const c = await caller(request, true)
  if (!c.ok) return c.response
  const parsed = parseAreaMeasureSettingsPatch(await request.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { error } = await saveAreaMeasureSettings(c.admin, c.orgId, parsed.set)
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  return NextResponse.json({ settings: await loadAreaMeasureSettings(c.admin, c.orgId), canEdit: true })
}
