/**
 * Work-order move log (server). "Rolled N×" is DERIVED from it (kind 'roll' rows), never stored. Written by the EXISTING move writers (applyVisitAction 'move', bulkShiftVisits,
 * the install-schedule assign writer) through `recordWorkOrderMoves` — there is no other writer. Table and function:
 * migration 202611300170. Until it is applied everything here degrades to "no counts, nothing logged" and never fails a move.
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
 * Log date changes. Call it only AFTER the date write actually changed the row. Best effort by design: the date write already
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

const ROLL_PAGE = 1000

/** Roll moves (kind 'roll') of some work orders: the ONLY thing "Rolled N×" counts. Empty when the table is not there yet. */
async function loadRollMoves(admin: SupabaseClient, orgId: string, workOrderIds: string[]): Promise<Array<{ work_order_id: string; reason: string | null }>> {
  const out: Array<{ work_order_id: string; reason: string | null }> = []
  const db = orgDb(admin, orgId)
  for (let i = 0; i < workOrderIds.length; i += CHUNK) {
    for (let from = 0; ; from += ROLL_PAGE) {
      const { data, error } = await db
        .from('work_order_moves')
        .select('work_order_id, reason')
        .eq('kind', 'roll')
        .in('work_order_id', workOrderIds.slice(i, i + CHUNK))
        .order('id')
        .range(from, from + ROLL_PAGE - 1)
      if (error) return out
      const rows = (data ?? []) as Array<{ work_order_id: string; reason: string | null }>
      out.push(...rows)
      if (rows.length < ROLL_PAGE) break
    }
  }
  return out
}

/** work order id → times rolled with the "Not ready" button (only ids with a count > 0). Rain shifts and office moves are not counted. */
export async function loadWorkOrderRollCounts(admin: SupabaseClient, orgId: string, workOrderIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (const r of await loadRollMoves(admin, orgId, Array.from(new Set(workOrderIds.filter(Boolean))))) out.set(r.work_order_id, (out.get(r.work_order_id) ?? 0) + 1)
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
