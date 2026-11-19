/**
 * "Not ready — roll": push ONE scheduled work order (a service visit or a trade work order) to its crew's next working day.
 * No write path of its own — it picks the date (lib/work-order-rolls.ts) and hands it to the existing move writer:
 *   service visit → applyVisitAction 'move'            (lib/service-plans-db.ts)
 *   trade order   → assignInstallTrade                 (lib/install-schedule-assign.ts, which re-syncs the job's schedule and the
 *                                                       Google / Outlook invite)
 * Both log the move and bump the roll counter. The crew phone link uses it too (`onlySubId` limits it to the crew's own work).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { assignInstallTrade } from '@/lib/install-schedule-assign'
import { calendarDaySpan } from '@/lib/job-trades'
import { SERVICE_VISIT_TYPE, ymdInZone } from '@/lib/service-plans'
import { applyVisitAction } from '@/lib/service-plans-db'
import { orgDb } from '@/lib/supabase/org-db'
import { loadWorkOrderRollCounts } from '@/lib/work-order-moves-db'
import { rollTargetDay, type RollReason } from '@/lib/work-order-rolls'

export type RollResult = { ok: true; from: string; to: string; rolls: number } | { ok: false; status: 400 | 404 | 409 | 500; error: string }

export async function rollWorkOrder(
  admin: SupabaseClient,
  orgId: string,
  workOrderId: string,
  o: {
    reason: RollReason | null
    by: { userId: string | null; subId: string | null }
    /** Staff user whose calendar connection the trade invite falls back to ('' = rely on the company's nominated account). */
    schedulingUserId: string
    onlySubId?: string
    now?: Date
  }
): Promise<RollResult> {
  const now = o.now ?? new Date()
  const { data } = await orgDb(admin, orgId)
    .from('work_orders')
    .select('id, work_order_type, trade, job_id, status, scheduled_date, install_days, assigned_sub_id')
    .eq('id', workOrderId)
    .maybeSingle()
  const wo = data as { id: string; work_order_type: string | null; trade: string | null; job_id: string | null; status: string; scheduled_date: string | null; install_days: unknown; assigned_sub_id: string | null } | null
  if (!wo || (o.onlySubId && wo.assigned_sub_id !== o.onlySubId)) return { ok: false, status: 404, error: 'Work not found' }
  if (wo.status !== 'scheduled' || !wo.scheduled_date) return { ok: false, status: 409, error: 'Only scheduled work can be rolled' }

  const today = ymdInZone(now, await loadOrgTimeZone(admin, orgId))
  const from = wo.scheduled_date
  const isVisit = wo.work_order_type === SERVICE_VISIT_TYPE
  const isTrade = !isVisit && !!wo.trade && !!wo.job_id
  if (!isVisit && !isTrade) return { ok: false, status: 400, error: 'This kind of work can’t be rolled here' }
  // A two-day crew already on its second day can't have its START rolled: the office moves it.
  if (isTrade && calendarDaySpan(wo.install_days) > 1 && from < today) return { ok: false, status: 409, error: 'This crew already started — ask the office to move it' }
  const to = rollTargetDay(from, today)

  if (isVisit) {
    const res = await applyVisitAction(admin, orgId, wo.id, { action: 'move', date: to, ...(o.reason ? { reason: o.reason } : {}) }, o.by, { onlySubId: o.onlySubId, now, moveKind: 'roll' })
    if (!res.ok) return { ok: false, status: res.status, error: res.error }
  } else {
    if (!wo.assigned_sub_id) return { ok: false, status: 409, error: 'Only scheduled work can be rolled' }
    const res = await assignInstallTrade(admin, { orgId, schedulingUserId: o.schedulingUserId, by: o.by }, { workOrderId: wo.id, subId: wo.assigned_sub_id, scheduledDate: to, reason: o.reason, kind: 'roll' })
    if (res.status !== 200) return { ok: false, status: res.status === 404 ? 404 : res.status === 400 ? 400 : 500, error: String(res.body.error ?? 'Could not roll') }
  }
  const rolls = (await loadWorkOrderRollCounts(admin, orgId, [wo.id])).get(wo.id) ?? 0
  return { ok: true, from, to, rolls }
}
