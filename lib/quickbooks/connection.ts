/**
 * A company's QuickBooks connection — the ONE reader/writer of `qb_connections` (migration 202611130050).
 *
 * Tokens: access + refresh are sealed at rest (lib/secret-seal.ts, env SECRETS_ENCRYPTION_KEY) and never leave the
 * server; `publicView` is the only shape that goes to a browser.
 *
 * Refresh with rotation (Intuit returns a NEW refresh token on every refresh and the old one dies):
 *  1. take a short lease on the row (compare-and-swap on `refresh_version` + `refresh_lease_until`) — only one worker
 *     refreshes a company at a time;
 *  2. refresh; store BOTH new tokens in one update (retried) and bump `refresh_version`, release the lease;
 *  3. `invalid_grant` is judged only after re-reading the row: if another worker already rotated (version moved) we use
 *     its tokens; only a still-unchanged row is marked "needs reconnect". A timeout / 5xx / throttle is never judged.
 * Nothing here posts to QuickBooks; PR 4's worker calls `getQuickBooksAccess`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { orgDb } from '@/lib/supabase/org-db'
import type { Queue as TodayQueue } from '@/lib/today'

import { fetchCompanyName, refreshTokens, revokeToken, type IntuitTokens } from './api'
import { quickBooksConfig, type QbEnvironment } from './config'
import { integrationSecretKey, openWithKey, sealWithKey } from '@/lib/secret-seal'

export const QB_TOKEN_LABEL = 'quickbooks-tokens'
const ACCESS_MARGIN_MS = 2 * 60_000
const LEASE_MS = 30_000
const WARN_BEFORE_EXPIRY_DAYS = 30
const KEEP_WARM_AFTER_DAYS = 7

export type QbStatus = 'connected' | 'needs_reconnect' | 'disconnected'

export type QbConnectionRow = {
  id: string
  org_id: string
  realm_id: string
  environment: QbEnvironment
  company_name: string | null
  status: QbStatus
  needs_reconnect_reason: string | null
  access_token_ct: string | null
  refresh_token_ct: string | null
  access_expires_at: string | null
  refresh_expires_at: string | null
  refresh_version: number
  refresh_lease_until: string | null
  last_refreshed_at: string | null
  last_error: string | null
  connected_by: string | null
  connected_at: string
  disconnected_at: string | null
}

const COLS =
  'id, org_id, realm_id, environment, company_name, status, needs_reconnect_reason, access_token_ct, refresh_token_ct, access_expires_at, refresh_expires_at, refresh_version, refresh_lease_until, last_refreshed_at, last_error, connected_by, connected_at, disconnected_at'

/** What a browser may see. No token, no ciphertext, no lease. */
export type QbPublicView = {
  /** This server has the Intuit app keys AND the encryption key. */
  configured: boolean
  status: QbStatus | 'not_connected'
  companyName: string | null
  environment: QbEnvironment | null
  connectedAt: string | null
  reason: string | null
  /** Reconnect soon: Intuit's refresh token ends within 30 days. */
  expiresSoon: boolean
}

export function publicView(row: QbConnectionRow | null, configured: boolean, now = Date.now()): QbPublicView {
  const live = row && row.status !== 'disconnected' ? row : null
  return {
    configured,
    status: live ? live.status : 'not_connected',
    companyName: live?.company_name ?? null,
    environment: live?.environment ?? null,
    connectedAt: live?.connected_at ?? null,
    reason: live?.status === 'needs_reconnect' ? live.needs_reconnect_reason : null,
    expiresSoon: !!live && live.status === 'connected' && expiresWithinDays(live.refresh_expires_at, WARN_BEFORE_EXPIRY_DAYS, now),
  }
}

function expiresWithinDays(iso: string | null, days: number, now: number): boolean {
  if (!iso) return false
  const t = Date.parse(iso)
  return Number.isFinite(t) && t - now < days * 86_400_000
}

/** Both pieces this server needs before a company may connect. */
export function quickBooksServerReady(): boolean {
  return quickBooksConfig() !== null && integrationSecretKey(QB_TOKEN_LABEL) !== null
}

export async function loadConnection(admin: SupabaseClient, orgId: string): Promise<QbConnectionRow | null> {
  const { data, error } = await orgDb(admin, orgId).from('qb_connections').select(COLS).maybeSingle()
  if (error) throw new Error(`quickbooks connection read failed: ${error.message}`)
  return (data as QbConnectionRow | null) ?? null
}

function seal(plain: string): string {
  const key = integrationSecretKey(QB_TOKEN_LABEL)
  if (!key) throw new Error('SECRETS_ENCRYPTION_KEY is not set')
  return sealWithKey(key, plain)
}

function open(sealed: string | null): string | null {
  const key = integrationSecretKey(QB_TOKEN_LABEL)
  return key && sealed ? openWithKey(key, sealed) : null
}

const iso = (ms: number) => new Date(ms).toISOString()

function tokenColumns(t: IntuitTokens, now: number) {
  return {
    access_token_ct: seal(t.accessToken),
    refresh_token_ct: seal(t.refreshToken),
    access_expires_at: iso(now + t.accessExpiresInSec * 1000),
    refresh_expires_at: iso(now + t.refreshExpiresInSec * 1000),
    last_refreshed_at: iso(now),
  }
}

export type SaveConnectionResult = { ok: true } | { ok: false; reason: 'different_company' | 'unavailable' }

/**
 * Store a fresh authorization (first connect, reconnect, or after a disconnect). Reconnecting the SAME QuickBooks company
 * resumes; a different one is refused once any link exists, because the links would point into the wrong books.
 */
export async function saveNewConnection(
  admin: SupabaseClient,
  orgId: string,
  input: { realmId: string; environment: QbEnvironment; companyName: string | null; tokens: IntuitTokens; userId: string },
  now = Date.now()
): Promise<SaveConnectionResult> {
  const db = orgDb(admin, orgId)
  const existing = await loadConnection(admin, orgId)
  if (existing && existing.realm_id !== input.realmId) {
    const { count, error } = await db.from('qb_links').select('id', { count: 'exact', head: true })
    if (error) return { ok: false, reason: 'unavailable' }
    if ((count ?? 0) > 0) return { ok: false, reason: 'different_company' }
  }
  const values = {
    realm_id: input.realmId,
    environment: input.environment,
    company_name: input.companyName,
    status: 'connected',
    needs_reconnect_reason: null,
    last_error: null,
    refresh_lease_until: null,
    connected_by: input.userId,
    connected_at: iso(now),
    disconnected_at: null,
    disconnected_by: null,
    updated_at: iso(now),
    ...tokenColumns(input.tokens, now),
  }
  const { error } = existing
    ? await db.from('qb_connections').update({ ...values, refresh_version: existing.refresh_version + 1 }).eq('id', existing.id)
    : await db.from('qb_connections').insert({ ...values, refresh_version: 0 })
  if (error) {
    console.error('quickbooks: could not save connection', error.message)
    return { ok: false, reason: 'unavailable' }
  }
  return { ok: true }
}

export type QbAccess =
  | { ok: true; accessToken: string; realmId: string; environment: QbEnvironment }
  | { ok: false; reason: 'not_connected' | 'needs_reconnect' | 'unavailable' }

async function markNeedsReconnect(admin: SupabaseClient, orgId: string, reason: string, expectVersion: number): Promise<void> {
  // Only while nobody rotated meanwhile: a row that moved on is healthy.
  await orgDb(admin, orgId)
    .from('qb_connections')
    .update({ status: 'needs_reconnect', needs_reconnect_reason: reason.slice(0, 200), refresh_lease_until: null, access_token_ct: null, updated_at: iso(Date.now()) })
    .eq('status', 'connected')
    .eq('refresh_version', expectVersion)
}

async function releaseLease(admin: SupabaseClient, orgId: string, version: number, lastError: string | null): Promise<void> {
  await orgDb(admin, orgId)
    .from('qb_connections')
    .update({ refresh_lease_until: null, last_error: lastError ? lastError.slice(0, 200) : null, updated_at: iso(Date.now()) })
    .eq('refresh_version', version)
}

function usable(row: QbConnectionRow, now: number): string | null {
  if (row.status !== 'connected' || !row.access_expires_at) return null
  if (Date.parse(row.access_expires_at) - now <= ACCESS_MARGIN_MS) return null
  return open(row.access_token_ct)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * A working access token for the company, refreshing (with rotation) when it is about to expire. Never throws.
 * `unavailable` = try again later (Intuit down, throttled, another worker mid-refresh); `needs_reconnect` = a person must reconnect.
 */
export async function getQuickBooksAccess(admin: SupabaseClient, orgId: string, opts: { now?: () => number; wait?: (ms: number) => Promise<void>; force?: boolean } = {}): Promise<QbAccess> {
  const clock = opts.now ?? Date.now
  const wait = opts.wait ?? sleep
  let force = opts.force === true
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const row = await loadConnection(admin, orgId)
      if (!row || row.status === 'disconnected') return { ok: false, reason: 'not_connected' }
      if (row.status === 'needs_reconnect') return { ok: false, reason: 'needs_reconnect' }
      const token = force ? null : usable(row, clock())
      if (token) return { ok: true, accessToken: token, realmId: row.realm_id, environment: row.environment }

      const cfg = quickBooksConfig()
      const refreshToken = open(row.refresh_token_ct)
      if (!cfg) return { ok: false, reason: 'unavailable' }
      if (!refreshToken) {
        // Stored token can't be opened: the encryption key changed or the row is damaged. Nothing to retry with.
        await markNeedsReconnect(admin, orgId, 'The saved QuickBooks login could not be read', row.refresh_version)
        return { ok: false, reason: 'needs_reconnect' }
      }

      // Lease: exactly one worker wins (conditional update; the row must be unchanged since we read it).
      const nowMs = clock()
      const { data: won, error: leaseErr } = await orgDb(admin, orgId)
        .from('qb_connections')
        .update({ refresh_lease_until: iso(nowMs + LEASE_MS) })
        .eq('status', 'connected')
        .eq('refresh_version', row.refresh_version)
        .or(`refresh_lease_until.is.null,refresh_lease_until.lte.${iso(nowMs)}`)
        .select('id')
      if (leaseErr) return { ok: false, reason: 'unavailable' }
      if (!won || won.length !== 1) {
        await wait(1000) // someone else is refreshing: look again shortly (and use what it saves)
        force = false
        continue
      }

      const result = await refreshTokens(cfg, refreshToken)
      if (result.ok) {
        const cols = { ...tokenColumns(result.tokens, clock()), refresh_version: row.refresh_version + 1, refresh_lease_until: null, last_error: null, updated_at: iso(clock()) }
        // The old refresh token is dead the moment Intuit answered: losing the new one means a forced reconnect, so retry the write.
        for (let i = 0; i < 3; i++) {
          const { error } = await orgDb(admin, orgId).from('qb_connections').update(cols).eq('id', row.id).eq('refresh_version', row.refresh_version)
          if (!error) return { ok: true, accessToken: result.tokens.accessToken, realmId: row.realm_id, environment: row.environment }
          await wait(250 * (i + 1))
        }
        console.error('quickbooks: refreshed tokens could not be saved — connection needs reconnect', { orgId })
        await markNeedsReconnect(admin, orgId, 'QuickBooks login could not be saved after a refresh', row.refresh_version)
        return { ok: false, reason: 'needs_reconnect' }
      }

      if (result.kind === 'invalid_grant') {
        const again = await loadConnection(admin, orgId)
        if (again && again.refresh_version !== row.refresh_version) { force = false; continue } // another worker rotated first: use its tokens
        await markNeedsReconnect(admin, orgId, 'QuickBooks stopped accepting this connection. Please reconnect.', row.refresh_version)
        return { ok: false, reason: 'needs_reconnect' }
      }
      await releaseLease(admin, orgId, row.refresh_version, result.message)
      return { ok: false, reason: 'unavailable' }
    }
    return { ok: false, reason: 'unavailable' }
  } catch (e) {
    console.error('quickbooks: access token failed', orgId, e instanceof Error ? e.message : e)
    return { ok: false, reason: 'unavailable' }
  }
}

/** Disconnect: revoke at Intuit, wipe both tokens, keep the row and every qb_link (reconnecting the same company resumes). */
export async function disconnectQuickBooks(admin: SupabaseClient, orgId: string, userId: string, now = Date.now()): Promise<{ ok: true; revoked: boolean } | { ok: false }> {
  const row = await loadConnection(admin, orgId)
  if (!row || row.status === 'disconnected') return { ok: true, revoked: false }
  const cfg = quickBooksConfig()
  let revoked = false
  const refreshToken = open(row.refresh_token_ct)
  if (cfg && refreshToken) {
    const r = await revokeToken(cfg, refreshToken)
    revoked = r.ok
    if (!r.ok) console.error('quickbooks: revoke failed (disconnecting here anyway)', r.message)
  }
  // Disconnect locally even when Intuit could not be reached: the owner's intent wins, and the tokens are gone either way.
  const { error } = await orgDb(admin, orgId)
    .from('qb_connections')
    .update({ status: 'disconnected', access_token_ct: null, refresh_token_ct: null, access_expires_at: null, refresh_expires_at: null, refresh_lease_until: null, needs_reconnect_reason: null, disconnected_at: iso(now), disconnected_by: userId, updated_at: iso(now) })
    .eq('id', row.id)
  if (error) return { ok: false }
  return { ok: true, revoked }
}

/** Name the QuickBooks company for a fresh token (proves the token works for the realm). */
export const lookUpCompany = fetchCompanyName

/** The daily keep-warm for one company: refresh when the token is old (and surface a reconnect before Intuit ends it). */
export async function keepQuickBooksWarm(admin: SupabaseClient, orgId: string, now = Date.now()): Promise<'skipped' | 'refreshed' | 'needs_reconnect' | 'unavailable'> {
  const row = await loadConnection(admin, orgId)
  if (!row || row.status !== 'connected') return 'skipped'
  const stale = !row.last_refreshed_at || now - Date.parse(row.last_refreshed_at) > KEEP_WARM_AFTER_DAYS * 86_400_000
  if (!stale) return 'skipped'
  const r = await getQuickBooksAccess(admin, orgId, { now: () => now, force: true })
  return r.ok ? 'refreshed' : r.reason === 'needs_reconnect' ? 'needs_reconnect' : 'unavailable'
}

/**
 * Owners' Today card: the connection needs a person (reconnect), or will soon. Null when all is well, the company never
 * connected, or the switch is off (callers gate on the feature).
 */
export async function loadQuickBooksNeedsYouQueue(admin: SupabaseClient, orgId: string, now = Date.now()): Promise<TodayQueue | null> {
  const row = await loadConnection(admin, orgId)
  if (!row || row.status === 'disconnected') return null
  if (row.status === 'needs_reconnect') {
    return {
      id: 'quickbooks-reconnect',
      title: 'QuickBooks needs you',
      count: 1,
      empty: 'QuickBooks is connected.',
      items: [{ id: 'reconnect', title: 'Reconnect QuickBooks', detail: row.needs_reconnect_reason ?? 'QuickBooks stopped accepting this connection.', href: '/admin#quickbooks', ref: 'QuickBooks', note: 'Reconnect QuickBooks' }],
    }
  }
  if (expiresWithinDays(row.refresh_expires_at, WARN_BEFORE_EXPIRY_DAYS, now)) {
    return {
      id: 'quickbooks-reconnect',
      title: 'QuickBooks needs you',
      count: 1,
      empty: 'QuickBooks is connected.',
      items: [{ id: 'reconnect-soon', title: 'Reconnect QuickBooks soon', detail: 'Intuit ends this connection within 30 days. Reconnecting takes a minute.', href: '/admin#quickbooks', ref: 'QuickBooks', note: 'Reconnect QuickBooks soon' }],
    }
  }
  return null
}
