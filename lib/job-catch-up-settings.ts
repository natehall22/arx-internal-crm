/**
 * Job catch-up org settings (client-safe): the on/off switch and "stuck after N working days", stored as two top-level
 * `orgs.settings` keys and written only by PATCH /api/admin/settings `type: 'job_catch_up'` (admins / owners) through
 * `mergeOrgSettings` (per-key merge). The generic `type: 'settings'` save strips these keys.
 * The derivation itself is lib/job-catch-up.ts.
 */
import { isOrgSuperuserRoleSlug } from '@/lib/org-role-constants'
import { isOwnerProfile } from '@/lib/super-admin'

/* ------------------------------------------------------------------------ *
 * Org settings (orgs.settings — written only by the admin-gated `job_catch_up` settings save via mergeOrgSettings)
 * ------------------------------------------------------------------------ */

export const JOB_CATCH_UP_ENABLED_KEY = 'job_catch_up_enabled'
export const JOB_CATCH_UP_STUCK_DAYS_KEY = 'job_catch_up_stuck_days'
export const JOB_CATCH_UP_SETTINGS_KEYS: readonly string[] = [JOB_CATCH_UP_ENABLED_KEY, JOB_CATCH_UP_STUCK_DAYS_KEY]
/** Working days (Mon–Fri). */
export const DEFAULT_STUCK_DAYS = 7
export const MIN_STUCK_DAYS = 1
export const MAX_STUCK_DAYS = 60
/** Notes older than this are not fetched for the board; an older "last update" reads "90d+". */
export const ACTIVITY_WINDOW_DAYS = 90

export type JobCatchUpSettings = { enabled: boolean; stuckDays: number }

/** A whole number of days in range, or null. */
export function parseStuckDays(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isInteger(n) || n < MIN_STUCK_DAYS || n > MAX_STUCK_DAYS) return null
  return n
}

/** OFF unless explicitly `true`; anything unreadable falls back to the default 7 days. */
export function readJobCatchUpSettings(settings: unknown): JobCatchUpSettings {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  return {
    enabled: s[JOB_CATCH_UP_ENABLED_KEY] === true,
    stuckDays: parseStuckDays(s[JOB_CATCH_UP_STUCK_DAYS_KEY]) ?? DEFAULT_STUCK_DAYS,
  }
}

/** Who may switch catch-up on/off and set N: admins (admin/owner role) and owners. Anyone who opens Settings can read it. */
export function canEditJobCatchUpSettings(profile: { role?: string | null; is_super_admin?: boolean | null; active?: boolean | null } | null | undefined): boolean {
  if (!profile || profile.active === false) return false
  return isOrgSuperuserRoleSlug(profile.role) || isOwnerProfile(profile)
}


/** A save from the Settings card: `{ enabled?: boolean, stuckDays?: number }` → the settings keys to merge, or why not. */
export function parseJobCatchUpPatch(body: unknown): { set: Record<string, unknown> } | { error: string } {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as { enabled?: unknown; stuckDays?: unknown }) : {}
  const set: Record<string, unknown> = {}
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') return { error: 'enabled must be true or false' }
    set[JOB_CATCH_UP_ENABLED_KEY] = b.enabled
  }
  if (b.stuckDays !== undefined) {
    const days = parseStuckDays(b.stuckDays)
    if (days == null) return { error: `Working days must be a whole number from ${MIN_STUCK_DAYS} to ${MAX_STUCK_DAYS}` }
    set[JOB_CATCH_UP_STUCK_DAYS_KEY] = days
  }
  if (Object.keys(set).length === 0) return { error: 'Nothing to save' }
  return { set }
}
