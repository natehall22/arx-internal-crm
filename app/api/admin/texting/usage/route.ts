import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { monthOf, monthlyUsage } from '@/lib/sms/usage'
import { isSuperAdmin } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'
import { orgTimeZone } from '@/lib/timezone'

export const dynamic = 'force-dynamic'

/**
 * GET ?month=YYYY-MM[&format=csv] — owners: this company's texting usage for a month (the billing source): texts and
 * segments each way, by kind, and what the carrier charged us (estimated until the receipts come in). One row per
 * direction + kind in the CSV.
 */
export async function GET(request: Request) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!(await isOrgFeatureOn(profile.org_id, 'texting'))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isSuperAdmin(profile as never)) return NextResponse.json({ error: 'Only owners can see texting usage' }, { status: 403 })
  const admin = createServiceClient()
  const { data: org } = await admin.from('orgs').select('timezone').eq('id', profile.org_id).maybeSingle()
  const tz = orgTimeZone((org as { timezone?: string | null } | null)?.timezone)
  const url = new URL(request.url)
  const month = url.searchParams.get('month') || monthOf(new Date(), tz)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: 'month must look like 2026-11' }, { status: 400 })
  const usage = await monthlyUsage(admin, profile.org_id, month, tz)
  if (url.searchParams.get('format') !== 'csv') return NextResponse.json(usage)
  const lines = ['month,direction,kind,texts,segments,carrier_cost_usd']
  for (const [k, t] of Object.entries(usage.byKind)) {
    const [direction, kind] = k.split(':')
    lines.push([month, direction, kind, t.texts, t.segments, (t.costMicros / 1_000_000).toFixed(4)].join(','))
  }
  return new NextResponse(`${lines.join('\n')}\n`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="texting-usage-${month}.csv"` } })
}
