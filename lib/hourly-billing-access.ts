/**
 * Who may use hourly billing (server only). One answer for every hourly-billing route and page:
 *   - the company has `hourlyBilling` on (lib/org-features.ts, default OFF), else nobody (404);
 *   - Hours to bill (see, approve, un-approve): people who record money (`callerCanAccessJobBilling`, money:record —
 *     the same people who invoice jobs and run Ready to bill);
 *   - a job's billing setup (job page card) shows hourly rates (prices): see = money:record, or `jobs:edit` WITH
 *     `reports:financials`; change = `jobs:edit` with money:record or `reports:financials`;
 *   - the company's rules (Settings): owners (`isSuperAdmin`).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { canSeeFinancials } from '@/lib/financials-access'
import { resolveOpsAccess } from '@/lib/ops-access'

type Profile = { id: string; org_id: string; role: string; custom_role_id?: string | null; is_super_admin?: boolean | null }

export type HourlyAccess = { feature: boolean; bill: boolean; editJob: boolean; viewJob: boolean; owner: boolean }

/** Pure part (tested). */
export function hourlyAccessFor(feature: boolean, f: { bill: boolean; canEditJobs: boolean; financials: boolean; owner: boolean }): HourlyAccess {
  if (!feature) return { feature, bill: false, editJob: false, viewJob: false, owner: false }
  const money = f.bill || f.financials
  return { feature, bill: f.bill, editJob: f.canEditJobs && money, viewJob: f.bill || (f.canEditJobs && f.financials), owner: f.owner }
}

export async function resolveHourlyAccess(admin: SupabaseClient, profile: Profile): Promise<HourlyAccess> {
  // Dynamic: org-features-server pulls in next/server (keeps the pure part loadable in tests).
  const { isOrgFeatureOn } = await import('@/lib/org-features-server')
  const feature = await isOrgFeatureOn(profile.org_id, 'hourlyBilling')
  if (!feature) return hourlyAccessFor(false, { bill: false, canEditJobs: false, financials: false, owner: false })
  const { isSuperAdmin } = await import('@/lib/super-admin')
  const [bill, ops, financials] = await Promise.all([callerCanAccessJobBilling(admin, profile), resolveOpsAccess(admin, profile.id, profile), canSeeFinancials(admin, profile)])
  return hourlyAccessFor(true, { bill, canEditJobs: ops.canEditJobs, financials, owner: isSuperAdmin(profile as never) })
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
