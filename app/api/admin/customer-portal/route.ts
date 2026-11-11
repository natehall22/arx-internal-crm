import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { crossSiteWrite } from '@/lib/online-payments/access'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { mergeOrgSettings } from '@/lib/org-settings'
import { PORTAL_SETTINGS_KEY, loadPortalSettings, parsePortalSettingsPatch } from '@/lib/portal/settings'
import { createServiceClient } from '@/lib/supabase/service'
import { isSuperAdmin } from '@/lib/super-admin'

export const dynamic = 'force-dynamic'

async function auth(): Promise<{ orgId: string } | Response> {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!(await isOrgFeatureOn(profile.org_id, 'customerPortal'))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isSuperAdmin(profile as never)) return NextResponse.json({ error: 'Only owners can change the customer portal' }, { status: 403 })
  return { orgId: profile.org_id }
}

/** GET — owners: the portal settings (install-date window, invite only). */
export async function GET() {
  const a = await auth()
  if (a instanceof Response) return a
  return NextResponse.json(await loadPortalSettings(createServiceClient(), a.orgId))
}

/** PATCH { exactDateDays?, inviteOnly? } — owners. Only these two keys are ever written, each checked. */
export async function PATCH(request: Request) {
  if (crossSiteWrite(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const a = await auth()
  if (a instanceof Response) return a
  const parsed = parsePortalSettingsPatch(await request.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const admin = createServiceClient()
  const { error } = await mergeOrgSettings(admin, a.orgId, parsed.set, { path: [PORTAL_SETTINGS_KEY] })
  if (error) return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 })
  return NextResponse.json(await loadPortalSettings(admin, a.orgId))
}
