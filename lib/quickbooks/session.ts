/** Opens the accounting client for ONE company: that company's own login, that company's own QuickBooks (realm). Nothing else decides the realm. */
import type { SupabaseClient } from '@supabase/supabase-js'

import { createQbClient, type QbClient } from './client'
import { getQuickBooksAccess, type QbAccess } from './connection'

export type OpenClient = { ok: true; client: QbClient } | { ok: false; reason: 'not_connected' | 'needs_reconnect' | 'unavailable' }

export async function openQbClient(admin: SupabaseClient, orgId: string, hooks: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {}): Promise<OpenClient> {
  const first: QbAccess = await getQuickBooksAccess(admin, orgId)
  if (!first.ok) return { ok: false, reason: first.reason }
  let token = first.accessToken
  const client = createQbClient({
    environment: first.environment,
    realmId: first.realmId,
    sleep: hooks.sleep,
    now: hooks.now,
    session: {
      // A 401 mid-batch: refresh (with rotation, under the per-company lease) and carry on; the rest of the batch keeps working.
      async token(force) {
        if (force) {
          const fresh = await getQuickBooksAccess(admin, orgId, { force: true })
          if (!fresh.ok) return null
          token = fresh.accessToken
        }
        return token
      },
    },
  })
  return { ok: true, client }
}
