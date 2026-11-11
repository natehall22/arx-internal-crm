/**
 * AI apps (OAuth clients). Two ways in, both ending as a row in `ai_oauth_clients`:
 *  - Dynamic Client Registration (RFC 7591) — what Claude uses;
 *  - Client ID Metadata Documents — the client_id is an https address we fetch (guarded against server-side request forgery).
 * Where an app may send the person back (redirect URI) is a short allow-list: the verified Claude / ChatGPT callbacks plus
 * addresses the company owner adds. An app that names any other address is refused at registration and again at sign-in.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import type { SupabaseClient } from '@supabase/supabase-js'

import { BUILTIN_REDIRECT_URIS, CHATGPT_CALLBACK_ID, CLIENT_PREFIX, REDIRECT_APP_LABELS } from '@/lib/ai-connector/config'
import { randomToken } from '@/lib/ai-connector/crypto'

export type AiClient = { client_id: string; client_name: string | null; redirect_uris: string[]; kind: 'dcr' | 'cimd'; metadata_url: string | null }

/** Parses a redirect address the way it must be stored: https, no fragment, no credentials. Null = unusable. */
export function normalizeRedirectUri(raw: unknown, allowLoopbackHttp = false): string | null {
  if (typeof raw !== 'string' || raw.length > 512) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.hash || u.username || u.password) return null
  const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]'
  if (u.protocol === 'https:') return u.href === raw ? raw : u.href
  if (u.protocol === 'http:' && loopback && allowLoopbackHttp) return u.href
  return null
}

/** Exact match only — no prefixes, no wildcards, no case games. */
export function isAllowedRedirectUri(uri: string, extra: readonly string[] = []): boolean {
  return BUILTIN_REDIRECT_URIS.includes(uri) || CHATGPT_CALLBACK_ID.test(uri) || extra.includes(uri)
}

export function appLabelForRedirect(uris: readonly string[]): string | null {
  for (const r of REDIRECT_APP_LABELS) if (uris.every((u) => r.test(u))) return r.label
  return null
}

/** What an owner may add: validated, https (or localhost for a developer's own machine), at most 10. */
export function parseExtraRedirectUris(raw: unknown): { uris: string[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'Send a list of addresses' }
  if (raw.length > 10) return { error: 'At most 10 addresses' }
  const out: string[] = []
  for (const r of raw) {
    const n = normalizeRedirectUri(typeof r === 'string' ? r.trim() : r, true)
    if (!n) return { error: `Not a usable address: ${String(r).slice(0, 80)}` }
    if (!out.includes(n)) out.push(n)
  }
  return { uris: out }
}

export async function loadExtraRedirectUris(admin: SupabaseClient, orgId: string | null | undefined): Promise<string[]> {
  if (!orgId) return []
  const { data } = await admin.from('orgs').select('uris:settings->aiConnector->redirectUris').eq('id', orgId).maybeSingle()
  const raw = (data as { uris?: unknown } | null)?.uris
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string' && normalizeRedirectUri(x, true) !== null)
}

type Registration = { client_name: string | null; redirect_uris: string[] }

/** RFC 7591 request body → what we store, or the RFC error to answer. */
export function validateRegistration(body: unknown, extra: readonly string[]): { ok: true; value: Registration } | { ok: false; error: 'invalid_redirect_uri' | 'invalid_client_metadata'; description: string } {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  if (!b) return { ok: false, error: 'invalid_client_metadata', description: 'Send a JSON object' }
  const uris = b.redirect_uris
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 5) return { ok: false, error: 'invalid_redirect_uri', description: 'redirect_uris must list 1 to 5 addresses' }
  const clean: string[] = []
  for (const u of uris) {
    const n = normalizeRedirectUri(u, true)
    if (!n || !isAllowedRedirectUri(n, extra)) return { ok: false, error: 'invalid_redirect_uri', description: 'That redirect address is not allowed for this company' }
    if (!clean.includes(n)) clean.push(n)
  }
  const grants = b.grant_types
  if (grants !== undefined && (!Array.isArray(grants) || !grants.every((g) => g === 'authorization_code' || g === 'refresh_token'))) {
    return { ok: false, error: 'invalid_client_metadata', description: 'Only authorization_code and refresh_token grants are supported' }
  }
  const types = b.response_types
  if (types !== undefined && (!Array.isArray(types) || !types.every((t) => t === 'code'))) {
    return { ok: false, error: 'invalid_client_metadata', description: 'Only response_type code is supported' }
  }
  const name = typeof b.client_name === 'string' ? b.client_name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80) : ''
  return { ok: true, value: { client_name: name || null, redirect_uris: clean } }
}

export async function registerClient(admin: SupabaseClient, reg: Registration): Promise<AiClient> {
  const client: AiClient = { client_id: randomToken(CLIENT_PREFIX, 16), client_name: reg.client_name, redirect_uris: reg.redirect_uris, kind: 'dcr', metadata_url: null }
  const { error } = await admin.from('ai_oauth_clients').insert(client)
  if (error) throw new Error(`register client: ${error.message}`)
  return client
}

/* ---- Client ID Metadata Documents ------------------------------------------------------------------------------- */

const PRIVATE_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^192\.0\.0\./, /^192\.0\.2\./, /^198\.1[89]\./, /^198\.51\.100\./, /^203\.0\.113\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^2(2[4-9]|[3-5]\d)\./]
export function isPublicIp(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) return !PRIVATE_V4.some((r) => r.test(ip))
  if (v === 6) {
    const l = ip.toLowerCase()
    if (l === '::' || l === '::1' || l.startsWith('fe8') || l.startsWith('fe9') || l.startsWith('fea') || l.startsWith('feb') || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('ff')) return false
    const mapped = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    return mapped ? isPublicIp(mapped[1]) : true
  }
  return false
}

export type MetadataFetcher = (url: string) => Promise<{ status: number; body: string } | null>

/** The real fetcher: https only, port 443, public addresses only (checked before connecting), 5 s, 5 KB, no redirects. */
export const guardedFetchMetadata: MetadataFetcher = async (url) => {
  const u = new URL(url)
  if (u.protocol !== 'https:' || (u.port && u.port !== '443') || u.username || u.password) return null
  if (isIP(u.hostname) || u.hostname === 'localhost' || u.hostname.endsWith('.local') || u.hostname.endsWith('.internal') || !u.hostname.includes('.')) return null
  const addrs = await lookup(u.hostname, { all: true }).catch(() => [])
  if (addrs.length === 0 || !addrs.every((a) => isPublicIp(a.address))) return null
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 5000)
  try {
    const res = await fetch(url, { redirect: 'error', signal: ctl.signal, headers: { accept: 'application/json' } })
    const reader = res.body?.getReader()
    if (!reader) return { status: res.status, body: '' }
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 5120) {
        ctl.abort()
        return null
      }
      chunks.push(value)
    }
    return { status: res.status, body: Buffer.concat(chunks).toString('utf8') }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function isMetadataClientId(clientId: string): boolean {
  if (!clientId.startsWith('https://') || clientId.length > 512) return false
  try {
    const u = new URL(clientId)
    return u.pathname.length > 1 && !u.hash && !u.username && !u.password
  } catch {
    return false
  }
}

/** Fetch + validate a metadata document. The document's own client_id must equal the address it was fetched from. */
export async function fetchClientMetadata(clientId: string, extra: readonly string[], fetcher: MetadataFetcher = guardedFetchMetadata): Promise<AiClient | null> {
  if (!isMetadataClientId(clientId)) return null
  const res = await fetcher(clientId)
  if (!res || res.status !== 200) return null
  let doc: Record<string, unknown>
  try {
    doc = JSON.parse(res.body) as Record<string, unknown>
  } catch {
    return null
  }
  if (!doc || doc.client_id !== clientId) return null
  if (doc.token_endpoint_auth_method !== undefined && doc.token_endpoint_auth_method !== 'none') return null
  const reg = validateRegistration({ redirect_uris: doc.redirect_uris, client_name: doc.client_name, grant_types: doc.grant_types, response_types: doc.response_types }, extra)
  if (!reg.ok) return null
  return { client_id: clientId, client_name: reg.value.client_name, redirect_uris: reg.value.redirect_uris, kind: 'cimd', metadata_url: clientId }
}

/** The client for a sign-in / token request. A metadata-document client is refreshed when we last saw it over an hour ago. */
export async function loadClient(admin: SupabaseClient, clientId: unknown, extra: readonly string[], fetcher?: MetadataFetcher): Promise<AiClient | null> {
  if (typeof clientId !== 'string' || !clientId || clientId.length > 512) return null
  const { data } = await admin.from('ai_oauth_clients').select('client_id, client_name, redirect_uris, kind, metadata_url, last_seen_at').eq('client_id', clientId).maybeSingle()
  const row = data as (AiClient & { last_seen_at: string }) | null
  if (row && (row.kind === 'dcr' || Date.now() - new Date(row.last_seen_at).getTime() < 3_600_000)) return row
  if (!isMetadataClientId(clientId)) return null
  const fresh = await fetchClientMetadata(clientId, extra, fetcher)
  if (!fresh) return null
  const { error } = await admin.from('ai_oauth_clients').upsert({ ...fresh, last_seen_at: new Date().toISOString() }, { onConflict: 'client_id' })
  if (error) throw new Error(`save client: ${error.message}`)
  return fresh
}
