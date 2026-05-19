import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { isOrgSuperuserRoleSlug } from '@/lib/org-role-constants'
import {
  canAccessJobBoardFromPermissionNames,
  canAccessOpsDashboardFromPermissionNames,
} from '@/lib/permissions'

/**
 * Legacy CRM roles allowed to POST /api/ops/jobs (create from project).
 * Mirrors the pre-permission-matrix guard — users with explicit `jobs:edit` also pass {@link canEditJobs}.
 */
const LEGACY_OPS_JOB_CREATOR_ROLE = new Set([
  'admin',
  'regional_manager',
  'operations',
  'manager',
  'sales_manager',
])

export async function resolveOpsAccess(
  admin: SupabaseClient,
  userId: string,
  profile: { role: string; custom_role_id?: string | null }
) {
  const permissions = await resolveEffectivePermissionNames(admin, userId, profile)

  const roleNorm = String(profile.role || '').toLowerCase().trim()

  const canEditJobs = permissions.fullAccess || permissions.permissionNames.has('jobs:edit')

  /** Create job from `/projects/[id]` (Send to Ops) — grant or legacy role carve-out */
  const canCreateProductionJob =
    canEditJobs || LEGACY_OPS_JOB_CREATOR_ROLE.has(roleNorm) || isOrgSuperuserRoleSlug(roleNorm)

  const canOpsDashboard = canAccessOpsDashboardFromPermissionNames(permissions)

  /** Delete production_jobs row — superuser roles (+ custom full-access only; no coarse jobs:edit alone). */
  const canDeleteProductionJob = permissions.fullAccess || isOrgSuperuserRoleSlug(profile.role)

  const canJobBoard = canAccessJobBoardFromPermissionNames(permissions)

  const canViewJobFinancials =
    permissions.fullAccess || permissions.permissionNames.has('jobs:financials:view')

  return {
    permissions,
    roleNorm,
    canOpsDashboard,
    canJobBoard,
    canEditJobs,
    canCreateProductionJob,
    canDeleteProductionJob,
    canViewJobFinancials,
  }
}

/** Mirrors SSR `/ops` board — coarse cost fields gated by jobs:financials:view (+ fullAccess). */
const REDACT_PRODUCTION_JOB_FINANCIAL_SUMMARY_KEYS = ['labor_cost', 'material_cost', 'dealer_fee_amount'] as const

export function redactProductionJobFinancialSummaryFields<T extends Record<string, unknown>>(
  job: T,
  canViewJobFinancials: boolean
): T {
  if (canViewJobFinancials || !job || typeof job !== 'object') return job
  const out = { ...job }
  for (const k of REDACT_PRODUCTION_JOB_FINANCIAL_SUMMARY_KEYS) {
    delete out[k]
  }
  return out as T
}

export function redactProductionJobsFinancialSummaryRows(
  jobs: Array<Record<string, unknown>>,
  canViewJobFinancials: boolean
): Array<Record<string, unknown>> {
  if (canViewJobFinancials) return jobs
  return jobs.map((j) => redactProductionJobFinancialSummaryFields({ ...j }, false))
}
