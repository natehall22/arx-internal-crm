/**
 * "Leads waiting": inbound leads nobody has touched. ONE rule, used by the Today queue (and so the owner morning email)
 * and by the hourly reminder cron.
 *
 * A lead is untouched when ALL of:
 * - it came in by a website form / webhook (channel 'inbound') or was typed in by hand (channel empty), and its status is still 'new'.
 *   Canvass pins are told apart by `canvass_disposition` (set on every pin) and by a door-knock `source`; they have their own flow.
 * - nobody has worked it: no activity written by a person after it was created (note, status change, call, text, email) on the
 *   lead or on its opportunity once one exists,
 * - and N hours have passed since it arrived or was last handed to a new owner (`ownership_reassigned_at`), whichever is later.
 * N is the company's own (Settings → Lead routing, default 24) in plain hours — business hours are not modelled. Only leads
 * from the last 30 days count; older ones are owner clean-up.
 * Off until the company turns the reminder on, so a company that never does sees nothing change.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { fetchSupabaseAllPages, selectIn } from '@/lib/supabase-fetch-all-pages'
import { LEADS_WAITING_WINDOW_DAYS, readLeadIntakeSettings } from '@/lib/lead-intake'
import { CANVASS_DOOR_SOURCES } from '@/lib/canvass-lead-attribution'
import { resolveCompanyRecipient } from '@/lib/company-recipient'
import type { Queue } from '@/lib/today'

const HOUR_MS = 3_600_000
const READ_CAP = 500
const NOTIFY_CAP = 200
/** Only leads that crossed N this recently get the bell, so turning the reminder on never floods people with old leads. */
const NOTIFY_CROSSED_WITHIN_HOURS = 48

export type WaitingLead = {
  id: string
  homeowner_name: string | null
  source: string | null
  service_requested: string | null
  owner_user_id: string | null
  created_at: string
  ownership_reassigned_at: string | null
}

/** When the clock started: arrival, or the later hand-over to a new owner. */
export function leadClockStart(lead: Pick<WaitingLead, 'created_at' | 'ownership_reassigned_at'>): Date {
  const created = new Date(lead.created_at).getTime()
  const reassigned = lead.ownership_reassigned_at ? new Date(lead.ownership_reassigned_at).getTime() : 0
  return new Date(Math.max(created, Number.isFinite(reassigned) ? reassigned : 0))
}

/** The rule on rows already read: past N hours and no contact logged. (Status / channel / window are in the query.) */
export function isLeadUntouched(lead: Pick<WaitingLead, 'created_at' | 'ownership_reassigned_at'>, hasContact: boolean, hours: number, now: Date): boolean {
  if (hasContact) return false
  return now.getTime() - leadClockStart(lead).getTime() >= hours * HOUR_MS
}

/** "5 hours" / "2 days": how long it has waited, in words for a queue line. */
export function waitingFor(lead: Pick<WaitingLead, 'created_at' | 'ownership_reassigned_at'>, now: Date): string {
  const h = Math.max(0, Math.floor((now.getTime() - leadClockStart(lead).getTime()) / HOUR_MS))
  if (h >= 48) return `${Math.floor(h / 24)} days`
  return `${h} hour${h === 1 ? '' : 's'}`
}

/** Activity written within this long of the lead's creation is part of creating it (e.g. the typist's own note), not a follow-up. */
const CREATION_GRACE_MS = 10_000

type ActivityRow = { lead_id: string | null; opportunity_id: string | null; user_id: string | null; origin: string | null; created_at: string }

/**
 * Which of these leads has been worked by a PERSON: any activity written by a user after the lead was created — a note, a
 * status change, a call, text or email — on the lead itself, or on its opportunity once one exists. Automations (no
 * author / origin 'system') and the customer's own portal or text messages (no user) do not count. Reads in chunks of
 * IN_CHUNK ids and pages each chunk, so a big batch neither overflows the URL nor stops at the 1,000-row default.
 * Throws on a failed read — never "nobody touched it".
 */
async function leadsTouchedByAPerson(admin: SupabaseClient, orgId: string, leads: Array<{ id: string; created_at: string }>): Promise<Set<string>> {
  const createdAt = new Map(leads.map((l) => [l.id, new Date(l.created_at).getTime()]))
  const ids = leads.map((l) => l.id)
  const COLS = 'lead_id, opportunity_id, user_id, origin, created_at'
  const paged = <T,>(run: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>) =>
    fetchSupabaseAllPages<T>(run).then((data) => ({ data, error: null }))

  const opps = await selectIn<{ id: string; lead_id: string }>(ids, (chunk) =>
    paged((from, to) => admin.from('opportunities').select('id, lead_id').eq('org_id', orgId).in('lead_id', chunk).order('id').range(from, to))
  )
  const leadOfOpp = new Map(opps.map((o) => [o.id, o.lead_id]))

  const byLead = await selectIn<ActivityRow>(ids, (chunk) =>
    paged((from, to) => admin.from('activities').select(COLS).eq('org_id', orgId).in('lead_id', chunk).is('deleted_at', null).order('id').range(from, to))
  )
  const byOpp = await selectIn<ActivityRow>(Array.from(leadOfOpp.keys()), (chunk) =>
    paged((from, to) => admin.from('activities').select(COLS).eq('org_id', orgId).in('opportunity_id', chunk).is('deleted_at', null).order('id').range(from, to))
  )

  const touched = new Set<string>()
  for (const a of [...byLead, ...byOpp]) {
    const leadId = a.lead_id && createdAt.has(a.lead_id) ? a.lead_id : a.opportunity_id ? leadOfOpp.get(a.opportunity_id) : undefined
    if (!leadId || touched.has(leadId)) continue
    if (!a.user_id || a.origin === 'system' || a.origin === 'customer_portal' || a.origin === 'sms') continue
    if (new Date(a.created_at).getTime() <= (createdAt.get(leadId) ?? 0) + CREATION_GRACE_MS) continue
    touched.add(leadId)
  }
  return touched
}

/** The Today card when the read failed: said out loud, never "no leads waiting". Same id, so it sits in the same place. */
export function leadsWaitingFailedQueue(): Queue {
  return { id: 'leads-waiting', title: 'Leads waiting', count: 0, items: [], empty: 'Leads waiting couldn’t load today.' }
}

/**
 * The company's untouched leads, oldest first, optionally only one person's. `capped` = more than the read cap were
 * candidates (the count is then a floor). Throws on a failed read — a failed query must never look like "all clear".
 */
export async function listUntouchedLeads(
  admin: SupabaseClient,
  orgId: string,
  hours: number,
  now: Date,
  opts: { ownerUserId?: string } = {}
): Promise<{ leads: WaitingLead[]; capped: boolean }> {
  const newest = new Date(now.getTime() - hours * HOUR_MS).toISOString()
  const oldest = new Date(now.getTime() - LEADS_WAITING_WINDOW_DAYS * 24 * HOUR_MS).toISOString()
  let q = admin
    .from('leads')
    .select('id, homeowner_name, source, service_requested, owner_user_id, created_at, ownership_reassigned_at', { count: 'exact' })
    .eq('org_id', orgId)
    .or('channel.eq.inbound,channel.is.null')
    .is('canvass_disposition', null)
    .eq('status', 'new')
    .lte('created_at', newest)
    .gte('created_at', oldest)
    .order('created_at', { ascending: true })
    .limit(READ_CAP)
  if (opts.ownerUserId) q = q.eq('owner_user_id', opts.ownerUserId)
  let res = await q
  if (res.error && /service_requested/.test(res.error.message ?? '')) {
    // Migration 202611230020 not applied yet: the same list without the service column.
    let again = admin
      .from('leads')
      .select('id, homeowner_name, source, owner_user_id, created_at, ownership_reassigned_at', { count: 'exact' })
      .eq('org_id', orgId)
      .or('channel.eq.inbound,channel.is.null')
    .is('canvass_disposition', null)
      .eq('status', 'new')
      .lte('created_at', newest)
      .gte('created_at', oldest)
      .order('created_at', { ascending: true })
      .limit(READ_CAP)
    if (opts.ownerUserId) again = again.eq('owner_user_id', opts.ownerUserId)
    res = (await again) as unknown as typeof res
  }
  if (res.error) throw res.error
  let rows = ((res.data ?? []) as unknown as Array<Partial<WaitingLead> & { id: string; created_at: string }>).map((r) => ({
    service_requested: null,
    homeowner_name: null,
    source: null,
    owner_user_id: null,
    ownership_reassigned_at: null,
    ...r,
  })) as WaitingLead[]
  rows = rows.filter((r) => !(r.source && CANVASS_DOOR_SOURCES.has(r.source)))
  if (rows.length === 0) return { leads: [], capped: false }

  const touched = await leadsTouchedByAPerson(admin, orgId, rows)
  const leads = rows.filter((r) => isLeadUntouched(r, touched.has(r.id), hours, now))
  return { leads, capped: (res.count ?? rows.length) > READ_CAP }
}

/**
 * The "Leads waiting" Today queue. Org-wide for owners; with `ownerUserId` only that person's own leads. Email-safe like
 * every queue here: `ref`/`note` carry the service and how long, never a name, phone or address. Empty (and quiet) while
 * the company's reminder is off.
 */
export async function loadLeadsWaitingQueue(admin: SupabaseClient, orgId: string, now = new Date(), opts: { ownerUserId?: string; cap?: number } = {}): Promise<Queue> {
  const empty: Queue = { id: 'leads-waiting', title: 'Leads waiting', count: 0, items: [], empty: 'No leads are waiting.' }
  const { data } = await admin.from('orgs').select('settings').eq('id', orgId).maybeSingle()
  const settings = readLeadIntakeSettings((data as { settings?: unknown } | null)?.settings)
  if (!settings.reminderEnabled) return empty
  const { leads, capped } = await listUntouchedLeads(admin, orgId, settings.reminderHours, now, { ownerUserId: opts.ownerUserId })
  const cap = opts.cap ?? 8
  return {
    ...empty,
    title: capped ? 'Leads waiting (oldest 500 checked)' : 'Leads waiting',
    count: leads.length,
    items: leads.slice(0, cap).map((l) => {
      const what = l.service_requested || (l.source ? l.source : 'New lead')
      const note = [`no contact logged for ${waitingFor(l, now)}`, l.owner_user_id ? null : 'nobody assigned'].filter(Boolean).join(' · ')
      return { id: l.id, title: l.homeowner_name || 'New lead', detail: `${what} · ${note}`, href: `/leads/${l.id}`, ref: what, note }
    }),
  }
}

export type LeadReminderRun = { orgId: string; considered: number; notified: number }

/**
 * Hourly, one company: one bell notification to a lead's owner the first time it has waited N hours (never again for the
 * same lead AND owner — a unique index on notifications(lead_id, recipient) for this type makes a repeat or a racing run a no-op,
 * while a lead handed to a new owner reminds that new owner once). The owner is
 * the lead's owner if still an active user of this company, else the company's longest-standing active admin.
 */
export async function runLeadReminderForOrg(admin: SupabaseClient, org: { id: string; settings: unknown }, now: Date): Promise<LeadReminderRun> {
  const settings = readLeadIntakeSettings(org.settings)
  const run: LeadReminderRun = { orgId: org.id, considered: 0, notified: 0 }
  if (!settings.reminderEnabled) return run
  const { leads } = await listUntouchedLeads(admin, org.id, settings.reminderHours, now)
  const recent = leads
    .filter((l) => now.getTime() - leadClockStart(l).getTime() - settings.reminderHours * HOUR_MS <= NOTIFY_CROSSED_WITHIN_HOURS * HOUR_MS)
    .slice(0, NOTIFY_CAP)
  run.considered = recent.length
  for (const lead of recent) {
    const recipient = await resolveCompanyRecipient(admin, org.id, [lead.owner_user_id], 'lead_waiting')
    if (!recipient) continue
    const { error } = await admin.from('notifications').insert({
      org_id: org.id,
      recipient_user_id: recipient.id,
      type: 'lead_waiting',
      title: 'Lead waiting',
      body: `${lead.homeowner_name || 'A new lead'} has been waiting ${waitingFor(lead, now)} with nothing logged.`,
      link_url: `/leads/${lead.id}`,
      data: { lead_id: lead.id },
    })
    if (!error) run.notified += 1
    else if (error.code !== '23505') console.error('lead reminder: notification failed', { orgId: org.id, leadId: lead.id, message: error.message })
  }
  return run
}
