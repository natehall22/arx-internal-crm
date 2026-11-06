/**
 * Explicit job owner (`production_jobs.owner_user_id`, migration 202611060020): who has the ball on a production job.
 * Set by anyone who can already edit jobs (`jobs:edit`, via resolveOpsAccess — no new permission). One write path:
 * PUT /api/ops/jobs/[id]/owner → {@link setJobOwner}. Server only.
 *
 * Owners are office / production people: active users of the org who are not field roles (setters, canvassers, inside
 * sales, call center — by slug or custom-role name, lib/permissions.ts `isFieldRoleLike`) and not sales reps or subs.
 * Before the migration is applied the column is missing: reads treat it as null and a save says so (409), never 500.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { JOB_OWNER_COLUMN, isMissingColumn } from '@/lib/job-catch-up-db'
import { isFieldRoleLike } from '@/lib/permissions'

/** Sales and outside roles that never own a production job (field roles are caught by isFieldRoleLike). */
const NOT_JOB_OWNER_ROLES = new Set(['closer', 'sales_rep', 'rep', 'sub', 'subcontractor', 'crew'])

export type JobOwnerCandidate = { id: string; name: string }

export function isJobOwnerCandidate(u: {
  role?: string | null
  active?: boolean | null
  customRoleName?: string | null
  customRoleDisplayName?: string | null
}): boolean {
  if (u.active === false) return false
  const role = String(u.role ?? '').toLowerCase().trim()
  if (!role || NOT_JOB_OWNER_ROLES.has(role)) return false
  return !isFieldRoleLike({ role, customRoleName: u.customRoleName ?? null, customRoleDisplayName: u.customRoleDisplayName ?? null })
}

type UserRow = { id: string; full_name: string | null; email?: string | null; role: string | null; active: boolean | null; custom_role_id: string | null }

/** Active office / production people of the org, by name. */
export async function loadJobOwnerCandidates(admin: SupabaseClient, orgId: string): Promise<JobOwnerCandidate[]> {
  const [{ data: users, error }, { data: roles }] = await Promise.all([
    admin.from('users').select('id, full_name, email, role, active, custom_role_id').eq('org_id', orgId).eq('active', true),
    admin.from('custom_roles').select('id, name, display_name').eq('org_id', orgId),
  ])
  if (error) throw new Error(error.message)
  const roleById = new Map(((roles ?? []) as Array<{ id: string; name: string | null; display_name: string | null }>).map((r) => [r.id, r]))
  return ((users ?? []) as UserRow[])
    .filter((u) => {
      const cr = u.custom_role_id ? roleById.get(u.custom_role_id) : undefined
      return isJobOwnerCandidate({ role: u.role, active: u.active, customRoleName: cr?.name ?? null, customRoleDisplayName: cr?.display_name ?? null })
    })
    .map((u) => ({ id: u.id, name: (u.full_name || u.email || 'Unnamed').trim() }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export type SetJobOwnerResult =
  | { ok: true; ownerUserId: string | null }
  | { ok: false; status: 400 | 404 | 409 | 500; error: string }

/** Set (or clear, with null) a job's owner. The caller has already checked jobs:edit. */
export async function setJobOwner(admin: SupabaseClient, orgId: string, jobId: string, ownerUserId: string | null): Promise<SetJobOwnerResult> {
  const { data: job } = await admin.from('production_jobs').select('id').eq('id', jobId).eq('org_id', orgId).maybeSingle()
  if (!job) return { ok: false, status: 404, error: 'Job not found' }
  if (ownerUserId) {
    const candidates = await loadJobOwnerCandidates(admin, orgId)
    if (!candidates.some((c) => c.id === ownerUserId)) return { ok: false, status: 400, error: 'Pick an active office or production person' }
  }
  const { error } = await admin.from('production_jobs').update({ [JOB_OWNER_COLUMN]: ownerUserId }).eq('id', jobId).eq('org_id', orgId)
  if (error) {
    if (isMissingColumn(error, JOB_OWNER_COLUMN)) return { ok: false, status: 409, error: 'Job owners are not switched on yet (database update pending).' }
    return { ok: false, status: 500, error: 'Could not save the owner' }
  }
  return { ok: true, ownerUserId }
}
