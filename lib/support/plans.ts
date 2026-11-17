/**
 * Plans (server only) — the platform owner decides which modules a company may use (lib/org-features.ts, `orgs.plan_entitlements`).
 * Managing plans is the platform's own job: it needs platform-staff identity (`requirePlatformStaffApi`) but NOT a support
 * grant, and it opens none of the company's data (only its name, profile and module list are shown). The one writer is
 * SQL `set_plan_entitlement` (migration 202611270010): it changes the key and appends the `plan_entitlement_log` row in one
 * transaction, so there is no change without a log row. Service role only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { INDUSTRY_PROFILES, storedProfileId } from '@/lib/industry-profiles'
import { isOrgFeature, ORG_FEATURE_KEYS, resolveOrgEntitlements, type OrgFeature, type OrgFeatures } from '@/lib/org-features'

export type PlanCompany = { orgId: string; name: string; profileLabel: string; entitlements: OrgFeatures; unrestricted: boolean }

/** Every company with its plan (NULL plan = unrestricted: every module allowed). Platform staff only. */
export async function listPlanCompanies(admin: SupabaseClient): Promise<PlanCompany[]> {
  // org-scope-ok: cross-company on purpose — the platform owner's own plan screen (callers are platform staff only)
  const { data, error } = await admin.from('orgs').select('id, name, plan:plan_entitlements, profile:settings->profile')
  if (error) throw new Error(`plans: ${error.message}`)
  return ((data as Array<{ id: string; name: string | null; plan: unknown; profile: unknown }> | null) ?? [])
    .map((o) => ({
      orgId: o.id,
      name: o.name || 'Company',
      profileLabel: INDUSTRY_PROFILES[storedProfileId({ profile: o.profile })].label,
      entitlements: resolveOrgEntitlements(o.plan),
      unrestricted: o.plan === null || o.plan === undefined,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export type PlanChange = { orgId: string; staffUserId: string; feature: unknown; entitled: unknown }

/** One toggle. Validates the key and value, then calls the atomic SQL function. Returns the company's new full plan. */
export async function setPlanEntitlement(admin: SupabaseClient, c: PlanChange): Promise<{ ok: true; entitlements: OrgFeatures } | { ok: false; status: number; error: string }> {
  if (!isOrgFeature(c.feature)) return { ok: false, status: 400, error: 'Unknown module' }
  if (typeof c.entitled !== 'boolean') return { ok: false, status: 400, error: 'entitled must be true or false' }
  const feature: OrgFeature = c.feature
  const base = Object.fromEntries(ORG_FEATURE_KEYS.map((k) => [k, true]))
  const { data, error } = await admin.rpc('set_plan_entitlement', { p_org: c.orgId, p_staff: c.staffUserId, p_feature: feature, p_entitled: c.entitled, p_base: base })
  if (error) {
    if (error.code === 'P0002') return { ok: false, status: 404, error: 'No such company' }
    console.error('[plans] set_plan_entitlement failed', error)
    return { ok: false, status: 500, error: 'Could not save the plan change' }
  }
  return { ok: true, entitlements: resolveOrgEntitlements(data) }
}
