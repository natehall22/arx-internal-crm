/** The ONE writer of the AI audit log (`ai_audit_log`). Arguments are stored as a hash, never as text. */
import type { SupabaseClient } from '@supabase/supabase-js'

import { hashArgs } from '@/lib/ai-connector/crypto'
import { orgDb } from '@/lib/supabase/org-db'

export type AuditEntry = {
  orgId: string
  userId: string | null
  clientId: string | null
  tool: string
  recordIds?: string[]
  result: 'ok' | 'denied' | 'error' | 'rate_limited'
  args?: unknown
  detail?: string | null
}

/** Throws when the row cannot be written: a tool call that cannot be logged is not answered. */
export async function writeAudit(admin: SupabaseClient, e: AuditEntry): Promise<void> {
  const { error } = await orgDb(admin, e.orgId).from('ai_audit_log').insert({
    user_id: e.userId,
    client_id: e.clientId,
    tool: e.tool.slice(0, 80),
    record_ids: (e.recordIds ?? []).slice(0, 50),
    result: e.result,
    args_hash: e.args === undefined ? null : hashArgs(e.args),
    detail: e.detail ? e.detail.slice(0, 300) : null,
  })
  if (error) throw new Error(`audit log: ${error.message}`)
}

export type AuditRow = { id: number; user_id: string | null; client_id: string | null; tool: string; record_ids: string[]; result: string; detail: string | null; created_at: string }

export async function listAudit(admin: SupabaseClient, orgId: string, opts: { limit?: number; userId?: string } = {}): Promise<AuditRow[]> {
  let q = orgDb(admin, orgId).from('ai_audit_log').select('id, user_id, client_id, tool, record_ids, result, detail, created_at').order('id', { ascending: false }).limit(Math.min(opts.limit ?? 100, 200))
  if (opts.userId) q = q.eq('user_id', opts.userId)
  const { data } = await q
  return (data ?? []) as AuditRow[]
}
