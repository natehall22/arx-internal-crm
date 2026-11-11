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
 *   (APP_BASE_DOMAIN unset, the legacy hosting address, localhost) = unfenced, exactly as before.
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
 * lib/app-url.ts `getAppUrl(org)` calls this when the org it is handed carries `subdomain`: server code that loads an
 * org passes `getAppUrl({ subdomain: org.subdomain })` — the one place the stored address becomes a link.
 */
export function companyAppUrl(subdomain: string | null | undefined, baseDomain: string | null = appBaseDomain()): string | null {
  const sub = normalizeSubdomain(subdomain)
  return sub && baseDomain ? `https://${sub}.${baseDomain}` : null
}

export type HostKind =
  | { kind: 'off' } // APP_BASE_DOMAIN unset: routing disabled
  | { kind: 'legacy' } // any other address (legacy hosting address, localhost, previews): unfenced during the overlap
  | { kind: 'apex' } // the bare product domain or www.: no company
  | { kind: 'company'; subdomain: string }
  | { kind: 'invalid' } // under the base domain but not a usable company name (nested, reserved, malformed)

/** The host this request arrived on (the Host header; never a forwarded one) — the one source for connect flows' return host. */
export function requestHost(request: Request): string {
  return request.headers.get('host') ?? new URL(request.url).host
}

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
/**
 * Two separate LRU caches (Map insertion order; a hit re-inserts the key, so the first key is least recently used):
 * real companies and unknown names never share capacity, so a flood of random names can't evict a real company.
 */
const MAX_FOUND_ENTRIES = 500
const MAX_NOT_FOUND_ENTRIES = 1000
type CacheEntry = { orgId: string | null; fresh: number; storedAt: number }
const foundCache = new Map<string, CacheEntry>()
const notFoundCache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<CompanyLookup>>()

export function __resetCompanyHostCacheForTests(): void {
  foundCache.clear()
  notFoundCache.clear()
  inFlight.clear()
  aliasFound.clear()
  aliasUnknown.clear()
  aliasInFlight.clear()
}

function putLru(map: Map<string, CacheEntry>, max: number, key: string, entry: CacheEntry): void {
  map.delete(key)
  while (map.size >= max) {
    const lru = map.keys().next().value
    if (lru === undefined) break
    map.delete(lru)
  }
  map.set(key, entry)
}

function remember(sub: string, orgId: string | null, now: number): void {
  if (orgId) {
    notFoundCache.delete(sub)
    putLru(foundCache, MAX_FOUND_ENTRIES, sub, { orgId, fresh: now + FOUND_TTL_MS, storedAt: now })
  } else {
    // A company that was deleted / renamed stops resolving; keep its stale entry out of the error fallback.
    foundCache.delete(sub)
    putLru(notFoundCache, MAX_NOT_FOUND_ENTRIES, sub, { orgId: null, fresh: now + NOT_FOUND_TTL_MS, storedAt: now })
  }
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
  const known = foundCache.get(sub)
  if (known && known.fresh > now) {
    putLru(foundCache, MAX_FOUND_ENTRIES, sub, known)
    return { status: 'found', orgId: known.orgId as string }
  }
  const unknown = notFoundCache.get(sub)
  if (unknown && unknown.fresh > now) return { status: 'not_found' }

  const pending = inFlight.get(sub)
  if (pending) return pending
  const p = fetchCompany(sub)
    .then((r): CompanyLookup => {
      const at = Date.now()
      if (r.status === 'found') remember(sub, r.orgId, at)
      else if (r.status === 'not_found') remember(sub, null, at)
      else {
        const last = foundCache.get(sub)
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

/* ------------------------------------------------------------------------ *
 * Retired names (renamed companies): old address → current web name
 * ------------------------------------------------------------------------ */

export type AliasLookup = { status: 'moved'; subdomain: string } | { status: 'not_found' } | { status: 'error' }

type AliasEntry = { current: string | null; fresh: number }
const aliasFound = new Map<string, AliasEntry>()
const aliasUnknown = new Map<string, AliasEntry>()
const aliasInFlight = new Map<string, Promise<AliasLookup>>()

function putAlias(map: Map<string, AliasEntry>, max: number, key: string, entry: AliasEntry): void {
  map.delete(key)
  while (map.size >= max) {
    const lru = map.keys().next().value
    if (lru === undefined) break
    map.delete(lru)
  }
  map.set(key, entry)
}

/**
 * A name that is no company's CURRENT address may be one a company used before a rename
 * (`org_subdomain_aliases`, migration 202611100095). Middleware asks this only after `lookupCompanyBySubdomain` said
 * not_found, and answers `moved` with a 308 to the same path on the current address — so links already sent on the
 * old address (/r, /crew, signing, reviews, staff emails) keep working while new links use the current name. Never
 * used for sign-in: an alias host is not a company host. Function not deployed yet (PGRST202/404) = not_found.
 * Same caching shape as the company lookup (found 60 s / unknown 30 s, separate LRUs, errors never cached).
 */
export async function lookupSubdomainAlias(subdomain: string): Promise<AliasLookup> {
  const sub = normalizeSubdomain(subdomain)
  if (!sub) return { status: 'not_found' }
  const now = Date.now()
  const hit = aliasFound.get(sub) ?? aliasUnknown.get(sub)
  if (hit && hit.fresh > now) return hit.current ? { status: 'moved', subdomain: hit.current } : { status: 'not_found' }
  const pending = aliasInFlight.get(sub)
  if (pending) return pending
  const p = fetchAlias(sub)
    .then((r): AliasLookup => {
      const at = Date.now()
      if (r.status === 'moved') {
        aliasUnknown.delete(sub)
        putAlias(aliasFound, MAX_FOUND_ENTRIES, sub, { current: r.subdomain, fresh: at + FOUND_TTL_MS })
      } else if (r.status === 'not_found') {
        aliasFound.delete(sub)
        putAlias(aliasUnknown, MAX_NOT_FOUND_ENTRIES, sub, { current: null, fresh: at + NOT_FOUND_TTL_MS })
      }
      return r
    })
    .finally(() => aliasInFlight.delete(sub))
  aliasInFlight.set(sub, p)
  return p
}

async function fetchAlias(sub: string): Promise<AliasLookup> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return { status: 'error' }
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/company_subdomain_for_alias`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_subdomain: sub }),
      cache: 'no-store',
    })
    if (res.status === 404) return { status: 'not_found' } // migration 202611100095 not applied: no aliases exist
    if (!res.ok) {
      console.error('company-host: alias lookup failed', res.status)
      return { status: 'error' }
    }
    const body: unknown = await res.json()
    const current = typeof body === 'string' ? normalizeSubdomain(body) : null
    return current && current !== sub ? { status: 'moved', subdomain: current } : { status: 'not_found' }
  } catch (e) {
    console.error('company-host: alias lookup threw', e instanceof Error ? e.message : e)
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

/** Lookups middleware already did for this request (see `signResolvedLookups`); skip the DB for these. */
export type ResolvedLookups = { host?: CompanyLookup; code?: CompanyLookup }

export async function resolveCompanyFence(input: {
  host: string | null | undefined
  companyCode?: string | null
  resolved?: ResolvedLookups | null
}): Promise<CompanyFence> {
  const candidates: Array<{ orgId: string; source: 'deployment' | 'host' | 'header' }> = []

  const pinned = deploymentOrgId()
  if (pinned) candidates.push({ orgId: pinned, source: 'deployment' })

  const base = appBaseDomain()
  const host = classifyHost(input.host, base)
  if (host.kind === 'apex') return { kind: 'closed', reason: 'apex' }
  if (host.kind === 'invalid') return { kind: 'closed', reason: 'unknown_company' }
  if (host.kind === 'company') {
    const found = input.resolved?.host ?? (await lookupCompanyBySubdomain(host.subdomain))
    if (found.status === 'error') return { kind: 'closed', reason: 'lookup_error' }
    if (found.status === 'not_found') return { kind: 'closed', reason: 'unknown_company' }
    candidates.push({ orgId: found.orgId, source: 'host' })
  }

  // The company code only ever narrows; it is ignored while routing is off so an app update can ship first.
  const code = input.companyCode?.trim()
  if (code && base) {
    const sub = normalizeSubdomain(code)
    if (!sub) return { kind: 'closed', reason: 'unknown_company' }
    const found = input.resolved?.code ?? (await lookupCompanyBySubdomain(sub))
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

/* ------------------------------------------------------------------------ *
 * Middleware → route hand-off (so a route never repeats a lookup middleware already did)
 *
 * Middleware runs on every page and /api request (matcher), strips any client-sent RESOLVED_LOOKUPS_HEADER, does
 * the host / company-code lookups once, answers a failed one itself (503 company_lookup_unavailable) and passes the
 * results on in this header, HMAC-signed and bound to the exact host + code of the request. resolveAuth then uses
 * them instead of looking up again — so a lookup failure can only ever surface as middleware's 503, never as a
 * route's catch-all 401. A missing / forged / mismatched header is ignored (the route does its own lookup).
 * Web Crypto only (edge + Node).
 * ------------------------------------------------------------------------ */

export const RESOLVED_LOOKUPS_HEADER = 'x-company-resolved'

type ResolvedWire = { h: string; c: string | null; ho?: CompanyLookup; co?: CompanyLookup }

let routingKey: Promise<CryptoKey | null> | null = null
let routingKeySource: string | undefined

function routingHmacKey(): Promise<CryptoKey | null> {
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (routingKey && routingKeySource === service) return routingKey
  routingKeySource = service
  routingKey = (async () => {
    if (!service) return null
    const enc = new TextEncoder()
    const base = await crypto.subtle.importKey('raw', enc.encode(service), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const derived = await crypto.subtle.sign('HMAC', base, enc.encode('company-routing-v1'))
    return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
  })()
  return routingKey
}

function toB64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64Url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function normCode(code: string | null | undefined): string | null {
  return code?.trim().toLowerCase() || null
}

/** Signed header value carrying middleware's lookups for this exact host + code; null when no key is configured. */
export async function signResolvedLookups(
  host: string | null | undefined,
  companyCode: string | null | undefined,
  resolved: ResolvedLookups
): Promise<string | null> {
  const key = await routingHmacKey()
  if (!key) return null
  const wire: ResolvedWire = { h: hostnameFromHeader(host), c: normCode(companyCode), ho: resolved.host, co: resolved.code }
  const body = toB64Url(new TextEncoder().encode(JSON.stringify(wire)))
  const mac = toB64Url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))
  return `${body}.${mac}`
}

/** The lookups from a header middleware signed for THIS host + code, or null (missing, forged or for another request). */
export async function verifyResolvedLookups(
  value: string | null | undefined,
  host: string | null | undefined,
  companyCode: string | null | undefined
): Promise<ResolvedLookups | null> {
  if (!value) return null
  const [body, mac, extra] = value.split('.')
  if (!body || !mac || extra !== undefined) return null
  const key = await routingHmacKey()
  if (!key) return null
  try {
    const ok = await crypto.subtle.verify('HMAC', key, fromB64Url(mac), new TextEncoder().encode(body))
    if (!ok) return null
    const wire = JSON.parse(new TextDecoder().decode(fromB64Url(body))) as ResolvedWire
    if (wire.h !== hostnameFromHeader(host) || wire.c !== normCode(companyCode)) return null
    return { host: wire.ho, code: wire.co }
  } catch {
    return null
  }
}
