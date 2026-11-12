import { createHash } from 'node:crypto'

/** SHA-256 of the bytes, lowercase hex — the fingerprint stored for every signed PDF and certificate. */
export function sha256Hex(bytes: Buffer | Uint8Array | ArrayBuffer): string {
  const buf = bytes instanceof ArrayBuffer ? Buffer.from(bytes) : Buffer.from(bytes as Uint8Array)
  return createHash('sha256').update(buf).digest('hex')
}
