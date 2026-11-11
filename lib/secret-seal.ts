/**
 * The ONE AES-256-GCM seal for secrets stored at rest or parked briefly (server-only). Format: `iv.ciphertext.tag`, each
 * base64url. Callers own where the 32-byte key comes from:
 *  - OAuth one-time codes (lib/google-oauth-state.ts): a key derived from OAUTH_STATE_SECRET / the service key;
 *  - integration tokens (QuickBooks, lib/quickbooks/connection.ts): `integrationSecretKey(label)`, derived from env
 *    SECRETS_ENCRYPTION_KEY ONLY. There is deliberately no fallback: set it before the first connect and never change it
 *    (a changed key makes stored tokens unreadable → the connection shows "needs reconnect").
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto'

const b64 = (b: Buffer) => b.toString('base64url')

/** `aad` binds the ciphertext to its owner (e.g. `<org id>:<column>`): a sealed value copied to another row/company won't open. */
export function sealWithKey(key: Buffer, plain: string, aad?: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  if (aad) c.setAAD(Buffer.from(aad))
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return [b64(iv), b64(ct), b64(c.getAuthTag())].join('.')
}

/** Null on any failure (wrong key, tampered, malformed) — never throws. */
export function openWithKey(key: Buffer, sealed: string, aad?: string): string | null {
  try {
    const [iv, ct, tag] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'))
    const d = createDecipheriv('aes-256-gcm', key, iv)
    if (aad) d.setAAD(Buffer.from(aad))
    d.setAuthTag(tag)
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8')
  } catch {
    return null
  }
}

/** Key for integration secrets at rest: HMAC(SECRETS_ENCRYPTION_KEY, label). Null when the env is missing or too short. */
export function integrationSecretKey(label: string): Buffer | null {
  const root = process.env.SECRETS_ENCRYPTION_KEY?.trim()
  if (!root || root.length < 32) return null
  return createHmac('sha256', root).update(`integration-secret:${label}`).digest()
}
