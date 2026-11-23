/**
 * Nightly auto-roll + end-of-day nudge (server). Settings: lib/schedule-nightly.ts. Both run from the hourly cron
 * /api/cron/schedule-nightly for companies with `servicePlans` on AND the owner's switch on (default OFF).
 *
 *  - Auto-roll writes NOTHING itself and moves SERVICE VISITS only: every move is the existing `rollWorkOrder` (→ applyVisitAction 'move') with `auto: true`, which logs the move as kind 'auto_roll'. That kind is
 *    never counted as "Rolled N×" (a builder "not ready" roll); it only shows in the move history.
 *  - The nudge is a bell (existing notifications), one per person per company day (unique index), listing work order numbers only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { fromZonedTime } from 'date-fns-tz'

import { hourInZone } from '@/lib/customer-messages'
import { canSeeAllReminders } from '@/lib/reminders'
import { inRunWindow, readNightlySettings } from '@/lib/schedule-nightly'
import { addDaysYmd, SERVICE_VISIT_TYPE, ymdInZone } from '@/lib/service-plans'
import { loadVisits } from '@/lib/service-plans-db'
import { isMissingTable } from '@/lib/supabase/errors'
import { orgDb } from '@/lib/supabase/org-db'
import { loadClockedInUserIds } from '@/lib/time-tracking-db'
import { rollWorkOrder } from '@/lib/work-order-roll'

export type NightlyOrg = { id: string; settings: Record<string, unknown> | null; timezone: string }

/** Work dated further back than this is left for a person (it is probably stale data, not "yesterday's crew"). */
export const AUTO_ROLL_LOOKBACK_DAYS = 30
/** Rolls per company per run. The rest go on the next hourly run. */
export const AUTO_ROLL_CAP = 200
const CHUNK = 200

export type AutoRollResult = { skipped?: 'off' | 'not_time'; error?: true; candidates?: number; rolled?: number; left?: number; failed?: number }

const chunks = <T,>(xs: T[]): T[][] => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, i * CHUNK + CHUNK))
/** Most pages one run reads for one company (a backstop; the cap on ROLLED rows normally ends the loop first). */
const MAX_PAGES = 25

/** The instant the company's calendar day `ymd` starts (DST-safe). */
export const dayStartInstant = (ymd: string, timeZone: string): Date => fromZonedTime(`${ymd}T00:00:00`, timeZone)

type RollRow = { id: string; scheduled_date: string | null }

/**
 * Auto-roll moves SERVICE VISITS only. A trade / install work order is never auto-rolled: subs don't clock, so "no clock
 * time" does not mean "not started" for them — the office or the crew's own "Not ready" button moves those.
 * Rows are read a page at a time in the query (visits only, still scheduled, a passed day inside the lookback) and paged
 * past when skipped (clock time, moved today), so old rows that are skipped forever cannot starve newer ones; the run
 * stops after `cap` rows were ROLLED. A failed clock-time / move-log lookup skips the company for this run (fail closed).
 */
export async function runAutoRollForOrg(admin: SupabaseClient, org: NightlyOrg, now = new Date(), cap = AUTO_ROLL_CAP): Promise<AutoRollResult> {
  const s = readNightlySettings(org.settings?.scheduling).autoRoll
  if (!s.enabled) return { skipped: 'off' }
  if (!inRunWindow(hourInZone(now, org.timezone), s.hour)) return { skipped: 'not_time' }
  const today = ymdInZone(now, org.timezone)
  const db = orgDb(admin, org.id)
  const dayStart = dayStartInstant(today, org.timezone).toISOString()

  let rolled = 0
  let left = 0
  let failed = 0
  let candidates = 0
  // Rolled rows leave the result set (their day is no longer in the past); rows we skip stay, so the next page starts after them.
  let offset = 0
  for (let page = 0; page < MAX_PAGES && rolled < cap; page++) {
    const { data, error } = await db
      .from('work_orders')
      .select('id, scheduled_date')
      .eq('work_order_type', SERVICE_VISIT_TYPE)
      .eq('status', 'scheduled')
      .lt('scheduled_date', today)
      .gte('scheduled_date', addDaysYmd(today, -AUTO_ROLL_LOOKBACK_DAYS))
      .order('scheduled_date')
      .order('id')
      .range(offset, offset + CHUNK - 1)
    if (error) throw error
    const rows = (data ?? []) as RollRow[]
    if (rows.length === 0) break
    candidates += rows.length

    // "Unstarted": nobody clocked time on it. "Nobody moved it today": no move by a person since the company's midnight.
    const ids = rows.map((r) => r.id)
    const started = new Set<string>()
    const movedToday = new Set<string>()
    for (const part of chunks(ids)) {
      const t = await db.from('time_entries').select('work_order_id').in('work_order_id', part).is('removed_at', null)
      if (t.error && !isMissingTable(t.error)) {
        console.error('[schedule-nightly] clock-time lookup failed; skipping company', { orgId: org.id, message: t.error.message })
        return { error: true, candidates, rolled, left, failed }
      }
      if (!t.error) for (const r of (t.data ?? []) as Array<{ work_order_id: string | null }>) if (r.work_order_id) started.add(r.work_order_id)
      const m = await db.from('work_order_moves').select('work_order_id').in('work_order_id', part).neq('kind', 'auto_roll').gte('moved_at', dayStart)
      if (m.error && !isMissingTable(m.error)) {
        console.error('[schedule-nightly] move-log lookup failed; skipping company', { orgId: org.id, message: m.error.message })
        return { error: true, candidates, rolled, left, failed }
      }
      if (!m.error) for (const r of (m.data ?? []) as Array<{ work_order_id: string }>) movedToday.add(r.work_order_id)
    }

    for (const w of rows) {
      if (rolled >= cap) break
      // Work with clock time, or work a person just moved, stays for the office.
      if (started.has(w.id) || movedToday.has(w.id) || !w.scheduled_date) {
        left++
        offset++
        continue
      }
      try {
        const res = await rollWorkOrder(admin, org.id, w.id, { reason: null, by: { userId: null, subId: null }, schedulingUserId: '', expectFrom: w.scheduled_date, now, auto: true })
        if (res.ok) rolled++
        else if (res.status === 409) {
          // The move can be saved and a later plan sync fail (409 with the date already changed): that is still a roll.
          const { data: cur } = await db.from('work_orders').select('scheduled_date').eq('id', w.id).maybeSingle()
          if (cur && (cur as { scheduled_date: string | null }).scheduled_date !== w.scheduled_date) {
            rolled++
            console.error('[schedule-nightly] auto-roll moved the visit but a follow-up sync failed', { orgId: org.id, workOrderId: w.id, error: res.error })
          } else {
            left++ // moved / done / blocked since we read it: nothing to do
            offset++
          }
        } else {
          failed++
          offset++
        }
      } catch (e) {
        failed++
        offset++
        console.error('[schedule-nightly] auto-roll failed', { orgId: org.id, workOrderId: w.id, e })
      }
    }
    if (rows.length < CHUNK) break
  }
  return { candidates, rolled, left, failed }
}

// ── End-of-day nudge ─────────────────────────────────────────────────────────────────────────────────────────────

export type NudgeResult = { skipped?: 'off' | 'not_time' | 'nothing_open'; rung?: number }

/** The bell text: counts and work order numbers only — never a name, address or phone. */
export function nudgeText(visitNumbers: string[], clockedIn: number): { title: string; body: string } {
  const parts: string[] = []
  if (visitNumbers.length) {
    const shown = visitNumbers.slice(0, 6).join(', ')
    parts.push(`${visitNumbers.length} visit${visitNumbers.length === 1 ? '' : 's'} still open (${shown}${visitNumbers.length > 6 ? `, +${visitNumbers.length - 6} more` : ''})`)
  }
  if (clockedIn) parts.push(`${clockedIn} still clocked in`)
  return { title: 'Close out today’s work', body: parts.join(' · ') }
}

export async function runEndOfDayNudgeForOrg(admin: SupabaseClient, org: NightlyOrg, now = new Date(), opts: { timeTracking: boolean }): Promise<NudgeResult> {
  const s = readNightlySettings(org.settings?.scheduling).endOfDay
  if (!s.enabled) return { skipped: 'off' }
  if (!inRunWindow(hourInZone(now, org.timezone), s.hour)) return { skipped: 'not_time' }
  const today = ymdInZone(now, org.timezone)
  const db = orgDb(admin, org.id)

  const open = (await loadVisits(admin, org.id, { from: today, to: today, accessNotes: false })).filter((v) => v.status === 'scheduled')
  const clocked = opts.timeTracking ? await loadClockedInUserIds(admin, org.id) : []
  if (open.length === 0 && clocked.length === 0) return { skipped: 'nothing_open' }

  // Which crews each open clock belongs to, and who leads each crew.
  const crewIds = Array.from(new Set(open.map((v) => v.subId).filter((x): x is string => !!x)))
  const memberRows: Array<{ sub_id: string; user_id: string; is_lead: boolean }> = []
  if (crewIds.length || clocked.length) {
    const a = crewIds.length ? await db.from('crew_members').select('sub_id, user_id, is_lead').in('sub_id', crewIds) : { data: [], error: null }
    const b = clocked.length ? await db.from('crew_members').select('sub_id, user_id, is_lead').in('user_id', clocked) : { data: [], error: null }
    for (const r of [...((a.data ?? []) as typeof memberRows), ...((b.data ?? []) as typeof memberRows)]) memberRows.push(r)
  }
  const crewOfClocked = new Map<string, Set<string>>()
  for (const m of memberRows) if (clocked.includes(m.user_id)) (crewOfClocked.get(m.sub_id) ?? crewOfClocked.set(m.sub_id, new Set()).get(m.sub_id)!).add(m.user_id)
  const leadsOf = new Map<string, Set<string>>()
  for (const m of memberRows) if (m.is_lead) (leadsOf.get(m.sub_id) ?? leadsOf.set(m.sub_id, new Set()).get(m.sub_id)!).add(m.user_id)

  const { data: people } = await db.from('users').select('id, role, is_super_admin, active').eq('active', true)
  const activeIds = new Set<string>()
  const office = new Set<string>()
  for (const u of (people ?? []) as Array<{ id: string; role: string | null; is_super_admin: boolean | null; active: boolean | null }>) {
    activeIds.add(u.id)
    if (canSeeAllReminders(u)) office.add(u.id)
  }

  const numberOf = (v: (typeof open)[number]) => v.workOrderNumber ?? 'Visit'
  const toRing = new Map<string, { visits: string[]; clocked: number }>()
  for (const id of Array.from(office)) toRing.set(id, { visits: open.map(numberOf), clocked: clocked.length })
  for (const subId of Array.from(new Set([...crewIds, ...Array.from(crewOfClocked.keys())]))) {
    const visits = open.filter((v) => v.subId === subId).map(numberOf)
    const n = crewOfClocked.get(subId)?.size ?? 0
    if (visits.length === 0 && n === 0) continue
    for (const lead of Array.from(leadsOf.get(subId) ?? [])) {
      if (!activeIds.has(lead) || toRing.has(lead)) continue // office already got everything
      toRing.set(lead, { visits, clocked: n })
    }
  }

  // Already rung today: checked here as well as by the unique index, so the guard does not rest on the index alone.
  const already = new Set<string>()
  const ringIds = Array.from(toRing.keys())
  for (const part of chunks(ringIds)) {
    const { data: prior, error: priorErr } = await db.from('notifications').select('recipient_user_id, data').eq('type', 'eod_open_work').in('recipient_user_id', part)
    if (priorErr) {
      console.error('[schedule-nightly] bell check failed; skipping company', { orgId: org.id, message: priorErr.message })
      return { rung: 0 }
    }
    for (const r of (prior ?? []) as Array<{ recipient_user_id: string; data: { day?: string } | null }>) if (r.data?.day === today) already.add(r.recipient_user_id)
  }

  let rung = 0
  for (const [userId, what] of Array.from(toRing.entries())) {
    if (already.has(userId)) continue
    const { title, body } = nudgeText(what.visits, what.clocked)
    // The notification goes in FIRST; the unique index (person + company day) turns a second run into a no-op.
    const { error } = await db.from('notifications').insert({
      recipient_user_id: userId,
      actor_user_id: null,
      type: 'eod_open_work',
      title,
      body,
      link_url: what.visits.length ? '/ops/schedule?view=visits' : '/admin/time',
      data: { day: today },
    })
    if (error) {
      if (error.code !== '23505') console.error('[schedule-nightly] bell failed', { orgId: org.id, message: error.message })
      continue
    }
    rung++
    // Loaded when needed: the push module pulls in a JWT library.
    const { sendPushToUserBackground } = await import('@/lib/push-apns')
    sendPushToUserBackground(userId, title, body, { type: 'eod_open_work', url: '/today' })
  }
  return { rung }
}
