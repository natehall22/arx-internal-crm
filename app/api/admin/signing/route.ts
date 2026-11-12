import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { crossSiteWrite } from '@/lib/online-payments/access'
import { parseSigningPatch } from '@/lib/signing/settings'
import { loadSigningSettings, saveSigningSettings } from '@/lib/signing/settings-server'
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
  if (!isSuperAdmin(profile as never)) return { error: NextResponse.json({ error: 'Only owners can change signing settings' }, { status: 403 }) } as const
  return { admin: createServiceClient(), orgId: profile.org_id as string } as const
}

/** Settings → Signing (owners): the e-sign notice, decline, filing, reminders and signed-copy emails. */
export async function GET() {
  const o = await owner(null)
  if ('error' in o) return o.error
  return NextResponse.json({ settings: await loadSigningSettings(o.admin, o.orgId) })
}

export async function PATCH(request: Request) {
  const o = await owner(request)
  if ('error' in o) return o.error
  const current = await loadSigningSettings(o.admin, o.orgId)
  const parsed = parseSigningPatch(current, await request.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { error } = await saveSigningSettings(o.admin, o.orgId, parsed.set)
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  return NextResponse.json({ settings: await loadSigningSettings(o.admin, o.orgId) })
}
