/**
 * Work-order move log + roll counter (server). Written by the EXISTING move writers (applyVisitAction 'move', bulkShiftVisits,
 * the install-schedule assign writer) through `recordWorkOrderMoves` — there is no other writer. Table, column and function:
 * migration 202611300170. Until it is applied everything here degrades to "no counts, nothing logged" and never fails a move.
 *
 * `loadRollCounts(jobIds)` is the read the builder invoicing uses: per job, how many times its work was rolled.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { isRollReason, type MoveHistoryEntry, type MoveKind, type RollReason } from '@/lib/work-order-rolls'
import { orgDb } from '@/lib/supabase/org-db'

export type WorkOrderMove = {
  workOrderId: string
  from: string | null
  to: string | null
  reason?: RollReason | null
  kind: MoveKind
  userId?: string | null
  subId?: string | null
}

const CHUNK = 200

/**
 * Log date changes and bump roll_count (only for a move to a LATER day). Best effort by design: the date write already
 * stood, so a missing table / function (migration not applied) or a transient error is logged, never thrown.
 */
export async function recordWorkOrderMoves(admin: SupabaseClient, orgId: string, moves: WorkOrderMove[]): Promise<void> {
  const real = moves.filter((m) => m.from !== m.to)
  for (let i = 0; i < real.length; i += CHUNK) {
    try {
      const { error } = await admin.rpc('record_work_order_moves', {
        p_org_id: orgId,
        p_moves: real.slice(i, i + CHUNK).map((m) => ({
          work_order_id: m.workOrderId,
          from_date: m.from,
          to_date: m.to,
          reason: m.reason ?? null,
          kind: m.kind,
          moved_by: m.userId ?? null,
          moved_by_sub_id: m.userId ? null : (m.subId ?? null),
        })),
      })
      if (error && error.code !== '42883' && error.code !== 'PGRST202') console.error('[work-order-moves] record failed', error.message)
    } catch (e) {
      console.error('[work-order-moves] record failed', e)
    }
  }
}

/** work order id → times rolled (only ids with a count > 0). Empty when the column is not there yet. */
export async function loadWorkOrderRollCounts(admin: SupabaseClient, orgId: string, workOrderIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const ids = Array.from(new Set(workOrderIds.filter(Boolean)))
  const db = orgDb(admin, orgId)
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db.from('work_orders').select('id, roll_count').in('id', ids.slice(i, i + CHUNK))
    if (error) return out
    for (const r of (data ?? []) as Array<{ id: string; roll_count: number | null }>) if ((r.roll_count ?? 0) > 0) out.set(r.id, r.roll_count as number)
  }
  return out
}

export type JobRollCount = { rolls: number; workOrders: number }

/**
 * For invoicing and reports: per production job, the total times its trade work was rolled and how many work orders were
 * rolled at least once. Jobs never rolled are absent from the map.
 */
export async function loadRollCounts(admin: SupabaseClient, orgId: string, jobIds: string[]): Promise<Map<string, JobRollCount>> {
  const out = new Map<string, JobRollCount>()
  const ids = Array.from(new Set(jobIds.filter(Boolean)))
  const db = orgDb(admin, orgId)
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db.from('work_orders').select('job_id, roll_count').in('job_id', ids.slice(i, i + CHUNK)).gt('roll_count', 0)
    if (error) return out
    for (const r of (data ?? []) as Array<{ job_id: string | null; roll_count: number | null }>) {
      if (!r.job_id || !r.roll_count) continue
      const cur = out.get(r.job_id) ?? { rolls: 0, workOrders: 0 }
      out.set(r.job_id, { rolls: cur.rolls + r.roll_count, workOrders: cur.workOrders + 1 })
    }
  }
  return out
}

/** One work order's moves, newest first. Staff screens only (names of staff; a crew move shows the crew's name). */
export async function loadMoveHistory(admin: SupabaseClient, orgId: string, workOrderId: string, limit = 50): Promise<MoveHistoryEntry[]> {
  const db = orgDb(admin, orgId)
  const { data, error } = await db
    .from('work_order_moves')
    .select('id, from_date, to_date, reason, kind, moved_by, moved_by_sub_id, moved_at')
    .eq('work_order_id', workOrderId)
    .order('moved_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200))
  if (error) return []
  const rows = (data ?? []) as Array<{ id: string; from_date: string | null; to_date: string | null; reason: string | null; kind: string; moved_by: string | null; moved_by_sub_id: string | null; moved_at: string }>
  const userIds = Array.from(new Set(rows.map((r) => r.moved_by).filter((x): x is string => !!x)))
  const subIds = Array.from(new Set(rows.map((r) => r.moved_by_sub_id).filter((x): x is string => !!x)))
  const [users, subs] = await Promise.all([
    userIds.length ? db.from('users').select('id, full_name').in('id', userIds) : Promise.resolve({ data: [] as unknown[] }),
    subIds.length ? db.from('sub_contractors').select('id, company_name').in('id', subIds) : Promise.resolve({ data: [] as unknown[] }),
  ])
  const who = new Map<string, string>()
  for (const u of (users.data ?? []) as Array<{ id: string; full_name: string | null }>) who.set(u.id, u.full_name ?? 'Staff')
  for (const s of (subs.data ?? []) as Array<{ id: string; company_name: string | null }>) who.set(s.id, s.company_name ?? 'Crew')
  return rows.map((r) => ({
    id: r.id,
    from: r.from_date,
    to: r.to_date,
    reason: isRollReason(r.reason) ? r.reason : null,
    kind: r.kind === 'roll' || r.kind === 'shift' ? r.kind : 'move',
    by: r.moved_by ? (who.get(r.moved_by) ?? null) : r.moved_by_sub_id ? (who.get(r.moved_by_sub_id) ?? null) : null,
    at: r.moved_at,
  }))
}
