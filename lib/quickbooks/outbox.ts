/**
 * The QuickBooks side of `integration_outbox` — claim, finish, back off, park for a person. One company at a time (orgDb).
 *
 * Row life:  pending -> processing (a lease: `locked_until`) -> completed | skipped | pending again (back-off) | failed (Needs you).
 *  - A row is claimed with a compare-and-swap on (status, locked_until): two overlapping cron runs never process the same row.
 *  - A crashed worker's lease simply runs out; the next run takes the row again. That is safe because every create is
 *    find-before-send (handlers.ts), so "did it land?" is always answered by QuickBooks, not by guessing.
 *  - Finishing is a compare-and-swap on OUR lease: if the CRM re-queued the record while we worked (enqueueIntegrationEvent resets
 *    the row to pending), our result is dropped and the newer facts are sent next time. A fact is never marked done that we did not send.
 *  - 'failed' + error_kind 'needs_you' is terminal until an owner presses Retry (-> pending, attempts reset) or Skip.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { orgDb } from '@/lib/supabase/org-db'

export const MAX_ATTEMPTS = 6
/** Minutes to wait after attempt 1, 2, 3 ... (then the row goes to Needs you). */
export const BACKOFF_MINUTES = [1, 5, 15, 60, 240] as const
export const LEASE_MS = 3 * 60_000

export type OutboxRow = {
  id: string
  org_id: string
  event_type: string
  entity_table: string
  entity_id: string
  idempotency_key: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped'
  attempt_count: number
  last_error: string | null
  error_code: string | null
  error_kind: 'retrying' | 'needs_you' | null
  qb_type: string | null
  qb_id: string | null
  sent_at: string | null
  next_attempt_at: string | null
  locked_until: string | null
  created_at: string
  updated_at: string
  processed_at: string | null
}

export const OUTBOX_COLS =
  'id, org_id, event_type, entity_table, entity_id, idempotency_key, status, attempt_count, last_error, error_code, error_kind, qb_type, qb_id, sent_at, next_attempt_at, locked_until, created_at, updated_at, processed_at'

const iso = (ms: number) => new Date(ms).toISOString()

/** Rows this company's worker may take now, oldest first, each claimed with a lease. */
export async function claimDue(admin: SupabaseClient, orgId: string, now: number, limit: number): Promise<Array<OutboxRow & { lease: string }>> {
  const db = orgDb(admin, orgId)
  const { data, error } = await db
    .from('integration_outbox')
    .select(OUTBOX_COLS)
    .eq('provider', 'quickbooks')
    .in('status', ['pending', 'processing'])
    .order('created_at', { ascending: true })
    .limit(Math.max(limit * 4, 50))
  if (error) throw new Error(`outbox read failed: ${error.message}`)
  const due = ((data ?? []) as OutboxRow[]).filter((r) =>
    r.status === 'pending' ? !r.next_attempt_at || Date.parse(r.next_attempt_at) <= now : !!r.locked_until && Date.parse(r.locked_until) <= now
  )
  const out: Array<OutboxRow & { lease: string }> = []
  for (const row of due) {
    if (out.length >= limit) break
    const lease = iso(now + LEASE_MS)
    let q = db.from('integration_outbox').update({ status: 'processing', locked_until: lease, updated_at: iso(now) }).eq('id', row.id).eq('status', row.status)
    q = row.status === 'processing' ? q.eq('locked_until', row.locked_until) : q.is('locked_until', null)
    const { data: won, error: claimErr } = await q.select('id')
    if (claimErr) throw new Error(`outbox claim failed: ${claimErr.message}`)
    if (won && won.length === 1) out.push({ ...row, status: 'processing', locked_until: lease, lease })
  }
  return out
}

type Finish = { row: Pick<OutboxRow, 'id'> & { lease: string }; now: number }

async function finish(admin: SupabaseClient, orgId: string, f: Finish, values: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await orgDb(admin, orgId)
    .from('integration_outbox')
    .update({ ...values, locked_until: null, updated_at: iso(f.now) })
    .eq('id', f.row.id)
    .eq('status', 'processing')
    .eq('locked_until', f.row.lease)
    .select('id')
  if (error) throw new Error(`outbox update failed: ${error.message}`)
  return !!data && data.length === 1
}

export const markDone = (admin: SupabaseClient, orgId: string, f: Finish, d: { qbType: string | null; qbId: string | null; warning?: { code: string; message: string } | null }) =>
  finish(admin, orgId, f, {
    status: 'completed',
    processed_at: iso(f.now),
    sent_at: d.qbId ? iso(f.now) : null,
    qb_type: d.qbType,
    qb_id: d.qbId,
    // A post that worked but needs a human look (e.g. QuickBooks totalled the tax differently) stays visible in Needs you.
    last_error: d.warning?.message ?? null,
    error_code: d.warning?.code ?? null,
    error_kind: d.warning ? 'needs_you' : null,
  })

export const markSkipped = (admin: SupabaseClient, orgId: string, f: Finish, d: { code: string; message: string }) =>
  finish(admin, orgId, f, { status: 'skipped', processed_at: iso(f.now), last_error: d.message, error_code: d.code, error_kind: null })

/** Wait and try again; after MAX_ATTEMPTS it becomes a Needs-you line. */
export function markRetry(admin: SupabaseClient, orgId: string, f: Finish, row: Pick<OutboxRow, 'attempt_count'>, d: { code: string | null; message: string; delayMs?: number }) {
  const attempts = row.attempt_count + 1
  if (attempts >= MAX_ATTEMPTS) return markNeedsYou(admin, orgId, f, { ...d, code: d.code ?? 'gave_up', message: `${d.message} (tried ${attempts} times)` }, attempts)
  const minutes = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)]
  const jitter = Math.floor((hash(f.row.id) % 30) * 1000)
  return finish(admin, orgId, f, { status: 'pending', attempt_count: attempts, next_attempt_at: iso(f.now + (d.delayMs ?? minutes * 60_000) + jitter), last_error: d.message, error_code: d.code, error_kind: 'retrying' })
}

export const markNeedsYou = (admin: SupabaseClient, orgId: string, f: Finish, d: { code: string | null; message: string }, attempts?: number) =>
  finish(admin, orgId, f, { status: 'failed', ...(attempts != null ? { attempt_count: attempts } : {}), processed_at: iso(f.now), last_error: d.message, error_code: d.code, error_kind: 'needs_you' })

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

/** Give a claimed row back untouched (the worker stopped early: throttled, or the login needs a person). */
export async function release(admin: SupabaseClient, orgId: string, f: Finish, laterMs: number): Promise<void> {
  await finish(admin, orgId, f, { status: 'pending', next_attempt_at: iso(f.now + laterMs) })
}

/** Owner pressed Retry: back to pending, attempts reset, due now. Only rows that are stuck (Needs you). */
export async function retryRow(admin: SupabaseClient, orgId: string, id: string, now = Date.now()): Promise<boolean> {
  const { data, error } = await orgDb(admin, orgId)
    .from('integration_outbox')
    .update({ status: 'pending', attempt_count: 0, next_attempt_at: null, locked_until: null, error_kind: null, last_error: null, error_code: null, updated_at: iso(now) })
    .eq('id', id)
    .eq('provider', 'quickbooks')
    .or('status.eq.failed,error_kind.eq.needs_you')
    .select('id')
  if (error) throw new Error(`outbox retry failed: ${error.message}`)
  return !!data && data.length === 1
}

/** Owner pressed Skip ("handled in QuickBooks" / "never send this"): the row is closed and never sent. */
export async function skipRow(admin: SupabaseClient, orgId: string, id: string, now = Date.now()): Promise<boolean> {
  const { data, error } = await orgDb(admin, orgId)
    .from('integration_outbox')
    .update({ status: 'skipped', error_kind: null, last_error: 'Skipped by an owner', error_code: 'skipped_by_owner', processed_at: iso(now), locked_until: null, updated_at: iso(now) })
    .eq('id', id)
    .eq('provider', 'quickbooks')
    .or('status.eq.failed,error_kind.eq.needs_you')
    .select('id')
  if (error) throw new Error(`outbox skip failed: ${error.message}`)
  return !!data && data.length === 1
}
