import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export function randomToken(prefix: string, bytes = 32): string {
  return prefix + randomBytes(bytes).toString('base64url')
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Constant-time string compare (different lengths are simply not equal). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/

export function isValidCodeVerifier(v: unknown): v is string {
  return typeof v === 'string' && VERIFIER.test(v)
}
export function isValidCodeChallenge(v: unknown): v is string {
  return typeof v === 'string' && CHALLENGE.test(v)
}

/** PKCE S256 (RFC 7636): BASE64URL(SHA256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

export function verifyPkce(verifier: unknown, challenge: string): boolean {
  return isValidCodeVerifier(verifier) && safeEqual(pkceChallenge(verifier), challenge)
}

/** Secret for consent tickets: derived from the server's own key, never sent anywhere. */
function consentSecret(): string {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base) throw new Error('consent ticket: server key not configured')
  return createHmac('sha256', base).update('ai-connector-consent-v1').digest('hex')
}

/** Binds an approval to the exact request the person saw, their own account and a 10-minute window. */
export function signConsentTicket(payload: Record<string, string>, userId: string, expiresAtMs: number): string {
  const body = JSON.stringify({ p: payload, u: userId, e: expiresAtMs })
  const b64 = Buffer.from(body).toString('base64url')
  const sig = createHmac('sha256', consentSecret()).update(b64).digest('base64url')
  return `${b64}.${sig}`
}

export function verifyConsentTicket(ticket: unknown, userId: string, now = Date.now()): Record<string, string> | null {
  if (typeof ticket !== 'string') return null
  const [b64, sig] = ticket.split('.')
  if (!b64 || !sig) return null
  const expected = createHmac('sha256', consentSecret()).update(b64).digest('base64url')
  if (!safeEqual(sig, expected)) return null
  try {
    const parsed = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as { p?: Record<string, string>; u?: string; e?: number }
    if (parsed.u !== userId || typeof parsed.e !== 'number' || parsed.e < now || !parsed.p) return null
    return parsed.p
  } catch {
    return null
  }
}

/** Stable hash of tool arguments for the audit log (keys sorted; the arguments themselves are not stored). */
export function hashArgs(args: unknown): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v
  return sha256Hex(JSON.stringify(canon(args ?? null)))
}
