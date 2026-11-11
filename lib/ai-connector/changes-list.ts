/** Changes an AI app made (owner screen): saved ones with the links the person saw, failed attempts, and any stuck mid-save. Read only. */
import type { SupabaseClient } from '@supabase/supabase-js'

import { APPLY_STALE_SECONDS } from '@/lib/ai-connector/config'
import type { ChangeOutcome } from '@/lib/ai-connector/tools/types'
import { orgDb } from '@/lib/supabase/org-db'

export type AppliedChange = { id: string; user_id: string; tool: string; status: string; created_at: string; confirmed_at: string | null; finished_at: string | null; result: ChangeOutcome | null; stuck: boolean }

export async function listAppliedChanges(admin: SupabaseClient, orgId: string, limit = 100, now = Date.now()): Promise<AppliedChange[]> {
  const { data } = await orgDb(admin, orgId).from('ai_changes').select('id, user_id, tool, status, created_at, confirmed_at, finished_at, result').in('status', ['applied', 'failed', 'applying']).order('created_at', { ascending: false }).limit(Math.min(limit, 200))
  // `applying` for longer than a retry window means the save never finished (a crash): the owner checks the record.
  return ((data ?? []) as Omit<AppliedChange, 'stuck'>[]).map((c) => ({ ...c, stuck: c.status === 'applying' && (!c.confirmed_at || now - new Date(c.confirmed_at).getTime() > APPLY_STALE_SECONDS * 2000) }))
}
