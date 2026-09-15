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

import { FILES_BUCKET } from '@/lib/files/storage'
import { addDaysToDateOnly } from '@/lib/install-calendar'
import { ymdInBusinessTz } from '@/lib/calendar-business-tz'
import { CREW_LINK_GRACE_DAYS, calendarDaySpan, type Trade } from '@/lib/job-trades'

/** Enough for a thorough walk-around plus detail shots; stops a leaked link filling storage. */
export const CREW_LINK_MAX_PHOTOS = 80

/**
 * Started-but-never-recorded uploads a job folder may hold before crew uploads
 * are refused. The photo cap only counts recorded photos, so without this a
 * leaked link could mint signed upload URLs forever and never finalize them.
 * A real crew leaves a handful (dropped signal mid-upload); 20 is far past that.
 */
export const CREW_LINK_MAX_UNFINISHED_UPLOADS = 20

/** Storage `list` page size — also a hard ceiling on files in one job's photo folder via a crew link. */
const JOB_PHOTO_FOLDER_SCAN_LIMIT = 1000

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

/**
 * Whether this crew link may start another upload. Returns a refusal message, or
 * null when it may. Counts both recorded photos on the trade and files sitting
 * in the job's photo folder with no `photos` row (registered, never finalized).
 */
export async function crewLinkUploadRefusal(admin: SupabaseClient, ctx: CrewLinkContext): Promise<string | null> {
  const counts = await crewLinkPhotoCounts(admin, ctx)
  if (Object.values(counts).reduce((a, b) => a + b, 0) >= CREW_LINK_MAX_PHOTOS) {
    return 'Photo limit reached for this job — call ARX.'
  }

  const folder = `${ctx.orgId}/jobs/${ctx.jobId}/photos`
  const [{ data: objects, error: listError }, { count: recordedCount, error: countError }] = await Promise.all([
    admin.storage.from(FILES_BUCKET).list(folder, { limit: JOB_PHOTO_FOLDER_SCAN_LIMIT }),
    // Every row, deleted or not: a soft-deleted photo still holds its file.
    admin.from('photos').select('id', { count: 'exact', head: true }).eq('org_id', ctx.orgId).eq('job_id', ctx.jobId),
  ])
  if (listError || countError) {
    // Fail closed: this is a public endpoint; a crew can retry in a moment.
    console.error('[crewLinkUploadRefusal] could not check uploads', listError || countError)
    return 'Couldn’t start the upload — try again.'
  }
  const fileCount = (objects || []).length
  if (fileCount >= JOB_PHOTO_FOLDER_SCAN_LIMIT) return 'Photo limit reached for this job — call ARX.'
  if (fileCount - (recordedCount ?? 0) >= CREW_LINK_MAX_UNFINISHED_UPLOADS) {
    return 'Too many unfinished uploads on this job — call ARX.'
  }
  return null
}
