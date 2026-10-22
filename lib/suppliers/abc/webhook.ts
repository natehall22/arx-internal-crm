import { timingSafeEqual } from 'node:crypto'

/** ABC puts the secret from webhook registration in the Authorization header (some setups prefix "Bearer"). Constant-time compare. */
export function secretMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ''))
  const expected = Buffer.from(secret)
  return given.length === expected.length && timingSafeEqual(given, expected)
}
