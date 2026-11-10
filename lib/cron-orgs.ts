import type { SupabaseClient } from '@supabase/supabase-js'

import { profileAllowedOnThisDeployment } from '@/lib/auth'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'

/**
 * The ONE answer to "which companies does a background job (Vercel cron, Actions worker) run for".
 *
 * - Only companies with at least one ACTIVE user. A company nobody can sign in to has nobody to email,
 *   notify or call, and this is what keeps leftover test orgs (e.g. the two "ARX Measure Test Org …" rows
 *   in prod, 0 active users) from ever getting checkups, scheduled reports, follow-up routing or email.
 * - Inside the per-copy fence: when env DEPLOYMENT_ORG_ID is set, only that company (same rule as sign-in,
 *   `profileAllowedOnThisDeployment`), so two copies sharing one database never both run a company's jobs.
 *
 * Every row keeps its own org: callers loop these ids and scope every query with `.eq('org_id', id)`.
 */
export type CronOrg = { id: string; settings: Record<string, unknown> | null; timezone: string }

const PAGE = 1000

/** A valid IANA zone from `orgs.timezone`, else the app default. A bad value must never crash a run. */
export function orgTimeZone(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_TIMEZONE
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw.trim() })
    return raw.trim()
  } catch {
    return DEFAULT_TIMEZONE
  }
}

/** Org ids with an active user, paged so a large user table is never cut at the API's 1,000-row default. */
async function orgIdsWithActiveUsers(admin: SupabaseClient): Promise<Set<string>> {
  const ids = new Set<string>()
  for (let from = 0; ; from += PAGE) {
    // org-scope-ok: cross-company on purpose — this IS the list of companies a background job may run for (fenced below)
    const { data, error } = await admin
      .from('users')
      .select('org_id')
      .eq('active', true)
      .not('org_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`active users fetch failed: ${error.message}`)
    for (const row of data || []) if (row.org_id) ids.add(row.org_id as string)
    if (!data || data.length < PAGE) break
  }
  return ids
}

export async function loadCronOrgs(admin: SupabaseClient): Promise<CronOrg[]> {
  const { data, error } = await admin.from('orgs').select('id, settings, timezone').order('id', { ascending: true })
  if (error) throw new Error(`orgs fetch failed: ${error.message}`)
  const active = await orgIdsWithActiveUsers(admin)
  return (data || [])
    .filter((o) => active.has(o.id as string) && profileAllowedOnThisDeployment(o.id as string))
    .map((o) => ({
      id: o.id as string,
      settings: (o.settings as Record<string, unknown> | null) ?? null,
      timezone: orgTimeZone(o.timezone),
    }))
}

/** Just the ids, for jobs that filter rows by org rather than loop. */
export async function loadCronOrgIds(admin: SupabaseClient): Promise<Set<string>> {
  return new Set((await loadCronOrgs(admin)).map((o) => o.id))
}

/** One company's time zone (`orgs.timezone`, validated). For on-demand paths that must agree with a cron's day. */
export async function loadOrgTimeZone(admin: SupabaseClient, orgId: string): Promise<string> {
  const { data } = await admin.from('orgs').select('timezone').eq('id', orgId).maybeSingle()
  return orgTimeZone(data?.timezone)
}
