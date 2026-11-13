import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client. **Bypasses RLS — server-only.**
 *
 * Never import this into a `'use client'` module: it reads
 * `SUPABASE_SERVICE_ROLE_KEY`, which must never reach the browser.
 *
 * Session persistence and auto-refresh are disabled — there is no user session
 * on a service-role client, and persisting one in a serverless request handler
 * leaks state between invocations.
 *
 * This is the single supported way to get an admin client. Do not hand-roll a
 * local `getAdminClient()`; see "Known Redundancy" in CLAUDE.md.
 *
 * Every request bypasses Next.js's fetch caches (`noStoreFetch`). Without it, a GET
 * in a GET-only route handler that never touches cookies/headers (the cron routes:
 * `dynamic = 'force-dynamic'` alone does not opt fetches out in Next 14) is stored
 * in the Data Cache forever, and identical GETs inside one server render are
 * deduped — so a read after a write returned the stale pre-write answer. That is
 * how the morning cron made three copies of one pay week on 2026-11-13.
 */
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: { fetch: noStoreFetch },
    }
  )
}

/**
 * fetch that Next.js never caches or dedupes: `cache: 'no-store'` skips the Data Cache, and a
 * signal of our own opts out of the per-render GET dedupe (Next's dedupe-fetch skips any request
 * that carries a signal). A caller's own signal is kept.
 */
export const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: 'no-store', signal: init?.signal ?? new AbortController().signal })
