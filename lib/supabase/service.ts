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
    }
  )
}
