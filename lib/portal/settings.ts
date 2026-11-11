/**
 * The company's portal settings (`orgs.settings.customerPortal`, owner-only, one per-key writer `mergeOrgSettings`).
 *  - `exactDateDays`: install dates read "Week of <Monday>" until the day is this close, then the exact day (default 3).
 *  - `inviteOnly`: only customers staff invited can get a sign-in link. Default ON for the roofing profile (the pilot: staff
 *    invite a handful), OFF for every other profile (any customer with an email on file can ask for a link).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { DEFAULT_EXACT_DATE_DAYS, MAX_EXACT_DATE_DAYS, exactDateDays } from '@/lib/portal/job-stages'
import { resolveOrgProfile } from '@/lib/org-profile'

export const PORTAL_SETTINGS_KEY = 'customerPortal'
export type PortalSettings = { exactDateDays: number; inviteOnly: boolean }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** Pure: the settings of a company from its `orgs.settings`. */
export function portalSettingsOf(settings: unknown): PortalSettings {
  const stored = obj(obj(settings)[PORTAL_SETTINGS_KEY])
  return {
    exactDateDays: exactDateDays(stored.exactDateDays),
    inviteOnly: typeof stored.inviteOnly === 'boolean' ? stored.inviteOnly : resolveOrgProfile(settings).id === 'roofing',
  }
}

export async function loadPortalSettings(admin: SupabaseClient, orgId: string): Promise<PortalSettings> {
  // org-scope-ok: orgs is keyed by its own id (this company)
  const { data, error } = await admin.from('orgs').select('settings').eq('id', orgId).maybeSingle()
  // A failed read must not open an invite-only company: fall back to the roofing-style default only when the row is unreadable.
  if (error) return { exactDateDays: DEFAULT_EXACT_DATE_DAYS, inviteOnly: true }
  return portalSettingsOf((data as { settings?: unknown } | null)?.settings)
}

/** Parse an owner's save: only the two known keys, each checked. */
export function parsePortalSettingsPatch(body: unknown): { set: Partial<PortalSettings> } | { error: string } {
  const b = obj(body)
  const set: Partial<PortalSettings> = {}
  if ('exactDateDays' in b) {
    const n = Number(b.exactDateDays)
    if (!Number.isInteger(n) || n < 0 || n > MAX_EXACT_DATE_DAYS) return { error: `Days must be a whole number from 0 to ${MAX_EXACT_DATE_DAYS}` }
    set.exactDateDays = n
  }
  if ('inviteOnly' in b) {
    if (typeof b.inviteOnly !== 'boolean') return { error: 'Invite only must be on or off' }
    set.inviteOnly = b.inviteOnly
  }
  return Object.keys(set).length ? { set } : { error: 'Nothing to save' }
}
