/**
 * The customer's side of an automatic message (/m/<token> and the one-click unsubscribe POST). Server only. A link
 * opens only on its own company's web address (host fence, like /pay), and only for a message that was actually sent.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { fenceAllowsOrg } from '@/lib/company-host'
import { getRequestHostFence } from '@/lib/company-host-server'
import { findMessageByToken, type MessageRow } from '@/lib/customer-messages-db'

export async function resolvePublicMessage(admin: SupabaseClient, token: unknown): Promise<MessageRow | null> {
  const row = await findMessageByToken(admin, token)
  if (!row || row.status !== 'sent') return null
  const fence = await getRequestHostFence()
  return fenceAllowsOrg(fence, row.org_id) ? row : null
}
