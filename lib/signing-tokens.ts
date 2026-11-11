/**
 * Signing-link tokens for contracts and change orders (server only).
 *
 * A NEW token is never stored as it is sent: the row keeps its SHA-256 (`signing_token_hash`, what a link is looked up by)
 * and an encrypted copy (`signing_token_enc`, so the office can copy the link again without re-issuing it). Someone who can
 * read the table sees neither a usable link nor a way to make one. Rows made before this keep their plaintext
 * `signing_token`, and `findBySigningToken` still accepts it, so no link already sent stops working.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import { isPlausibleSigningToken, type SignedDocKind } from '@/lib/files/files-object'

export type SigningDocKind = SignedDocKind

export const SIGNING_TABLES: Record<SigningDocKind, 'order_form_contracts' | 'job_change_orders'> = {
  contract: 'order_form_contracts',
  'change-order': 'job_change_orders',
}

/** Same shapes as before (the pages and download links check them): a UUID for contracts, 32 random bytes as hex for change orders. */
export function newSigningToken(kind: SigningDocKind): string {
  return kind === 'contract' ? randomUUID() : randomBytes(32).toString('hex')
}

export function hashSigningToken(token: string): string {
  return createHash('sha256').update(token.trim().toLowerCase()).digest('hex')
}

function sealKey(): Buffer | null {
  const secret = process.env.SIGNING_TOKEN_SECRET || process.env.CUSTOMER_MESSAGE_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  return secret ? createHash('sha256').update(`signing-token-seal:${secret}`).digest() : null
}

/** AES-256-GCM, `v1.<iv>.<tag>.<ciphertext>` (base64url). Null when no secret is configured (the link then can't be re-copied). */
export function sealSigningToken(token: string): string | null {
  const key = sealKey()
  if (!key) return null
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.')
}

export function openSigningToken(sealed: string | null | undefined): string | null {
  const key = sealKey()
  const parts = String(sealed ?? '').split('.')
  if (!key || parts.length !== 4 || parts[0] !== 'v1') return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64url'))
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

/** A fresh token and the columns to store it by. `signing_token` is deliberately left null. */
export function newSigningTokenColumns(kind: SigningDocKind): {
  token: string
  columns: { signing_token: null; signing_token_hash: string; signing_token_enc: string | null }
} {
  const token = newSigningToken(kind)
  return { token, columns: { signing_token: null, signing_token_hash: hashSigningToken(token), signing_token_enc: sealSigningToken(token) } }
}

/** The token to put in a link for a stored row: the old plaintext one, else the decrypted new one. */
export function signingTokenOf(row: { signing_token?: string | null; signing_token_enc?: string | null } | null | undefined): string | null {
  if (!row) return null
  return row.signing_token || openSigningToken(row.signing_token_enc)
}

/**
 * The row a link's token belongs to. New tokens by hash first; then a still-valid plaintext token from before hashing.
 * A token of the wrong shape finds nothing without a query (a non-UUID against the contracts' uuid column is a database error).
 */
export async function findBySigningToken(
  admin: SupabaseClient,
  kind: SigningDocKind,
  token: unknown,
  columns = '*'
): Promise<Record<string, any> | null> {
  const t = typeof token === 'string' ? token.trim() : ''
  if (!t || !isPlausibleSigningToken(kind, t)) return null
  const table = SIGNING_TABLES[kind]
  const { data: byHash } = await admin.from(table).select(columns).eq('signing_token_hash', hashSigningToken(t)).maybeSingle()
  if (byHash) return byHash as unknown as Record<string, any>
  const { data: legacy } = await admin.from(table).select(columns).eq('signing_token', t).maybeSingle()
  return (legacy as unknown as Record<string, any>) ?? null
}
