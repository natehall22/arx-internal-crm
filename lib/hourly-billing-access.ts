/**
 * Who may use hourly billing (server only). One answer for every hourly-billing route and page:
 *   - the company has `hourlyBilling` on (lib/org-features.ts, default OFF), else nobody (404);
 *   - Hours to bill (see, approve, un-approve): people who record money (`callerCanAccessJobBilling`, money:record —
 *     the same people who invoice jobs and run Ready to bill);
 *   - a job's billing setup (job page card): change = `jobs:edit`; see = `jobs:edit` or money:record (rates are prices);
 *   - the company's rules (Settings): owners (`isSuperAdmin`).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { resolveOpsAccess } from '@/lib/ops-access'
import { isOrgFeatureOn } from '@/lib/org-features-server'

type Profile = { id: string; org_id: string; role: string; custom_role_id?: string | null; is_super_admin?: boolean | null }

export type HourlyAccess = { feature: boolean; bill: boolean; editJob: boolean; viewJob: boolean; owner: boolean }

/** Pure part (tested). */
export function hourlyAccessFor(feature: boolean, f: { bill: boolean; canEditJobs: boolean; owner: boolean }): HourlyAccess {
  if (!feature) return { feature, bill: false, editJob: false, viewJob: false, owner: false }
  return { feature, bill: f.bill, editJob: f.canEditJobs, viewJob: f.canEditJobs || f.bill, owner: f.owner }
}

export async function resolveHourlyAccess(admin: SupabaseClient, profile: Profile): Promise<HourlyAccess> {
  const feature = await isOrgFeatureOn(profile.org_id, 'hourlyBilling')
  if (!feature) return hourlyAccessFor(false, { bill: false, canEditJobs: false, owner: false })
  const { isSuperAdmin } = await import('@/lib/super-admin')
  const [bill, ops] = await Promise.all([callerCanAccessJobBilling(admin, profile), resolveOpsAccess(admin, profile.id, profile)])
  return hourlyAccessFor(true, { bill, canEditJobs: ops.canEditJobs, owner: isSuperAdmin(profile as never) })
}

/** Route guard: signed in (401), hourly billing on (404), then `need` (403). */
export async function hourlyRouteAuth(need: 'bill' | 'viewJob' | 'editJob' | 'owner'): Promise<{ admin: SupabaseClient; userId: string; orgId: string; access: HourlyAccess } | Response> {
  const { NextResponse } = await import('next/server')
  const { requireAuthApi } = await import('@/lib/auth')
  const { createServiceClient } = await import('@/lib/supabase/service')
  let auth: Awaited<ReturnType<typeof requireAuthApi>>
  try {
    auth = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createServiceClient()
  const profile = auth.profile as Profile
  const access = await resolveHourlyAccess(admin, profile)
  if (!access.feature) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!access[need]) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return { admin, userId: profile.id, orgId: profile.org_id, access }
}
