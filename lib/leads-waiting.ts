/**
 * "Leads waiting": inbound leads nobody has touched. ONE rule, used by the Today queue (and so the owner morning email)
 * and by the hourly reminder cron.
 *
 * A lead is untouched when ALL of:
 * - it came in by a website form / webhook (channel 'inbound') or was typed in by hand (channel empty), and its status is still 'new'.
 *   Canvass pins are told apart by `canvass_disposition` (set on every pin) and by a door-knock `source`; they have their own flow.
 * - no call / text / email / visit has been logged on it (activities, the same contact kinds as lib/customer-contact.ts),
 * - and N hours have passed since it arrived or was last handed to a new owner (`ownership_reassigned_at`), whichever is later.
 * N is the company's own (Settings → Lead routing, default 24) in plain hours — business hours are not modelled. Only leads
 * from the last 30 days count; older ones are owner clean-up.
 * Off until the company turns the reminder on, so a company that never does sees nothing change.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { CONTACT_KINDS } from '@/lib/customer-contact'
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

  const { data: contacts, error } = await admin
    .from('activities')
    .select('lead_id')
    .eq('org_id', orgId)
    .in('lead_id', rows.map((r) => r.id))
    .in('type', [...CONTACT_KINDS])
    .is('deleted_at', null)
  if (error) throw error
  const touched = new Set((contacts ?? []).map((c: { lead_id: string }) => c.lead_id))
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
 * same lead — a unique index on notifications(lead_id) for this type makes a repeat or a racing run a no-op). The owner is
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
      body: `${lead.homeowner_name || 'A new lead'} has been waiting ${waitingFor(lead, now)} with no call, text or email logged.`,
      link_url: `/leads/${lead.id}`,
      data: { lead_id: lead.id },
    })
    if (!error) run.notified += 1
    else if (error.code !== '23505') console.error('lead reminder: notification failed', { orgId: org.id, leadId: lead.id, message: error.message })
  }
  return run
}
