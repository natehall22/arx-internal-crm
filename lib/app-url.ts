/**
 * The ONE answer to "what is this app's public address": customer links (signing, reports, reviews), staff email links,
 * crew photo links, calendar invites, the Google OAuth callback. Client-safe: NEXT_PUBLIC_ values are inlined into the
 * browser bundle at build time.
 *
 * Order: an explicit company address (`org.appUrl`), else the company's own address from its stored web name
 * (`org.subdomain` -> https://<subdomain>.<APP_BASE_DOMAIN> via companyAppUrl in lib/company-host.ts; null while host
 * routing is off or on the client, where APP_BASE_DOMAIN is not set), else the deployment's NEXT_PUBLIC_APP_URL.
 *
 * There is deliberately NO fallback host. A missing value used to send customers and staff to the old hosting address
 * (or to "undefined/contracts/…"); now it fails loudly instead. Server code that needs a link calls `getAppUrl()` and lets
 * it throw (inside its own try/catch where the link is only part of the work). Code where the link is optional and the
 * rest of the request must still finish calls `tryGetAppUrl(context)`, which logs and returns null.
 *
 * Never type a host literal anywhere else: the hardcode ratchet's `host` group blocks new ones.
 */
import { appBaseDomain, classifyHost, companyAppUrl, hostnameFromHeader } from '@/lib/company-host'

/** Anything that may carry a company's own app address (an org row with `subdomain`, or an explicit address). */
export type AppUrlOrg = { appUrl?: string | null; subdomain?: string | null } | null | undefined

export class AppUrlNotConfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppUrlNotConfiguredError'
  }
}

/**
 * Normalize an app address to its origin (`https://host[:port]`, no trailing slash). Null when it is empty or not a plain
 * http(s) origin: a value with a path, query or hash is rejected rather than silently trimmed, so a typo shows up.
 */
export function parseAppUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash || url.username || url.password) return null
  return url.origin
}

/**
 * The app's public origin for `org` (its own address when set, else NEXT_PUBLIC_APP_URL).
 * Throws AppUrlNotConfiguredError (and logs) when the address that applies is missing or malformed. A company address
 * that is set but malformed throws too: falling back would quietly send that company's customers to another address.
 */
export function getAppUrl(org?: AppUrlOrg): string {
  const own = org?.appUrl?.trim() || companyAppUrl(org?.subdomain) || ''
  const source = own ? "the company's app address" : 'NEXT_PUBLIC_APP_URL'
  const url = parseAppUrl(own || process.env.NEXT_PUBLIC_APP_URL)
  if (url) {
    if (!own && org && 'subdomain' in org) guardCompanyWithoutAddress(url)
    return url
  }
  const message = `App address is not configured: ${source} must be a plain https origin (for example https://crm.example.com). No link was built.`
  console.error(`[app-url] ${message}`)
  throw new AppUrlNotConfiguredError(message)
}

const NO_SUBDOMAIN_WARN_EVERY_MS = 60_000
let lastNoSubdomainWarn = -Infinity

export function __resetAppUrlWarningsForTests(): void {
  lastNoSubdomainWarn = -Infinity
}

/**
 * Cutover guard. Host routing is on (APP_BASE_DOMAIN set) but the company this link is for has no web name yet: it
 * falls back to NEXT_PUBLIC_APP_URL — the legacy shared address, which still serves every company — and says so in
 * the log. If that address is itself under the base domain (the bare product domain, or ANOTHER company's address),
 * a link there would land on a page that refuses this company, so no link is built at all (AppUrlNotConfiguredError).
 * Every active company needs `orgs.subdomain` before APP_BASE_DOMAIN is set (docs/domain-cutover.md).
 */
function guardCompanyWithoutAddress(fallback: string): void {
  const base = appBaseDomain()
  if (!base) return
  const kind = classifyHost(new URL(fallback).host, base).kind
  if (kind !== 'legacy') {
    const message = `App address is not configured: this company has no web name (orgs.subdomain) and NEXT_PUBLIC_APP_URL is under APP_BASE_DOMAIN (${kind}), where its links would be refused. No link was built.`
    console.error(`[app-url] ${message}`)
    throw new AppUrlNotConfiguredError(message)
  }
  const now = Date.now()
  if (now - lastNoSubdomainWarn >= NO_SUBDOMAIN_WARN_EVERY_MS) {
    lastNoSubdomainWarn = now
    console.warn('[app-url] host routing is on but a company has no web name (orgs.subdomain); its links use the legacy NEXT_PUBLIC_APP_URL address')
  }
}

/** For a link that is only part of the work: logs where it was left out and returns null instead of throwing. */
export function tryGetAppUrl(context: string, org?: AppUrlOrg): string | null {
  try {
    return getAppUrl(org)
  } catch {
    console.error(`[app-url] ${context}: link left out because the app address is not configured`)
    return null
  }
}

/**
 * Browser copy-link buttons: the origin a link for a record on screen should use. A signed-in user only ever sees their
 * own company's records, so when the page is open on a company address (`<sub>.<host of NEXT_PUBLIC_APP_URL>`, i.e.
 * the shared app address is the base domain) that address is the record's company's address — use it. Anywhere else
 * (the shared/legacy address, previews, localhost) keep today's rule: NEXT_PUBLIC_APP_URL, else the current origin.
 */
export function clientLinkBase(
  context = 'copied link',
  location: { host: string; origin: string } | null = typeof window !== 'undefined' ? window.location : null
): string {
  const configured = configuredAppHost()
  if (location && configured && classifyHost(location.host, hostnameFromHeader(configured)).kind === 'company') {
    return location.origin
  }
  return tryGetAppUrl(context) ?? location?.origin ?? ''
}

/** Host (with port) of an app address, default the deployment's; null when not configured. Never throws. */
export function configuredAppHost(raw: string | null | undefined = process.env.NEXT_PUBLIC_APP_URL): string | null {
  const url = parseAppUrl(raw)
  return url ? new URL(url).host : null
}
