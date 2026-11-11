/**
 * Who may see / change service plans and visits (server only). One answer for every route and page:
 *   - the company has the `servicePlans` feature switch on (lib/org-features.ts; default OFF), else nobody;
 *   - view plans and visits: job-board people (`canJobBoard`) — the same people who see crews and the schedule;
 *     field roles (setters, canvassers, inside sales) never get it (ops permissions are stripped for them);
 *   - change plans, act on visits, move visits, make crew links: `jobs:edit` (`canEditJobs`), as for install crews;
 *   - see plan prices: `canEditJobs` (they set them) or job financials (`canViewJobFinancials`).
 * Crews act through their phone link (lib/service-plans-db.ts resolveCrewDay), never through this.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveOpsAccess } from '@/lib/ops-access'
import { isOrgFeatureOn } from '@/lib/org-features-server'

export type ServicePlanAccess = { feature: boolean; view: boolean; edit: boolean; prices: boolean }

/** Pure part (tested). */
export function servicePlanAccessFor(feature: boolean, ops: { canJobBoard: boolean; canEditJobs: boolean; canViewJobFinancials: boolean }): ServicePlanAccess {
  if (!feature) return { feature, view: false, edit: false, prices: false }
  const view = ops.canJobBoard || ops.canEditJobs
  return { feature, view, edit: ops.canEditJobs, prices: view && (ops.canEditJobs || ops.canViewJobFinancials) }
}

export async function resolveServicePlanAccess(
  admin: SupabaseClient,
  userId: string,
  profile: { org_id: string; role: string; custom_role_id?: string | null }
): Promise<ServicePlanAccess> {
  const feature = await isOrgFeatureOn(profile.org_id, 'servicePlans')
  if (!feature) return servicePlanAccessFor(false, { canJobBoard: false, canEditJobs: false, canViewJobFinancials: false })
  return servicePlanAccessFor(true, await resolveOpsAccess(admin, userId, profile))
}

/**
 * Route guard shared by every /api route for plans and visits: signed in (401), feature on (404 — a company without
 * service plans has no such API), then `need` ('view' or 'edit', 403).
 */
export async function servicePlanRouteAuth(need: 'view' | 'edit' | 'owner'): Promise<
  | {
      admin: SupabaseClient
      userId: string
      orgId: string
      access: ServicePlanAccess
      /** Owner (super admin): manages plan templates. */
      owner: boolean
    }
  | Response
> {
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
  const { isSuperAdmin } = await import('@/lib/super-admin')
  const profile = auth.profile as { id: string; org_id: string; role: string; custom_role_id?: string | null; is_super_admin?: boolean | null; active?: boolean | null }
  const access = await resolveServicePlanAccess(admin, auth.authUser.id, profile)
  if (!access.feature) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const owner = isSuperAdmin(profile)
  const allowed = need === 'view' ? access.view || owner : need === 'edit' ? access.edit : owner
  if (!allowed) return NextResponse.json({ error: need === 'owner' ? 'Only an owner can change plan templates' : 'Forbidden' }, { status: 403 })
  return { admin, userId: profile.id, orgId: profile.org_id, access, owner }
}

/**
 * A crew phone link that may be used right now: the token resolves (lib/service-plans-db.ts resolveCrewDay) AND the
 * company still has service plans switched on. The page and every /api/crew/day route go through this.
 */
export async function activeCrewDay(admin: SupabaseClient, token: string) {
  const { resolveCrewDay } = await import('@/lib/service-plans-db')
  const crew = await resolveCrewDay(admin, token)
  if (!crew) return null
  return (await isOrgFeatureOn(crew.orgId, 'servicePlans')) ? crew : null
}
