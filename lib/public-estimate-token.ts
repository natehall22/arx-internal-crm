import { createHmac, timingSafeEqual } from 'crypto'
import {
  PUBLIC_ESTIMATE_TOKEN_TTL_MS,
  getPublicEstimateTokenSecret,
} from '@/lib/public-estimate-config'

/** Signed preview token body — measurement data lives in the server preview store only. */
export type PublicEstimateTokenPayload = {
  jti: string
  iat: number
  exp: number
}

function b64urlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64url')
}

function b64urlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url')
}

function sign(bodyB64: string, secret: string): string {
  return createHmac('sha256', secret).update(bodyB64).digest('base64url')
}

export function createPublicEstimateToken(
  jti: string,
  options?: { ttlMs?: number; now?: number; secret?: string }
): string {
  const now = options?.now ?? Date.now()
  const ttl = options?.ttlMs ?? PUBLIC_ESTIMATE_TOKEN_TTL_MS
  const payload: PublicEstimateTokenPayload = {
    jti,
    iat: now,
    exp: now + ttl,
  }
  const bodyB64 = b64urlEncode(JSON.stringify(payload))
  const sig = sign(bodyB64, options?.secret ?? getPublicEstimateTokenSecret())
  return `${bodyB64}.${sig}`
}

export function verifyPublicEstimateToken(
  token: string,
  options?: { now?: number; secret?: string }
):
  | { ok: true; payload: PublicEstimateTokenPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' } {
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: 'malformed' }
  }
  const [bodyB64, sig] = parts
  let secret: string
  try {
    secret = options?.secret ?? getPublicEstimateTokenSecret()
  } catch {
    return { ok: false, reason: 'bad_signature' }
  }
  const expected = sign(bodyB64, secret)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' }
  }
  let payload: PublicEstimateTokenPayload
  try {
    payload = JSON.parse(b64urlDecode(bodyB64).toString('utf8')) as PublicEstimateTokenPayload
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  const now = options?.now ?? Date.now()
  if (!payload.exp || payload.exp < now) {
    return { ok: false, reason: 'expired' }
  }
  if (typeof payload.jti !== 'string' || payload.jti.length < 8 || payload.jti.length > 64) {
    return { ok: false, reason: 'malformed' }
  }
  return { ok: true, payload }
}

export function applyEstimateRange(
  mid: number,
  band: number
): { low: number; high: number } {
  const low = Math.max(0, Math.round(mid * (1 - band)))
  const high = Math.round(mid * (1 + band))
  return { low, high }
}
