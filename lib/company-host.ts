/**
 * Company address → company (slice 10). The ONE place that turns the request's web address into a company.
 *
 * One app + one shared database: each company signs in at `<subdomain>.<APP_BASE_DOMAIN>` (stored in
 * `orgs.subdomain`). `resolveAuth` (lib/auth.ts, via lib/company-host-server.ts), middleware.ts and the login
 * route all ask this module; nothing else may parse the host.
 *
 * Fence precedence (`resolveCompanyFence`):
 *   1. env DEPLOYMENT_ORG_ID, when set, fences the copy to that org.
 *   2. the host's company, when the host is `<sub>.<APP_BASE_DOMAIN>`.
 *   3. header `X-Company-Code` (iPhone app), only while host routing is on (APP_BASE_DOMAIN set).
 *   Every one that is present must name the SAME org, or the request is refused (fail closed). None present
 *   (APP_BASE_DOMAIN unset, the legacy *.vercel.app address, localhost) = unfenced, exactly as before.
 * A company-shaped host that names no company, a reserved/nested name, the bare base domain and a lookup
 * failure all refuse — never fall back to "unfenced" or to another company.
 *
 * Edge-runtime safe (middleware imports it): fetch only, no Node APIs, no next/headers.
 */

/** Lowercase DNS label: 1–63 chars, a-z 0-9 and inner hyphens. Same rule as the `orgs_subdomain_format` check. */
export const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** Names no company may take (product / infrastructure addresses). Mirrored in migration 202611100070. */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  'www', 'app', 'api', 'admin', 'auth', 'login', 'mail', 'email', 'smtp', 'status', 'help', 'support', 'docs',
  'static', 'assets', 'cdn', 'm', 'mobile', 'dev', 'staging', 'preview', 'test',
])

/** Header the iPhone app sends with every request once the user has entered their company code. */
export const COMPANY_CODE_HEADER = 'x-company-code'

/** Validate a company address for storing on `orgs.subdomain`. Returns the stored form, or null when not allowed. */
export function normalizeSubdomain(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  if (!SUBDOMAIN_RE.test(v) || RESERVED_SUBDOMAINS.has(v)) return null
  return v
}

/** env DEPLOYMENT_ORG_ID (trimmed); null = this copy is not pinned to one company. The one reader of that variable. */
export function deploymentOrgId(): string | null {
  return process.env.DEPLOYMENT_ORG_ID?.trim() || null
}

/** env APP_BASE_DOMAIN (e.g. the product domain), normalized; null = host routing is off. */
export function appBaseDomain(): string | null {
  const raw = process.env.APP_BASE_DOMAIN?.trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '')
  if (!raw || !raw.includes('.') || !/^[a-z0-9.-]+$/.test(raw)) return null
  return raw
}

/**
 * A company's own app address, `https://<subdomain>.<APP_BASE_DOMAIN>`, or null (no subdomain, or routing off).
 * Merge point with lib/app-url.ts (feat/app-domain-cutover): server code that loads an org fills
 * `getAppUrl({ appUrl: companyAppUrl(org.subdomain) })` — the one place the stored address becomes a link.
 */
export function companyAppUrl(subdomain: string | null | undefined, baseDomain: string | null = appBaseDomain()): string | null {
  const sub = normalizeSubdomain(subdomain)
  return sub && baseDomain ? `https://${sub}.${baseDomain}` : null
}

export type HostKind =
  | { kind: 'off' } // APP_BASE_DOMAIN unset: routing disabled
  | { kind: 'legacy' } // any other address (legacy *.vercel.app, localhost, previews): unfenced during the overlap
  | { kind: 'apex' } // the bare product domain or www.: no company
  | { kind: 'company'; subdomain: string }
  | { kind: 'invalid' } // under the base domain but not a usable company name (nested, reserved, malformed)

/** Hostname from a Host header: lowercase, no port, no trailing dot. */
export function hostnameFromHeader(host: string | null | undefined): string {
  let h = (host ?? '').trim().toLowerCase()
  if (h.startsWith('[')) {
    const end = h.indexOf(']')
    h = end > 0 ? h.slice(0, end + 1) : h
  } else {
    h = h.split(':')[0]
  }
  return h.replace(/\.+$/, '')
}

export function classifyHost(host: string | null | undefined, baseDomain: string | null = appBaseDomain()): HostKind {
  if (!baseDomain) return { kind: 'off' }
  const h = hostnameFromHeader(host)
  if (h === baseDomain || h === `www.${baseDomain}`) return { kind: 'apex' }
  const suffix = `.${baseDomain}`
  if (!h.endsWith(suffix)) return { kind: 'legacy' }
  const label = h.slice(0, -suffix.length)
  const sub = normalizeSubdomain(label)
  if (!sub || label.includes('.')) return { kind: 'invalid' }
  return { kind: 'company', subdomain: sub }
}

/* ------------------------------------------------------------------------ *
 * Lookup: subdomain → org id (short-lived cache; key and value are public facts, never per-user data)
 * ------------------------------------------------------------------------ */

export type CompanyLookup = { status: 'found'; orgId: string } | { status: 'not_found' } | { status: 'error' }

const FOUND_TTL_MS = 60_000
/** Unknown names are remembered too, so a flood of random names costs one DB call per name per 30 s at most. */
const NOT_FOUND_TTL_MS = 30_000
/** A known company stays usable this long through a DB blip (stale-on-error) instead of logging everyone out. */
const STALE_ON_ERROR_MS = 10 * 60_000
const MAX_CACHE_ENTRIES = 500
/** LRU: Map keeps insertion order; every hit re-inserts the key, so the first key is the least recently used. */
const cache = new Map<string, { orgId: string | null; fresh: number; storedAt: number }>()
const inFlight = new Map<string, Promise<CompanyLookup>>()

export function __resetCompanyHostCacheForTests(): void {
  cache.clear()
  inFlight.clear()
}

function remember(sub: string, orgId: string | null, now: number): void {
  cache.delete(sub)
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const lru = cache.keys().next().value
    if (lru === undefined) break
    cache.delete(lru)
  }
  cache.set(sub, { orgId, fresh: now + (orgId ? FOUND_TTL_MS : NOT_FOUND_TTL_MS), storedAt: now })
}

/**
 * Org id for a company address via `public.org_id_for_subdomain` (anon-callable, returns only the id; a
 * subdomain's existence is public anyway — DNS answers for every name). Malformed / reserved names are refused
 * before any DB call. Concurrent lookups of one name share one request. A failed lookup is never cached; it falls
 * back to a known company's last answer (≤ 10 min old) and otherwise reports `error` (→ 503, never 401).
 */
export async function lookupCompanyBySubdomain(subdomain: string): Promise<CompanyLookup> {
  const sub = normalizeSubdomain(subdomain)
  if (!sub) return { status: 'not_found' }

  const now = Date.now()
  const hit = cache.get(sub)
  if (hit && hit.fresh > now) {
    cache.delete(sub)
    cache.set(sub, hit)
    return hit.orgId ? { status: 'found', orgId: hit.orgId } : { status: 'not_found' }
  }

  const pending = inFlight.get(sub)
  if (pending) return pending
  const p = fetchCompany(sub)
    .then((r): CompanyLookup => {
      const at = Date.now()
      if (r.status === 'found') remember(sub, r.orgId, at)
      else if (r.status === 'not_found') remember(sub, null, at)
      else {
        const last = cache.get(sub)
        if (last?.orgId && at - last.storedAt <= STALE_ON_ERROR_MS) return { status: 'found', orgId: last.orgId }
      }
      return r
    })
    .finally(() => inFlight.delete(sub))
  inFlight.set(sub, p)
  return p
}

async function fetchCompany(sub: string): Promise<CompanyLookup> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return { status: 'error' }
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/org_id_for_subdomain`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_subdomain: sub }),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error('company-host: lookup failed', res.status)
      return { status: 'error' }
    }
    const body: unknown = await res.json()
    return typeof body === 'string' && body ? { status: 'found', orgId: body } : { status: 'not_found' }
  } catch (e) {
    console.error('company-host: lookup threw', e instanceof Error ? e.message : e)
    return { status: 'error' }
  }
}

/** Machine code on every response refused because the company lookup failed (503, never 401: clients must not sign out). */
export const COMPANY_LOOKUP_UNAVAILABLE = 'company_lookup_unavailable'

/* ------------------------------------------------------------------------ *
 * Fence
 * ------------------------------------------------------------------------ */

export type CompanyFence =
  | { kind: 'open' }
  | { kind: 'org'; orgId: string; source: 'deployment' | 'host' | 'header' }
  | { kind: 'closed'; reason: 'unknown_company' | 'apex' | 'lookup_error' | 'conflict' }

export async function resolveCompanyFence(input: {
  host: string | null | undefined
  companyCode?: string | null
}): Promise<CompanyFence> {
  const candidates: Array<{ orgId: string; source: 'deployment' | 'host' | 'header' }> = []

  const pinned = deploymentOrgId()
  if (pinned) candidates.push({ orgId: pinned, source: 'deployment' })

  const base = appBaseDomain()
  const host = classifyHost(input.host, base)
  if (host.kind === 'apex') return { kind: 'closed', reason: 'apex' }
  if (host.kind === 'invalid') return { kind: 'closed', reason: 'unknown_company' }
  if (host.kind === 'company') {
    const found = await lookupCompanyBySubdomain(host.subdomain)
    if (found.status === 'error') return { kind: 'closed', reason: 'lookup_error' }
    if (found.status === 'not_found') return { kind: 'closed', reason: 'unknown_company' }
    candidates.push({ orgId: found.orgId, source: 'host' })
  }

  // The company code only ever narrows; it is ignored while routing is off so an app update can ship first.
  const code = input.companyCode?.trim()
  if (code && base) {
    const sub = normalizeSubdomain(code)
    if (!sub) return { kind: 'closed', reason: 'unknown_company' }
    const found = await lookupCompanyBySubdomain(sub)
    if (found.status === 'error') return { kind: 'closed', reason: 'lookup_error' }
    if (found.status === 'not_found') return { kind: 'closed', reason: 'unknown_company' }
    candidates.push({ orgId: found.orgId, source: 'header' })
  }

  if (candidates.length === 0) return { kind: 'open' }
  const first = candidates[0]
  if (candidates.some((c) => c.orgId !== first.orgId)) return { kind: 'closed', reason: 'conflict' }
  return { kind: 'org', orgId: first.orgId, source: first.source }
}

/** May a profile in `orgId` act on this request? */
export function fenceAllowsOrg(fence: CompanyFence, orgId: string | null | undefined): boolean {
  if (fence.kind === 'open') return true
  if (fence.kind === 'closed') return false
  return !!orgId && orgId === fence.orgId
}
