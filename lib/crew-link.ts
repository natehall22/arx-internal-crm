/**
 * Crew photo links — `/crew/[token]`, sent in each trade's calendar invite.
 *
 * No login. The token IS the authorization, and it is deliberately narrow: it
 * resolves to exactly one trade on one job and only lets the holder add photos
 * to that trade and see the address they were sent to. No customer contact
 * details, no other jobs, no read of existing photos beyond a count per angle.
 *
 * A link stops working when: the trade is removed or unassigned, it moves to a
 * different sub (the token is rotated), the job is cancelled, or
 * CREW_LINK_GRACE_DAYS after the crew's last scheduled day.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { addDaysToDateOnly } from '@/lib/install-calendar'
import { ymdInBusinessTz } from '@/lib/calendar-business-tz'
import { CREW_LINK_GRACE_DAYS, calendarDaySpan, type Trade } from '@/lib/job-trades'

/** Enough for a thorough walk-around plus detail shots; stops a leaked link filling storage. */
export const CREW_LINK_MAX_PHOTOS = 80

const TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/

export type CrewLinkContext = {
  workOrderId: string
  orgId: string
  jobId: string
  jobNumber: string
  trade: Trade
  addressText: string | null
  scheduledDate: string
  status: string
}

export type CrewLinkResult = { ok: true; ctx: CrewLinkContext } | { ok: false; reason: 'invalid' | 'expired' }

/** Pure: is a link for a crew whose first day is `scheduledDate` still usable on `todayYmd`? */
export function isCrewLinkExpired(scheduledDate: string, installDays: unknown, todayYmd: string): boolean {
  const lastDay = addDaysToDateOnly(scheduledDate, calendarDaySpan(installDays) - 1)
  return todayYmd > addDaysToDateOnly(lastDay, CREW_LINK_GRACE_DAYS)
}

export async function resolveCrewLink(admin: SupabaseClient, token: string): Promise<CrewLinkResult> {
  if (!TOKEN_RE.test(token)) return { ok: false, reason: 'invalid' }

  const { data: trade } = await admin
    .from('work_orders')
    .select('id, org_id, job_id, trade, status, scheduled_date, install_days, assigned_sub_id')
    .eq('crew_link_token', token)
    .not('trade', 'is', null)
    .maybeSingle()
  if (!trade || !trade.job_id || !trade.scheduled_date || !trade.assigned_sub_id || trade.status === 'cancelled') {
    return { ok: false, reason: 'invalid' }
  }

  const { data: job } = await admin
    .from('production_jobs')
    .select('id, job_number, address_text, cancelled_at')
    .eq('id', trade.job_id)
    .eq('org_id', trade.org_id)
    .maybeSingle()
  if (!job || job.cancelled_at) return { ok: false, reason: 'invalid' }

  if (isCrewLinkExpired(trade.scheduled_date, trade.install_days, ymdInBusinessTz(new Date()))) {
    return { ok: false, reason: 'expired' }
  }

  return {
    ok: true,
    ctx: {
      workOrderId: trade.id,
      orgId: trade.org_id,
      jobId: job.id,
      jobNumber: job.job_number,
      trade: trade.trade as Trade,
      addressText: job.address_text,
      scheduledDate: trade.scheduled_date,
      status: trade.status,
    },
  }
}

/** Tag → count of photos already on this trade. */
export async function crewLinkPhotoCounts(admin: SupabaseClient, ctx: CrewLinkContext): Promise<Record<string, number>> {
  const { data } = await admin
    .from('photos')
    .select('photo_tag')
    .eq('org_id', ctx.orgId)
    .eq('job_id', ctx.jobId)
    .eq('work_order_id', ctx.workOrderId)
    .is('deleted_at', null)
  const counts: Record<string, number> = {}
  for (const row of (data || []) as { photo_tag: string | null }[]) {
    const tag = row.photo_tag || 'other_final'
    counts[tag] = (counts[tag] ?? 0) + 1
  }
  return counts
}
