/**
 * Rate limits and one-time claims for the AI connector, kept in the database so they hold across server instances
 * (`ai_rate_hit`, `ai_claim_once`, migration 202611130020). If the database call itself fails (function not applied yet,
 * brief outage) the in-memory counter used by the public estimate takes over, so a limit is never silently skipped.
 * Limits are keyed by app / grant / person / company; the per-address key is only a loose backstop, because Claude and
 * ChatGPT send every user's requests from a small shared set of addresses.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { consumePublicEstimateRateLimit } from '@/lib/public-estimate-rate-limit'

export type RateResult = { ok: true } | { ok: false; retryAfterSec: number }
export type RateGate = (key: string, limit: number, windowSeconds: number) => Promise<RateResult>
export type OnceGate = (key: string, ttlSeconds: number) => Promise<boolean>

export function dbRateGate(admin: SupabaseClient, now?: number): RateGate {
  return async (key, limit, windowSeconds) => {
    try {
      const { data, error } = await admin.rpc('ai_rate_hit', { p_key: key.slice(0, 200), p_window_seconds: windowSeconds, p_limit: limit })
      const row = (Array.isArray(data) ? data[0] : data) as { allowed?: boolean; retry_after?: number } | null
      if (!error && row && typeof row.allowed === 'boolean') return row.allowed ? { ok: true } : { ok: false, retryAfterSec: Math.max(1, Number(row.retry_after) || windowSeconds) }
    } catch {
      /* fall through to memory */
    }
    const m = consumePublicEstimateRateLimit({ key: `ai:${key}`, limit, windowMs: windowSeconds * 1000, now })
    return m.ok ? { ok: true } : { ok: false, retryAfterSec: m.retryAfterSec }
  }
}

const memoryOnce = new Map<string, number>()
export function resetOnceForTests() {
  memoryOnce.clear()
}

/** True for the first caller of a key until it expires. Fails closed to a per-instance memory claim if the database call fails. */
export function dbOnceGate(admin: SupabaseClient, now?: () => number): OnceGate {
  return async (key, ttlSeconds) => {
    try {
      const { data, error } = await admin.rpc('ai_claim_once', { p_key: key.slice(0, 200), p_ttl_seconds: ttlSeconds })
      if (!error && typeof data === 'boolean') return data
    } catch {
      /* fall through to memory */
    }
    const t = now ? now() : Date.now()
    const until = memoryOnce.get(key)
    if (until !== undefined && until > t) return false
    memoryOnce.set(key, t + ttlSeconds * 1000)
    return true
  }
}

/** Fire-and-forget housekeeping: delete apps that registered and were never used. */
export async function pruneUnusedClients(admin: SupabaseClient, days: number): Promise<void> {
  try {
    await admin.rpc('ai_prune_unused_clients', { p_days: days })
  } catch {
    /* housekeeping only */
  }
}
