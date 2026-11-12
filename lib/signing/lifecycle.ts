/**
 * Lifecycle (server only): resend, remind, extend, void, decline, "opened" — the things that happen to a document between
 * "sent" and "signed". Each is ONE function used by every caller (office routes, the reminder cron, the signing pages), each
 * writes with a conditional update (a second click / a race changes nothing twice) and each leaves an event.
 *
 * Rules that never bend: a contract / change order is VOIDED, never deleted; a signed one is never voided or declined here
 * (cancelling a sold job has its own path); the document row's own status stays the truth its readers filter on.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { tryOrgAppUrl } from '@/lib/company-links'
import { renderCustomerEmail } from '@/lib/customer-email-layout'
import { getDocumentBrand } from '@/lib/org-brand'
import { emailCompanyFromBrand } from '@/lib/signing/complete'
import { documentTitle, ensureEnvelope, loadDocRow, patchEnvelope } from '@/lib/signing/envelope'
import { latestEventAt, recordSigningEvent } from '@/lib/signing/events'
import { sendSigningEmail } from '@/lib/signing/mail'
import { loadSigningSettings } from '@/lib/signing/settings-server'
import { EXTEND_DAYS_RANGE } from '@/lib/signing/settings'
import { newSigningTokenColumns, SIGNING_TABLES, signingTokenOf } from '@/lib/signing-tokens'
import type { EnvelopeRow, SigningKind } from '@/lib/signing/types'

type DocRow = Record<string, any>

export type LifecycleFailure =
  | 'not_found' | 'not_open' | 'not_ready' | 'no_email' | 'too_soon' | 'no_link' | 'reason_required' | 'bad_days' | 'send_failed' | 'error'
export type LifecycleResult<T = {}> = ({ ok: true } & T) | { ok: false; reason: LifecycleFailure; message: string }

const FAIL_TEXT: Record<LifecycleFailure, string> = {
  not_found: 'That document was not found.',
  not_open: 'This document is not waiting for a signature any more.',
  not_ready: 'Signing records are not set up yet.',
  no_email: 'There is no email address on file for the customer. Copy the link and send it yourself.',
  too_soon: 'A message about this document just went out. Give it a few minutes.',
  no_link: 'A working signing link could not be made.',
  reason_required: 'Please give a reason (a few words is enough).',
  bad_days: `Extend by ${EXTEND_DAYS_RANGE.min} to ${EXTEND_DAYS_RANGE.max} days.`,
  send_failed: 'The email could not be sent. Try again, or copy the link.',
  error: 'Something went wrong. Nothing was changed.',
}
const fail = (reason: LifecycleFailure): { ok: false; reason: LifecycleFailure; message: string } => ({ ok: false, reason, message: FAIL_TEXT[reason] })

/** A message about the same document at most this often (a double tap, two staff). */
export const MIN_GAP_MS = 5 * 60 * 1000
const MAX_REASON = 500

export const cleanReason = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.length >= 3 ? s.slice(0, MAX_REASON) : null
}

async function openDoc(admin: SupabaseClient, kind: SigningKind, orgId: string, docId: string): Promise<{ row: DocRow; env: EnvelopeRow } | LifecycleFailure> {
  const row = await loadDocRow(admin, kind, orgId, docId)
  if (!row) return 'not_found'
  const env = await ensureEnvelope(admin, kind, row)
  if (env === 'not_ready') return 'not_ready'
  return { row, env }
}

const isPending = (row: DocRow) => row.status === 'pending_customer'
const isExpired = (row: DocRow, now = new Date()) => !row.token_expires_at || new Date(row.token_expires_at).getTime() <= now.getTime()

// ── extend ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Push the link's date out (from now when it already passed, else from its current date). */
export async function extendEnvelope(
  admin: SupabaseClient,
  a: { kind: SigningKind; orgId: string; docId: string; days: number; actor: { userId: string | null; name?: string | null } }
): Promise<LifecycleResult<{ expiresAt: string }>> {
  if (!Number.isInteger(a.days) || a.days < EXTEND_DAYS_RANGE.min || a.days > EXTEND_DAYS_RANGE.max) return fail('bad_days')
  const o = await openDoc(admin, a.kind, a.orgId, a.docId)
  if (typeof o === 'string') return fail(o)
  if (!isPending(o.row)) return fail('not_open')
  const now = Date.now()
  const from = isExpired(o.row) ? now : new Date(o.row.token_expires_at).getTime()
  const expiresAt = new Date(from + a.days * 86400000).toISOString()
  const { data, error } = await admin
    .from(SIGNING_TABLES[a.kind])
    .update({ token_expires_at: expiresAt })
    .eq('id', a.docId)
    .eq('org_id', a.orgId)
    .eq('status', 'pending_customer')
    .select('id')
  if (error) return fail('error')
  if (!data || data.length === 0) return fail('not_open')
  await recordSigningEvent(admin, { org_id: a.orgId, envelope_id: o.env.id, doc_kind: a.kind, doc_id: a.docId, event: 'extended', actor_type: 'staff', actor_user_id: a.actor.userId, actor_name: a.actor.name ?? null, meta: { from: o.row.token_expires_at ?? null, to: expiresAt, days: a.days } })
  return { ok: true, expiresAt }
}

// ── invitation email (resend + reminder) ──────────────────────────────────────────────────────────────────────────

/** A working link for this document: its own token, else a new one (the old link then stops working). */
async function signingLinkFor(admin: SupabaseClient, kind: SigningKind, row: DocRow): Promise<string | null> {
  let token = signingTokenOf(row)
  if (!token) {
    const { token: fresh, columns } = newSigningTokenColumns(kind)
    const { data } = await admin.from(SIGNING_TABLES[kind]).update(columns).eq('id', row.id).eq('org_id', row.org_id).eq('status', 'pending_customer').select('id')
    if (!data || data.length === 0) return null
    token = fresh
  }
  const base = await tryOrgAppUrl(row.org_id, 'signing resend')
  if (!base) return null
  return `${base}${kind === 'contract' ? '/contracts/sign/' : '/change-orders/sign/'}${token}`
}

/** "Questions? Call … or email …" with only what the company has on file; nothing at all when it has neither. */
function contactLine(brand: { phone?: string | null; email?: string | null }): string | undefined {
  const phone = String(brand.phone ?? '').trim()
  const email = String(brand.email ?? '').trim()
  if (phone && email) return `Questions? Call ${phone} or email ${email}.`
  if (phone) return `Questions? Call ${phone}.`
  if (email) return `Questions? Email ${email}.`
  return undefined
}

export type InvitationVariant = 'resend' | 'reminder'

async function sendInvitation(admin: SupabaseClient, a: { kind: SigningKind; row: DocRow; env: EnvelopeRow; variant: InvitationVariant }): Promise<'sent' | 'no_email' | 'no_link' | 'send_failed'> {
  const to = String(a.row.customer_email ?? '').trim()
  if (!to) return 'no_email'
  const url = await signingLinkFor(admin, a.kind, a.row)
  if (!url) return 'no_link'
  const brand = await getDocumentBrand(admin, a.row.org_id)
  const title = documentTitle(a.kind, a.row)
  // Re-read: a resend may just have extended the link.
  const row = (await loadDocRow(admin, a.kind, a.row.org_id, a.row.id)) ?? a.row
  const until = row.token_expires_at ? new Date(row.token_expires_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : ''
  const name = String(a.row.customer_name || a.row.customer_print_name || '').trim()
  const reminder = a.variant === 'reminder'
  const rendered = renderCustomerEmail({
    company: emailCompanyFromBrand(brand),
    heading: reminder ? `Reminder: your ${title} is waiting for your signature` : `Your ${title} is ready to sign`,
    paragraphs: [
      `${name ? `Hi ${name}, ` : ''}${reminder ? 'a quick reminder that ' : ''}your ${title} is ready for your review and signature. It takes a couple of minutes on your phone.`,
      until ? `This link works until ${until}.` : '',
    ].filter(Boolean),
    rows: [{ label: 'Project', value: String(a.row.project_address ?? '') }],
    button: { label: 'Review & sign', href: url },
    footnote: contactLine(brand),
    unsubscribeUrl: null,
  })
  const ok = await sendSigningEmail({
    to,
    subject: reminder ? `Reminder: ${title} — ${brand.casualName}` : `${brand.casualName} - Your ${title} is ready to sign`,
    text: rendered.text,
    html: rendered.html,
  }, a.row.org_id)
  return ok ? 'sent' : 'send_failed'
}

/** The office sends the signing link again. An expired link is extended first (by the company's usual days). */
export async function resendEnvelope(
  admin: SupabaseClient,
  a: { kind: SigningKind; orgId: string; docId: string; actor: { userId: string | null; name?: string | null } }
): Promise<LifecycleResult<{ extended: boolean }>> {
  return sendAgain(admin, a, 'resend')
}

/** The office sends a reminder now (same link, "reminder" wording, counted in the event record as a reminder). */
export async function remindEnvelopeNow(
  admin: SupabaseClient,
  a: { kind: SigningKind; orgId: string; docId: string; actor: { userId: string | null; name?: string | null } }
): Promise<LifecycleResult<{ extended: boolean }>> {
  return sendAgain(admin, a, 'reminder')
}

async function sendAgain(
  admin: SupabaseClient,
  a: { kind: SigningKind; orgId: string; docId: string; actor: { userId: string | null; name?: string | null } },
  variant: InvitationVariant
): Promise<LifecycleResult<{ extended: boolean }>> {
  const o = await openDoc(admin, a.kind, a.orgId, a.docId)
  if (typeof o === 'string') return fail(o)
  if (!isPending(o.row)) return fail('not_open')
  if (!String(o.row.customer_email ?? '').trim()) return fail('no_email')
  const last = await latestEventAt(admin, a.orgId, o.env.id, ['sent', 'resent', 'reminder_sent'])
  if (last && Date.now() - last < MIN_GAP_MS) return fail('too_soon')
  let extended = false
  if (isExpired(o.row)) {
    const settings = await loadSigningSettings(admin, a.orgId)
    const ext = await extendEnvelope(admin, { ...a, days: settings.extendDays })
    if (!ext.ok) return ext
    extended = true
  }
  const sent = await sendInvitation(admin, { kind: a.kind, row: o.row, env: o.env, variant })
  if (sent !== 'sent') return fail(sent)
  await recordSigningEvent(admin, { org_id: a.orgId, envelope_id: o.env.id, doc_kind: a.kind, doc_id: a.docId, event: variant === 'reminder' ? 'reminder_sent' : 'resent', actor_type: 'staff', actor_user_id: a.actor.userId, actor_name: a.actor.name ?? null, actor_email: String(o.row.customer_email), meta: { extended, manual: true } })
  return { ok: true, extended }
}

// ── void ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The office takes a document back. Voided, never deleted; its link stops working at once; a reason is required. */
export async function voidEnvelope(
  admin: SupabaseClient,
  a: { kind: SigningKind; orgId: string; docId: string; reason: unknown; actor: { userId: string | null; name?: string | null } }
): Promise<LifecycleResult> {
  const reason = cleanReason(a.reason)
  if (!reason) return fail('reason_required')
  const o = await openDoc(admin, a.kind, a.orgId, a.docId)
  if (typeof o === 'string') return fail(o)
  if (!isPending(o.row)) return fail('not_open')
  const { data, error } = await admin
    .from(SIGNING_TABLES[a.kind])
    .update({ status: 'voided', updated_at: new Date().toISOString() })
    .eq('id', a.docId)
    .eq('org_id', a.orgId)
    .eq('status', 'pending_customer')
    .select('id')
  if (error) return fail('error')
  if (!data || data.length === 0) return fail('not_open')
  const at = new Date().toISOString()
  await patchEnvelope(admin, o.env, { status: 'voided', voided_at: at, void_reason: reason, voided_by: a.actor.userId }, { status: ['sent', 'viewed'] })
  await recordSigningEvent(admin, { org_id: a.orgId, envelope_id: o.env.id, doc_kind: a.kind, doc_id: a.docId, event: 'voided', actor_type: 'staff', actor_user_id: a.actor.userId, actor_name: a.actor.name ?? null, meta: { reason } })
  await note(admin, a.kind, o.row, `${documentTitle(a.kind, o.row)} voided${a.actor.name ? ` by ${a.actor.name}` : ''}: ${reason}`)
  await releaseSelection(admin, a.kind, o.row, 'was voided')
  return { ok: true }
}

/**
 * A change order that came from a customer's selection ends (voided by the office, or declined): its link is dead for good
 * (tokens cleared, so no page ever offers it) and the selection is released from it, so the selection reads "needs attention"
 * and staff can reissue a fresh change order or cancel the pick (lib/project-tools/selections-db.ts). Best effort, own company only.
 */
async function releaseSelection(admin: SupabaseClient, kind: SigningKind, row: DocRow, why: string): Promise<void> {
  if (kind !== 'change-order') return
  try {
    const { data } = await admin.from('job_selections').select('id').eq('org_id', row.org_id).eq('change_order_id', row.id).eq('status', 'chosen')
    if (!data || data.length === 0) return
    await admin.from('job_change_orders').update({ signing_token: null, signing_token_hash: null, signing_token_enc: null }).eq('id', row.id).eq('org_id', row.org_id).eq('status', 'voided')
    await admin.from('job_selections').update({ change_order_id: null, updated_at: new Date().toISOString() }).eq('org_id', row.org_id).eq('change_order_id', row.id).eq('status', 'chosen')
    await note(admin, kind, row, `Selection needs attention: its change order ${why}. Reissue it or cancel the pick.`)
  } catch (e) {
    // A deployment without the selections tables (or a read that failed) must never undo the void/decline.
    console.error('[signing] selection release failed', e)
  }
}

/** The in-app deal note (the job feed). Best effort: a note that fails never undoes what it describes. */
async function note(admin: SupabaseClient, kind: SigningKind, row: DocRow, body: string): Promise<void> {
  try {
    if (kind === 'contract' && row.opportunity_id) {
      await admin.from('activities').insert({ org_id: row.org_id, opportunity_id: row.opportunity_id, user_id: row.created_by ?? null, type: 'note', body })
    } else if (kind === 'change-order' && row.project_id) {
      await admin.from('activities').insert({ org_id: row.org_id, project_id: row.project_id, user_id: row.created_by ?? null, type: 'note', body })
    }
  } catch (e) {
    console.error('[signing] deal note failed', e)
  }
}

// ── decline (the signer) ──────────────────────────────────────────────────────────────────────────────────────────

/** The customer says "I can't sign this" and why. The document is voided (kept), the office sees the reason. */
export async function declineEnvelope(
  admin: SupabaseClient,
  a: { kind: SigningKind; row: DocRow; reason: unknown; ip: string | null; userAgent: string | null }
): Promise<LifecycleResult> {
  const reason = cleanReason(a.reason)
  if (!reason) return fail('reason_required')
  const settings = await loadSigningSettings(admin, a.row.org_id)
  if (!settings.declineEnabled) return fail('not_open')
  const o = await openDoc(admin, a.kind, a.row.org_id, a.row.id)
  if (typeof o === 'string') return fail(o)
  if (!isPending(o.row) || isExpired(o.row)) return fail('not_open')
  const nowIso = new Date().toISOString()
  const { data, error } = await admin
    .from(SIGNING_TABLES[a.kind])
    .update({ status: 'voided', updated_at: nowIso })
    .eq('id', a.row.id)
    .eq('org_id', a.row.org_id)
    .eq('status', 'pending_customer')
    .gt('token_expires_at', nowIso)
    .select('id')
  if (error) return fail('error')
  if (!data || data.length === 0) return fail('not_open')
  const name = String(o.row.customer_name || o.row.customer_print_name || '')
  await patchEnvelope(admin, o.env, { status: 'declined', declined_at: nowIso, decline_reason: reason }, { status: ['sent', 'viewed'] })
  await recordSigningEvent(admin, { org_id: a.row.org_id, envelope_id: o.env.id, doc_kind: a.kind, doc_id: a.row.id, event: 'declined', signer_key: 'customer', actor_type: 'signer', actor_name: name, actor_email: o.row.customer_email ?? null, ip: a.ip, user_agent: a.userAgent, meta: { reason } })
  const title = documentTitle(a.kind, o.row)
  await note(admin, a.kind, o.row, `${name || 'The customer'} declined to sign ${title}: ${reason}`)
  await releaseSelection(admin, a.kind, o.row, 'was declined by the customer')
  if (settings.emails.declineNotice) await notifyDecline(admin, { row: o.row, title, name, reason })
  return { ok: true }
}

async function notifyDecline(admin: SupabaseClient, a: { row: DocRow; title: string; name: string; reason: string }): Promise<void> {
  try {
    const to = new Set<string>()
    if (a.row.created_by) {
      const { data } = await admin.from('users').select('email').eq('id', a.row.created_by).eq('org_id', a.row.org_id).maybeSingle()
      const e = String((data as { email?: string } | null)?.email ?? '').trim()
      if (e) to.add(e)
    }
    const { data: org } = await admin.from('orgs').select('email').eq('id', a.row.org_id).maybeSingle()
    const oe = String((org as { email?: string } | null)?.email ?? '').trim()
    if (oe) to.add(oe)
    if (to.size === 0) return
    const brand = await getDocumentBrand(admin, a.row.org_id)
    const rendered = renderCustomerEmail({
      company: emailCompanyFromBrand(brand),
      heading: `${a.title} was declined`,
      paragraphs: [`${a.name || 'The customer'} chose not to sign ${a.title}.`, `Their reason: ${a.reason}`],
      rows: [{ label: 'Project', value: String(a.row.project_address ?? '') }],
      unsubscribeUrl: null,
    })
    await sendSigningEmail({ to: Array.from(to), subject: `Declined: ${a.title} — ${a.name || 'customer'}`, text: rendered.text, html: rendered.html }, a.row.org_id)
  } catch (e) {
    console.error('[signing] decline notice failed', e)
  }
}

// ── opened ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The signer opened the page (a beacon from the page, not the server render, so a mail scanner's prefetch is not "opened"). */
export async function markViewed(admin: SupabaseClient, a: { kind: SigningKind; row: DocRow; ip: string | null; userAgent: string | null }): Promise<void> {
  if (!isPending(a.row) || isExpired(a.row)) return
  const env = await ensureEnvelope(admin, a.kind, a.row)
  if (env === 'not_ready') return
  if (env.status === 'sent') await patchEnvelope(admin, env, { status: 'viewed', first_viewed_at: new Date().toISOString() }, { status: ['sent'] })
  await recordSigningEvent(admin, { org_id: a.row.org_id, envelope_id: env.id, doc_kind: a.kind, doc_id: a.row.id, event: 'viewed', signer_key: 'customer', actor_type: 'signer', actor_name: String(a.row.customer_name ?? ''), ip: a.ip, user_agent: a.userAgent })
}

// ── reminders (cron) ──────────────────────────────────────────────────────────────────────────────────────────────

/** How many of the company's reminder days have passed since the document was sent. Pure. */
export function reminderIndexDue(days: readonly number[], sentAtIso: string | null, now: Date): number {
  if (!sentAtIso) return 0
  const elapsedDays = (now.getTime() - new Date(sentAtIso).getTime()) / 86400000
  return days.filter((d) => elapsedDays >= d).length
}

/** Company-local hour (0–23). Reminders go out in the daytime only. */
export function localHour(now: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone }).format(now)
  return Number(h) % 24
}
export const REMINDER_HOURS = { from: 9, to: 18 }

export type ReminderRun = { orgId: string; considered: number; sent: number; skipped?: 'off' | 'night' | 'not_ready' }

/** One company's due reminders. Idempotent: the count is claimed (conditional on the old count) BEFORE the email. */
export async function runSigningRemindersForOrg(admin: SupabaseClient, org: { id: string; timezone: string }, now = new Date()): Promise<ReminderRun> {
  const settings = await loadSigningSettings(admin, org.id)
  if (!settings.reminders.enabled) return { orgId: org.id, considered: 0, sent: 0, skipped: 'off' }
  const hour = localHour(now, org.timezone)
  if (hour < REMINDER_HOURS.from || hour >= REMINDER_HOURS.to) return { orgId: org.id, considered: 0, sent: 0, skipped: 'night' }
  let considered = 0
  let sent = 0
  for (const kind of ['contract', 'change-order'] as const) {
    const { data } = await admin
      .from(SIGNING_TABLES[kind])
      .select('*')
      .eq('org_id', org.id)
      .eq('status', 'pending_customer')
      .gt('token_expires_at', now.toISOString())
    for (const row of (data ?? []) as DocRow[]) {
      if (!String(row.customer_email ?? '').trim()) continue
      const env = await ensureEnvelope(admin, kind, row)
      if (env === 'not_ready') return { orgId: org.id, considered, sent, skipped: 'not_ready' }
      if (env.status !== 'sent' && env.status !== 'viewed') continue
      considered++
      const due = reminderIndexDue(settings.reminders.days, env.sent_at, now)
      if (due <= env.reminder_count) continue
      // Claim first: only the run that moves the count from N to `due` sends. Missed days are skipped, never sent in a burst.
      const { data: claimed } = await admin
        .from('signing_envelopes')
        .update({ reminder_count: due, last_reminder_at: now.toISOString(), updated_at: now.toISOString() })
        .eq('id', env.id)
        .eq('org_id', org.id)
        .eq('reminder_count', env.reminder_count)
        .select('id')
      if (!claimed || claimed.length === 0) continue
      const result = await sendInvitation(admin, { kind, row, env, variant: 'reminder' })
      if (result === 'sent') {
        sent++
        await recordSigningEvent(admin, { org_id: org.id, envelope_id: env.id, doc_kind: kind, doc_id: row.id, event: 'reminder_sent', actor_type: 'system', actor_email: row.customer_email, meta: { number: due } })
      } else {
        // Not sent: give the claim back so the next hourly run tries again.
        await admin.from('signing_envelopes').update({ reminder_count: env.reminder_count }).eq('id', env.id).eq('org_id', org.id).eq('reminder_count', due)
      }
    }
  }
  return { orgId: org.id, considered, sent }
}
