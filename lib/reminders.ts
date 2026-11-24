/**
 * Assignable reminders — the ONE module: the writer (create / done / reopen), the readers (one list function for Today, the
 * record pages and the office view) and the two bells (when assigned, and on the morning it is due).
 *
 * Rules (keep them here, nowhere else):
 *  - `due_on` is a calendar day on the COMPANY's clock (`orgs.timezone`); "today" always comes from `orgTodayYmd`.
 *  - The assignee is any ACTIVE person of the same company. A reminder carries only what its writer typed plus ids — never a
 *    customer's name, phone or address — so a person who cannot open the record still sees only that text, and the link opens
 *    the record through its own access rules.
 *  - A person sees reminders assigned to them or made by them; owner / admin / operations (`canSeeAllReminders`) see everyone's.
 *  - Nothing is deleted: done sets `done_at` (and can be undone).
 *  - Each bell rings once: the notification is inserted FIRST (a unique index on reminder id + type makes a second insert a no-op),
 *    then `assigned_notified_at` / `due_notified_at` is set. A failed insert leaves the claim empty, so the next run retries.
 *  - The person who makes a reminder must be able to open the record it is about (`viewerMaySee`); ids must be real UUIDs.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { orgTodayYmd } from '@/lib/project-tools/org-today'
import type { ThreadViewer } from '@/lib/threads/visibility'
import { isYmd, reminderCanBecomeVisit } from '@/lib/service-plans'
import { isOwnerProfile } from '@/lib/super-admin'
import { orgDb } from '@/lib/supabase/org-db'

export const REMINDER_BODY_MAX = 500
const LIST_LIMIT = 200

export type ReminderRow = {
  id: string
  body: string
  dueOn: string
  assigneeId: string
  assigneeName: string | null
  createdById: string | null
  createdByName: string | null
  doneAt: string | null
  jobId: string | null
  customerId: string | null
  partnerId: string | null
  propertyId: string | null
}

export type ReminderTarget = { jobId?: string | null; customerId?: string | null; partnerId?: string | null; propertyId?: string | null }
export type ReminderInput = ReminderTarget & { assigneeId: string; dueOn: string; body: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** True for a well-formed UUID; anything else is a 400, never a database error. */
export const isReminderId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

const COLUMNS = 'id, body, due_on, assignee_user_id, created_by, done_at, job_id, customer_id, partner_id, property_id'

/** Owner, admin and operations see everyone's reminders; everyone else sees their own (assigned to them or made by them). */
export function canSeeAllReminders(profile: { role?: string | null; is_super_admin?: boolean | null; active?: boolean | null } | null | undefined): boolean {
  if (!profile) return false
  if (isOwnerProfile(profile)) return true
  return profile.active !== false && ['admin', 'operations'].includes(String(profile.role ?? '').toLowerCase())
}

/** Where a reminder opens: the record it is about (the page applies its own access rules). */
export function reminderHref(r: Pick<ReminderRow, 'jobId' | 'customerId' | 'partnerId'>): string | null {
  if (r.jobId) return `/ops/jobs/${r.jobId}`
  if (r.customerId) return `/customers/${r.customerId}`
  if (r.partnerId) return `/referral-partners/${r.partnerId}`
  return null
}

type Fail = { ok: false; status: number; error: string }

/**
 * Checked BEFORE a visit is made from a reminder: it is this company's, the person may finish it (assignee, maker or office —
 * anything else is "Not found"), it is about a customer / property and not a job or partner, and that customer is the one the
 * visit is for. A done reminder passes, so a retried request after a lost answer still works.
 */
export async function checkReminderForVisit(
  admin: SupabaseClient,
  orgId: string,
  actor: { id: string; seesAll: boolean },
  reminderId: unknown,
  customerId: string
): Promise<{ ok: true } | Fail> {
  if (!isReminderId(reminderId)) return { ok: false, status: 400, error: 'Not a valid reminder' }
  const db = orgDb(admin, orgId)
  const { data } = await db.from('reminders').select('assignee_user_id, created_by, job_id, partner_id, customer_id, property_id').eq('id', reminderId).maybeSingle()
  const r = data as { assignee_user_id: string; created_by: string | null; job_id: string | null; partner_id: string | null; customer_id: string | null; property_id: string | null } | null
  if (!r || (!actor.seesAll && r.assignee_user_id !== actor.id && r.created_by !== actor.id)) return { ok: false, status: 404, error: 'Not found' }
  if (!reminderCanBecomeVisit({ jobId: r.job_id, partnerId: r.partner_id, customerId: r.customer_id, propertyId: r.property_id }, true)) {
    return { ok: false, status: 400, error: 'That reminder can’t become a visit' }
  }
  let owner = r.customer_id
  if (!owner && r.property_id) {
    const { data: p } = await db.from('properties').select('customer_id').eq('id', r.property_id).maybeSingle()
    owner = (p as { customer_id: string | null } | null)?.customer_id ?? null
  }
  if (owner !== customerId) return { ok: false, status: 400, error: 'That reminder is about someone else' }
  return { ok: true }
}

export function parseReminderInput(raw: unknown, today: string): { ok: true; input: ReminderInput } | Fail {
  const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const body = typeof b.body === 'string' ? b.body.trim() : ''
  if (!body) return { ok: false, status: 400, error: 'Say what to be reminded about' }
  if (body.length > REMINDER_BODY_MAX) return { ok: false, status: 400, error: `Keep it under ${REMINDER_BODY_MAX} characters` }
  const dueOn = b.dueOn
  if (!isYmd(dueOn)) return { ok: false, status: 400, error: 'Pick a day' }
  if (dueOn < today) return { ok: false, status: 400, error: 'Pick today or a day after' }
  const assigneeId = typeof b.assigneeId === 'string' ? b.assigneeId : ''
  if (!isReminderId(assigneeId)) return { ok: false, status: 400, error: 'Pick who to remind' }
  const id = (k: string): string | null | 'bad' => (b[k] === undefined || b[k] === null || b[k] === '' ? null : isReminderId(b[k]) ? (b[k] as string) : 'bad')
  const target = { jobId: id('jobId'), customerId: id('customerId'), partnerId: id('partnerId'), propertyId: id('propertyId') }
  if (Object.values(target).includes('bad')) return { ok: false, status: 400, error: 'That record is not valid' }
  if (!target.jobId && !target.customerId && !target.partnerId && !target.propertyId) return { ok: false, status: 400, error: 'A reminder needs a job, customer or partner' }
  return { ok: true, input: { assigneeId, dueOn, body, ...(target as ReminderTarget) } }
}

async function namesFor(admin: SupabaseClient, orgId: string, ids: string[]): Promise<Map<string, string | null>> {
  const uniq = Array.from(new Set(ids.filter(Boolean)))
  if (uniq.length === 0) return new Map()
  const { data } = await orgDb(admin, orgId).from('users').select('id, full_name').in('id', uniq)
  return new Map(((data ?? []) as Array<{ id: string; full_name: string | null }>).map((u) => [u.id, u.full_name]))
}

function toRow(r: Record<string, unknown>, names: Map<string, string | null>): ReminderRow {
  return {
    id: String(r.id),
    body: String(r.body),
    dueOn: String(r.due_on),
    assigneeId: String(r.assignee_user_id),
    assigneeName: names.get(String(r.assignee_user_id)) ?? null,
    createdById: (r.created_by as string | null) ?? null,
    createdByName: r.created_by ? (names.get(String(r.created_by)) ?? null) : null,
    doneAt: (r.done_at as string | null) ?? null,
    jobId: (r.job_id as string | null) ?? null,
    customerId: (r.customer_id as string | null) ?? null,
    partnerId: (r.partner_id as string | null) ?? null,
    propertyId: (r.property_id as string | null) ?? null,
  }
}

/** The ONE reader. `viewer` narrows to what that person may see; `all: true` (office) lifts it. Open first, by day; done last. */
export async function listReminders(
  admin: SupabaseClient,
  orgId: string,
  o: { viewerId: string; all?: boolean; assigneeId?: string; target?: ReminderTarget; includeDone?: boolean; dueOnOrBefore?: string; limit?: number }
): Promise<ReminderRow[]> {
  let q = orgDb(admin, orgId).from('reminders').select(COLUMNS)
  if (!o.includeDone) q = q.is('done_at', null)
  if (o.assigneeId) q = q.eq('assignee_user_id', o.assigneeId)
  if (!o.all) q = q.or(`assignee_user_id.eq.${o.viewerId},created_by.eq.${o.viewerId}`)
  if (o.target?.jobId) q = q.eq('job_id', o.target.jobId)
  if (o.target?.customerId) q = q.eq('customer_id', o.target.customerId)
  if (o.target?.partnerId) q = q.eq('partner_id', o.target.partnerId)
  if (o.dueOnOrBefore) q = q.lte('due_on', o.dueOnOrBefore)
  const { data, error } = await q.order('due_on', { ascending: true }).order('created_at', { ascending: true }).limit(o.limit ?? LIST_LIMIT)
  if (error) throw error
  const rows = (data ?? []) as Array<Record<string, unknown>>
  const names = await namesFor(admin, orgId, rows.flatMap((r) => [String(r.assignee_user_id), r.created_by ? String(r.created_by) : '']))
  const out = rows.map((r) => toRow(r, names))
  // Open first (already by day), done after.
  return out.sort((a, b) => Number(!!a.doneAt) - Number(!!b.doneAt))
}

/** Is this person an active member of the company? (The assignee list is the whole company.) */
async function activeMember(admin: SupabaseClient, orgId: string, userId: string): Promise<boolean> {
  const { data } = await orgDb(admin, orgId).from('users').select('id').eq('id', userId).eq('active', true).maybeSingle()
  return !!data
}

/** Every id the reminder names must be this company's row. */
async function targetsExist(admin: SupabaseClient, orgId: string, t: ReminderTarget): Promise<boolean> {
  const db = orgDb(admin, orgId)
  const checks: Array<[string, string | null | undefined]> = [['production_jobs', t.jobId], ['customers', t.customerId], ['referral_partners', t.partnerId], ['properties', t.propertyId]]
  for (const [table, id] of checks) {
    if (!id) continue
    const { data } = await db.from(table).select('id').eq('id', id).maybeSingle()
    if (!data) return false
  }
  return true
}

/**
 * The person making a reminder must be able to open the record it names — the same rules as the record's own page, so a reminder
 * can never be used to probe or attach to a record they cannot see. Job = the job board (owner / admin / job-board people);
 * customer (and a property, through its customer) = `resolveCustomerAccess`; a referral partner is visible to everyone in the
 * company (phone / email are redacted by the partner pages themselves).
 */
export async function viewerMaySee(admin: SupabaseClient, viewer: ThreadViewer, t: ReminderTarget): Promise<boolean> {
  if (t.jobId && !(viewer.ownerLike || viewer.jobBoard)) return false
  const customerIds = new Set<string>()
  if (t.customerId) customerIds.add(t.customerId)
  if (t.propertyId) {
    const { data } = await orgDb(admin, viewer.orgId).from('properties').select('customer_id').eq('id', t.propertyId).maybeSingle()
    const cid = (data as { customer_id: string | null } | null)?.customer_id
    if (!cid) return false
    customerIds.add(cid)
  }
  // Loaded when needed: this module is imported by lib/today.ts, which must not drag the thread / route stack into every page and test.
  const { resolveCustomerAccess } = await import('@/lib/customer-file/customer-access')
  for (const cid of Array.from(customerIds)) {
    const access = await resolveCustomerAccess(admin, viewer, cid)
    if (!access?.read) return false
  }
  return true
}

function bellText(r: { body: string }, dueOn: string, today: string): string {
  const when = dueOn === today ? 'Due today' : dueOn < today ? `Overdue (was due ${dueOn})` : `Due ${dueOn}`
  return `${when}: ${r.body}`.slice(0, 200)
}

/**
 * Ring one bell (+ push). The notification goes in FIRST: the unique index (reminder id + type) turns a second insert into a
 * no-op, and only then is the claim column set — so a failed insert is retried on the next run instead of being lost, and a
 * crash between the two cannot ring twice. A reminder that was due on an earlier day says "overdue", never "due today".
 */
async function ring(admin: SupabaseClient, orgId: string, r: { id: string; assigneeId: string; body: string; dueOn: string; jobId: string | null; customerId: string | null; partnerId: string | null }, kind: 'assigned' | 'due', actor: { id: string; name: string | null } | null, today: string): Promise<boolean> {
  const column = kind === 'assigned' ? 'assigned_notified_at' : 'due_notified_at'
  const link = reminderHref(r) ?? '/today'
  const title = kind === 'assigned' ? `${actor?.name ?? 'Someone'} set a reminder for you` : r.dueOn < today ? 'Reminder overdue' : 'Reminder due today'
  const db = orgDb(admin, orgId)
  const { error } = await db.from('notifications').insert({
    recipient_user_id: r.assigneeId,
    actor_user_id: actor?.id ?? null,
    type: kind === 'assigned' ? 'reminder_assigned' : 'reminder_due',
    title,
    body: bellText(r, r.dueOn, today),
    link_url: link,
    data: { reminder_id: r.id },
  })
  const alreadyRung = error?.code === '23505'
  if (error && !alreadyRung) {
    console.error('[reminders] bell failed', { reminderId: r.id, message: error.message })
    return false
  }
  const { error: claimError } = await db.from('reminders').update({ [column]: new Date().toISOString() }).eq('id', r.id).is(column, null)
  if (claimError) console.error('[reminders] bell claim failed', { reminderId: r.id, message: claimError.message })
  if (alreadyRung) return false
  // Loaded when needed: the push module pulls in a JWT library that lib/today.ts (which imports this file) must not drag into every page and test.
  const { sendPushToUserBackground } = await import('@/lib/push-apns')
  sendPushToUserBackground(r.assigneeId, title, bellText(r, r.dueOn, today), { type: `reminder_${kind}`, url: link })
  return true
}

/** The ONE creator. Returns the new reminder; the assignee gets a bell unless they set it for themselves. */
export async function createReminder(
  admin: SupabaseClient,
  orgId: string,
  actor: { id: string; name: string | null; viewer: ThreadViewer },
  input: ReminderInput,
  now = new Date()
): Promise<{ ok: true; reminder: ReminderRow } | Fail> {
  const today = await orgTodayYmd(admin, orgId, now)
  const parsed = parseReminderInput(input, today)
  if (!parsed.ok) return parsed
  const i = parsed.input
  if (!(await activeMember(admin, orgId, i.assigneeId))) return { ok: false, status: 400, error: 'Pick someone from your company' }
  if (!(await targetsExist(admin, orgId, i))) return { ok: false, status: 404, error: 'Not found' }
  // Same answer as a missing record, so existence is not leaked.
  if (!(await viewerMaySee(admin, actor.viewer, i))) return { ok: false, status: 404, error: 'Not found' }
  const { data, error } = await orgDb(admin, orgId)
    .from('reminders')
    .insert({
      created_by: actor.id,
      assignee_user_id: i.assigneeId,
      due_on: i.dueOn,
      body: i.body,
      job_id: i.jobId ?? null,
      customer_id: i.customerId ?? null,
      partner_id: i.partnerId ?? null,
      property_id: i.propertyId ?? null,
      // Setting one for yourself needs no bell.
      ...(i.assigneeId === actor.id ? { assigned_notified_at: now.toISOString() } : {}),
    })
    .select(COLUMNS)
    .single()
  if (error || !data) {
    console.error('[reminders] create failed', error?.message)
    return { ok: false, status: 500, error: 'Could not save the reminder' }
  }
  const names = await namesFor(admin, orgId, [i.assigneeId, actor.id])
  const reminder = toRow(data as Record<string, unknown>, names)
  if (i.assigneeId !== actor.id) await ring(admin, orgId, reminder, 'assigned', actor, today).catch((e) => console.error('[reminders] assign bell failed', e))
  return { ok: true, reminder }
}

/** Mark done / reopen. The assignee, the one who made it, or the office. */
export async function setReminderDone(
  admin: SupabaseClient,
  orgId: string,
  actor: { id: string; seesAll: boolean },
  reminderId: string,
  done: boolean
): Promise<{ ok: true } | Fail> {
  const db = orgDb(admin, orgId)
  if (!isReminderId(reminderId)) return { ok: false, status: 400, error: 'Not a valid reminder' }
  const { data: r } = await db.from('reminders').select('id, assignee_user_id, created_by').eq('id', reminderId).maybeSingle()
  const row = r as { assignee_user_id: string; created_by: string | null } | null
  // Not yours = the same answer as not found.
  if (!row || (!actor.seesAll && row.assignee_user_id !== actor.id && row.created_by !== actor.id)) return { ok: false, status: 404, error: 'Not found' }
  const { error } = await db
    .from('reminders')
    .update({ done_at: done ? new Date().toISOString() : null, done_by: done ? actor.id : null, updated_at: new Date().toISOString() })
    .eq('id', reminderId)
  if (error) return { ok: false, status: 500, error: 'Could not save' }
  return { ok: true }
}

/** Morning job: ring "due today" once for every open reminder due on or before today (a missed day still rings once). */
export async function notifyDueReminders(admin: SupabaseClient, orgId: string, now = new Date()): Promise<number> {
  const today = await orgTodayYmd(admin, orgId, now)
  const { data, error } = await orgDb(admin, orgId)
    .from('reminders')
    .select(COLUMNS)
    .is('done_at', null)
    .is('due_notified_at', null)
    .lte('due_on', today)
    .limit(500)
  if (error) throw error
  const rows = (data ?? []) as Array<Record<string, unknown>>
  let rung = 0
  for (const r of rows) {
    const row = toRow(r, new Map())
    if (await ring(admin, orgId, row, 'due', null, today)) rung += 1
  }
  return rung
}
