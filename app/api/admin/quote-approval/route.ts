import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { crossSiteWrite } from '@/lib/online-payments/access'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { mergeOrgSettings } from '@/lib/org-settings'
import { parseQuoteApprovalPatch, QUOTE_APPROVAL_SETTINGS_KEY, readQuoteApprovalSettings } from '@/lib/quotes/settings'
import { isSuperAdmin } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

async function owner(request: Request | null) {
  if (request && crossSiteWrite(request)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  }
  if (!(await isOrgFeatureOn(profile.org_id, 'quoteApproval'))) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) } as const
  if (!isSuperAdmin(profile as never)) return { error: NextResponse.json({ error: 'Only owners can change quote settings' }, { status: 403 }) } as const
  return { admin: createServiceClient(), orgId: profile.org_id } as const
}

async function read(admin: ReturnType<typeof createServiceClient>, orgId: string) {
  const { data } = await admin.from('orgs').select('settings').eq('id', orgId).maybeSingle()
  return readQuoteApprovalSettings((data as { settings?: unknown } | null)?.settings)
}

/** Settings → Quotes (owners): the default deposit, how long a link works, the terms customers agree to. */
export async function GET() {
  const o = await owner(null)
  if ('error' in o) return o.error
  return NextResponse.json({ settings: await read(o.admin, o.orgId) })
}

export async function PATCH(request: Request) {
  const o = await owner(request)
  if ('error' in o) return o.error
  const parsed = parseQuoteApprovalPatch(await request.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { error } = await mergeOrgSettings(o.admin, o.orgId, { ...parsed.set }, { path: [QUOTE_APPROVAL_SETTINGS_KEY] })
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  return NextResponse.json({ settings: await read(o.admin, o.orgId) })
}
