/**
 * Support session cookie + hand-off token (edge + Node, Web Crypto only; no server imports). The ONE place a support
 * session is signed and verified. The cookie is host-only, httpOnly, short-lived and signed with a key derived from the
 * server's service key, so nobody can write one: they can only be issued by `POST /api/support/enter` after the platform-staff
 * and live-grant checks (lib/support/access.ts). Every use is re-checked against the database (lib/auth.ts).
 */
import { fromB64Url, toB64Url } from '@/lib/company-host'

export const SUPPORT_COOKIE = 'arx_support'
/** Never longer than a working day, and never past the grant's own expiry (lib/support/access.ts `sessionExpiry`). */
export const SUPPORT_SESSION_MAX_MS = 8 * 60 * 60 * 1000
/** A hand-off link (staff address → the company's own address) is good for one minute. */
export const SUPPORT_HANDOFF_MAX_MS = 60 * 1000

export type SupportLevel = 'view' | 'full'
export const isSupportLevel = (v: unknown): v is SupportLevel => v === 'view' || v === 'full'

export type SupportSessionPayload = {
  /** 'session' = the cookie; 'handoff' = the one-minute link that sets it on another address. */
  k: 'session' | 'handoff'
  /** staff user id */
  s: string
  /** target company id */
  o: string
  /** acting-as user id */
  a: string
  l: SupportLevel
  /** expiry, ms since epoch */
  exp: number
  /** hand-off only: a random one-time id; the hand-off route records it and refuses a second use. */
  n?: string
}

let keyPromise: Promise<CryptoKey | null> | null = null
let keySource: string | undefined

function supportKey(): Promise<CryptoKey | null> {
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (keyPromise && keySource === service) return keyPromise
  keySource = service
  keyPromise = (async () => {
    if (!service) return null
    const enc = new TextEncoder()
    const base = await crypto.subtle.importKey('raw', enc.encode(service), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const derived = await crypto.subtle.sign('HMAC', base, enc.encode('support-session-v1'))
    return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
  })()
  return keyPromise
}

export async function signSupportToken(payload: SupportSessionPayload): Promise<string | null> {
  const key = await supportKey()
  if (!key) return null
  const body = toB64Url(new TextEncoder().encode(JSON.stringify(payload)))
  const mac = toB64Url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))
  return `${body}.${mac}`
}

/** The payload of a token we signed that has not expired, or null (missing, forged, wrong kind, expired). */
export async function verifySupportToken(value: string | null | undefined, kind: 'session' | 'handoff', now = Date.now()): Promise<SupportSessionPayload | null> {
  if (!value) return null
  const [body, mac, extra] = value.split('.')
  if (!body || !mac || extra !== undefined) return null
  const key = await supportKey()
  if (!key) return null
  try {
    if (!(await crypto.subtle.verify('HMAC', key, fromB64Url(mac), new TextEncoder().encode(body)))) return null
    const p = JSON.parse(new TextDecoder().decode(fromB64Url(body))) as Partial<SupportSessionPayload>
    if (p.k !== kind || typeof p.s !== 'string' || typeof p.o !== 'string' || typeof p.a !== 'string' || !isSupportLevel(p.l)) return null
    if (typeof p.exp !== 'number' || !(p.exp > now)) return null
    if (kind === 'handoff' && (typeof p.n !== 'string' || p.n.length < 16)) return null
    return p as SupportSessionPayload
  } catch {
    return null
  }
}

/** The raw cookie value from a Cookie header / cookie list, without importing anything. */
export function supportCookieFrom(cookies: { getAll: () => Array<{ name: string; value: string }> }): string | null {
  return cookies.getAll().find((c) => c.name === SUPPORT_COOKIE)?.value ?? null
}

export const SUPPORT_REQUEST_HEADER = 'x-support-request'
/** Request methods that cannot change anything. */
export const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])
/** The two POSTs a view-only session must still be able to make. */
export const SUPPORT_ALWAYS_ALLOWED_PATHS: ReadonlySet<string> = new Set(['/api/support/exit', '/api/support/upgrade'])

/**
 * Doors a support session may never use, in ANY mode and with ANY method (several of them write on a GET): connecting an outside
 * account (Google, QuickBooks) or approving an AI app would leave a credential behind that outlives the grant.
 */
export const SUPPORT_NEVER_PATHS: readonly string[] = ['/api/auth/google', '/api/integrations/quickbooks', '/api/oauth', '/oauth']
/**
 * Writes refused even in full mode: the company's own support settings, and anything that creates or changes a login or a
 * long-lived key (users + passwords, AI connector keys, push devices), so nobody can keep access after the grant ends.
 */
export const SUPPORT_NO_WRITE_PATHS: readonly string[] = ['/api/admin/support-access', '/api/admin/users', '/api/admin/ai-connector', '/api/mobile/push-token']

const underPrefix = (path: string, prefixes: readonly string[]) => prefixes.some((p) => path === p || path.startsWith(`${p}/`))

/**
 * The ONE rule for what a support session may do on a request (middleware answers it first; requireAuthApi re-asks it from the
 * header middleware set). null = allowed; otherwise the refusal message. An unknown method is a write (fail closed).
 */
export function supportRequestRefusal(method: string, path: string, level: SupportLevel): string | null {
  if (underPrefix(path, SUPPORT_NEVER_PATHS)) return 'Not available in a support session'
  if (method && SAFE_METHODS.has(method.toUpperCase())) return null
  if (SUPPORT_ALWAYS_ALLOWED_PATHS.has(path)) return null
  if (level !== 'full') return 'Support view mode'
  if (underPrefix(path, SUPPORT_NO_WRITE_PATHS)) return 'Not available in a support session'
  return null
}
