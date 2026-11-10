/**
 * The ONE answer to "what is this app's public address": customer links (signing, reports, reviews), staff email links,
 * crew photo links, calendar invites, the Google OAuth callback. Client-safe: NEXT_PUBLIC_ values are inlined into the
 * browser bundle at build time.
 *
 * Order: the company's own address when the caller has one (`org.appUrl`, e.g. https://<company>.<product domain>), else
 * the deployment's NEXT_PUBLIC_APP_URL. Nothing stores a per-company address yet: when the one-app/many-companies routing
 * lands, its reader fills `appUrl` on the org object passed here and every caller already threads it through.
 *
 * There is deliberately NO fallback host. A missing value used to send customers and staff to the old hosting address
 * (or to "undefined/contracts/…"); now it fails loudly instead. Server code that needs a link calls `getAppUrl()` and lets
 * it throw (inside its own try/catch where the link is only part of the work). Code where the link is optional and the
 * rest of the request must still finish calls `tryGetAppUrl(context)`, which logs and returns null.
 *
 * Never type a host literal anywhere else: the hardcode ratchet's `host` group blocks new ones.
 */

/** Anything that may carry a company's own app address (an org row, or a caller handed an address explicitly). */
export type AppUrlOrg = { appUrl?: string | null } | null | undefined

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
  const own = org?.appUrl?.trim()
  const source = own ? "the company's app address" : 'NEXT_PUBLIC_APP_URL'
  const url = parseAppUrl(own || process.env.NEXT_PUBLIC_APP_URL)
  if (url) return url
  const message = `App address is not configured: ${source} must be a plain https origin (for example https://crm.example.com). No link was built.`
  console.error(`[app-url] ${message}`)
  throw new AppUrlNotConfiguredError(message)
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

/** Host (with port) of an app address, default the deployment's; null when not configured. Never throws. */
export function configuredAppHost(raw: string | null | undefined = process.env.NEXT_PUBLIC_APP_URL): string | null {
  const url = parseAppUrl(raw)
  return url ? new URL(url).host : null
}
