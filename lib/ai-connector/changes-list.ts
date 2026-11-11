/** Changes an AI app made (owner screen): applied ones with the links the person saw, and failed attempts. Read only. */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { ChangeOutcome } from '@/lib/ai-connector/tools/types'
import { orgDb } from '@/lib/supabase/org-db'

export type AppliedChange = { id: string; user_id: string; tool: string; status: string; created_at: string; finished_at: string | null; result: ChangeOutcome | null }

export async function listAppliedChanges(admin: SupabaseClient, orgId: string, limit = 100): Promise<AppliedChange[]> {
  const { data } = await orgDb(admin, orgId).from('ai_changes').select('id, user_id, tool, status, created_at, finished_at, result').in('status', ['applied', 'failed']).order('created_at', { ascending: false }).limit(Math.min(limit, 200))
  return (data ?? []) as AppliedChange[]
}
