/**
 * Customer portal tokens + identifiers — pure, no I/O. A sign-in link and a session are random 256-bit values; only the
 * SHA-256 is stored (portal_login_tokens / portal_sessions), so a database read never yields a working link or session.
 */
import { createHash, randomBytes } from 'crypto'

/** `__Host-` in production: the browser then only accepts it Secure, on this exact host, path /, no Domain. (Plain over http in development.) */
export const PORTAL_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-portal_session' : 'portal_session'
/** A sign-in link works once, for this long. */
export const LOGIN_LINK_MINUTES = 20
export const SESSION_DAYS = 14

export function newPortalToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashPortalToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** URL-safe and token-sized (ours are 43 chars). Anything else is refused before a database read. */
export function isWellFormedPortalToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(token)
}

/** Keyed hash of an address / identifier for the audit log and rate limits (never the raw value). */
export function opaqueKey(orgId: string, value: string): string {
  return createHash('sha256').update(`${orgId}|${value}`, 'utf8').digest('hex').slice(0, 32)
}

/** The customer's email as the portal tells it apart: a session / link is tied to this, so changing the address on file ends them. */
export function customerEmailKey(orgId: string, email: string | null | undefined): string {
  return opaqueKey(orgId, `email:${(email ?? '').trim().toLowerCase()}`)
}

export type PortalIdentifier = { kind: 'email'; email: string } | { kind: 'phone'; phone10: string }

/** What the customer typed → an email or a 10-digit phone, or null when it is neither. */
export function parsePortalIdentifier(raw: unknown): PortalIdentifier | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (!t || t.length > 200) return null
  if (t.includes('@')) {
    const email = t.toLowerCase()
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { kind: 'email', email } : null
  }
  const digits = t.replace(/\D/g, '')
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  return ten.length === 10 ? { kind: 'phone', phone10: ten } : null
}

export function sessionExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_DAYS * 86_400_000)
}
export function loginLinkExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + LOGIN_LINK_MINUTES * 60_000)
}
