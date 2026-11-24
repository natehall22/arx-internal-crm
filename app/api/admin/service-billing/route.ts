import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { orgFeatureOffResponse } from '@/lib/org-features-server'
import { mergeOrgSettings } from '@/lib/org-settings'
import { readServiceBillingSettings, SERVICE_BILLING_SETTINGS_KEY } from '@/lib/service-billing-settings'
import { isSuperAdmin } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/** Owners only, and only for a company with service plans on (else 403 feature_off). */
async function owner() {
  let profile: { org_id: string }
  try {
    profile = (await requireAuthApi()).profile as { org_id: string }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) as Response
  }
  if (!isSuperAdmin(profile as never)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) as Response
  const off = await orgFeatureOffResponse(profile.org_id, 'servicePlans')
  if (off) return off as Response
  return { orgId: profile.org_id }
}

/** GET — { autoDraftOnDone } */
export async function GET() {
  const ctx = await owner()
  if (ctx instanceof Response) return ctx
  const { data } = await createServiceClient().from('orgs').select('settings').eq('id', ctx.orgId).maybeSingle()
  return NextResponse.json(readServiceBillingSettings((data as { settings?: unknown } | null)?.settings))
}

/** PATCH { autoDraftOnDone: boolean } — saved per key at path ['serviceBilling']. */
export async function PATCH(request: Request) {
  const ctx = await owner()
  if (ctx instanceof Response) return ctx
  const body = (await request.json().catch(() => null)) as { autoDraftOnDone?: unknown } | null
  if (typeof body?.autoDraftOnDone !== 'boolean') return NextResponse.json({ error: 'Choose on or off' }, { status: 400 })
  const { error } = await mergeOrgSettings(createServiceClient(), ctx.orgId, { autoDraftOnDone: body.autoDraftOnDone }, { path: [SERVICE_BILLING_SETTINGS_KEY] })
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  return NextResponse.json({ ok: true, autoDraftOnDone: body.autoDraftOnDone })
}
