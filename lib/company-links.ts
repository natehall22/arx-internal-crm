/**
 * Server side of "every link the app sends for a company points at THAT company's address".
 *
 * `getAppUrl(org)` (lib/app-url.ts) turns `{ subdomain }` into https://<subdomain>.<APP_BASE_DOMAIN>; this module is
 * the ONE reader of `orgs.subdomain` that feeds it, so a route that builds a link for a record calls
 * `orgAppUrl(client, record.org_id)` (or `tryOrgAppUrl` where the link is optional) instead of `getAppUrl()`.
 *
 * - No subdomain, routing off (APP_BASE_DOMAIN unset) or migration 202611100070 not applied → NEXT_PUBLIC_APP_URL,
 *   byte-identical to before.
 * - Cached per org for 60 s (a company's address almost never changes; one read per org per minute per instance).
 *   Read errors are never cached: a known answer ≤ 10 min old is reused, otherwise the link falls back to
 *   NEXT_PUBLIC_APP_URL (the shared address, which keeps serving every company during the overlap) and logs.
 * - `readOrgSubdomain` is the uncached, fail-closed form for security checks (Google connect return host).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { getAppUrl, tryGetAppUrl } from '@/lib/app-url'
import { normalizeSubdomain } from '@/lib/company-host'
import { isMissingColumn } from '@/lib/supabase/errors'

export type OrgLinkTarget = { subdomain: string | null }

export type OrgSubdomainRead = { ok: true; subdomain: string | null } | { ok: false }

/** Uncached read of a company's stored web name. Missing column (migration not applied) = no subdomain. */
export async function readOrgSubdomain(client: SupabaseClient, orgId: string): Promise<OrgSubdomainRead> {
  const { data, error } = await client.from('orgs').select('subdomain').eq('id', orgId).maybeSingle()
  if (error) {
    if (isMissingColumn(error, 'subdomain')) return { ok: true, subdomain: null }
    return { ok: false }
  }
  return { ok: true, subdomain: normalizeSubdomain((data as { subdomain?: unknown } | null)?.subdomain) }
}

const TTL_MS = 60_000
const STALE_ON_ERROR_MS = 10 * 60_000
const MAX_ENTRIES = 500
type Entry = { target: OrgLinkTarget; fresh: number; storedAt: number }
const cache = new Map<string, Entry>()
const inFlight = new Map<string, Promise<OrgLinkTarget>>()

export function __resetCompanyLinksCacheForTests(): void {
  cache.clear()
  inFlight.clear()
}

/** What a link for this company needs (its web name). Never throws. */
export async function loadOrgForLinks(client: SupabaseClient, orgId: string | null | undefined): Promise<OrgLinkTarget> {
  if (!orgId) return { subdomain: null }
  const now = Date.now()
  const hit = cache.get(orgId)
  if (hit && hit.fresh > now) return hit.target
  const pending = inFlight.get(orgId)
  if (pending) return pending

  const p = readOrgSubdomain(client, orgId)
    .catch((): OrgSubdomainRead => ({ ok: false }))
    .then((r): OrgLinkTarget => {
      const at = Date.now()
      if (r.ok) {
        const target = { subdomain: r.subdomain }
        cache.delete(orgId)
        while (cache.size >= MAX_ENTRIES) {
          const oldest = cache.keys().next().value
          if (oldest === undefined) break
          cache.delete(oldest)
        }
        cache.set(orgId, { target, fresh: at + TTL_MS, storedAt: at })
        return target
      }
      const last = cache.get(orgId)
      if (last && at - last.storedAt <= STALE_ON_ERROR_MS) return last.target
      console.error('[company-links] could not read the company address; using the shared app address', { orgId })
      return { subdomain: null }
    })
    .finally(() => inFlight.delete(orgId))
  inFlight.set(orgId, p)
  return p
}

/** The company's app origin for links (throws AppUrlNotConfiguredError like getAppUrl). */
export async function orgAppUrl(client: SupabaseClient, orgId: string | null | undefined): Promise<string> {
  return getAppUrl(await loadOrgForLinks(client, orgId))
}

/** Same, for a link that is only part of the work: logs and returns null instead of throwing. */
export async function tryOrgAppUrl(client: SupabaseClient, orgId: string | null | undefined, context: string): Promise<string | null> {
  return tryGetAppUrl(context, await loadOrgForLinks(client, orgId))
}
