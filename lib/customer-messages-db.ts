/**
 * Automatic customer messages — THE sender (server only). Rules + words: lib/customer-messages.ts. Channels:
 * lib/customer-message-channels.ts. Schema: migration 202611120050 (`customer_messages`, `customer_message_suppressions`,
 * `customers.messages_off_at`).
 *
 * How a message goes out (every kind, the same path):
 *   1. something makes it due — the scheduled run finds a visit day / quote / invoice that reached its day
 *      (`runCustomerMessagesForOrg`), or an event queues it (`notifyVisitOnTheWay`, `queueVisitDone`);
 *   2. a `customer_messages` row is INSERTED with its key (unique per company) — a key that already exists means the
 *      message was already handled, whatever its status, so nothing is ever sent twice;
 *   3. `deliver` claims the row (conditional update queued|failed → sending), RE-CHECKS that it is still true (the visit
 *      is still on that day and not skipped, the quote is still unsigned, the invoice still open, the customer not opted
 *      out, the address not suppressed), renders it, sends it, and records sent / failed / skipped / cancelled.
 * A row stuck in `sending` (the process died mid-send) is closed as failed and NEVER retried — it may have gone out.
 *
 * Who it runs for: the cron (/api/cron/customer-messages, every 15 min) loops `loadCronOrgs` (lib/cron-orgs.ts); a
 * company is skipped unless the `customerMessages` switch is on AND at least one message is turned on. Days and hours are
 * the company's own (`orgs.timezone`); nothing is sent in quiet hours except "on the way".
 */
import { createHash, createHmac } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import { tryOrgAppUrl } from '@/lib/company-links'
import { channelSender, normalizeEmail, type MessageChannelSender } from '@/lib/customer-message-channels'
import type { EmailCompany } from '@/lib/customer-email-layout'
import {
  CUSTOMER_MESSAGES_SETTINGS_KEY,
  DONE_DELAY_MINUTES,
  DONE_EXPIRES_HOURS,
  MAX_PER_ADDRESS_PER_DAY,
  MAX_SEND_ATTEMPTS,
  MAX_SENDS_PER_RUN,
  ON_THE_WAY_EXPIRES_MINUTES,
  PHOTO_LINK_DAYS,
  anyMessageOn,
  dueStep,
  hourInZone,
  isQuietHour,
  messageKey,
  readCustomerMessageSettings,
  renderInvoiceReminder,
  renderOnTheWay,
  renderQuoteFollowUp,
  renderVisitDone,
  renderVisitReminder,
  visitReminderRange,
  visitReminderTiming,
  type CustomerMessageSettings,
  type MessageChannel,
  type MessageContext,
  type MessageKind,
  type RenderedMessage,
} from '@/lib/customer-messages'
import { orgLogoHref } from '@/lib/files/files-object'
import { findOrgInvoice } from '@/lib/invoices'
import { loadInvoiceDocument } from '@/lib/invoice-document'
import type { JobInvoice } from '@/lib/types/invoices'
import { formatPhone } from '@/lib/format'
import { loadOrgFeatures } from '@/lib/org-features'
import { resolveOrgProfile, t } from '@/lib/org-profile'
import { daysBetweenYmd, ymdInZone } from '@/lib/payroll-week-schedule'
import { SERVICE_STEP, SERVICE_VISIT_TYPE } from '@/lib/service-plans'
import { signingTokenOf } from '@/lib/signing-tokens'
import { orgDb } from '@/lib/supabase/org-db'
import { isMissingColumn, isMissingTable } from '@/lib/supabase/errors'
import { orgTimeZone } from '@/lib/timezone'
import { listUnsignedProposals, type Queue as TodayQueue } from '@/lib/today'

const ROW_COLS =
  'id, org_id, message_key, kind, channel, status, customer_id, to_address, refs, send_after, expires_at, attempts, claimed_at, sent_at, skip_reason, last_error, created_at'
/** A row claimed longer ago than this died mid-send. */
const STALE_SENDING_MS = 15 * 60_000
const PAGE = 1000
const CHUNK = 200
const KEY_CHUNK = 50

export type MessageRow = {
  id: string
  org_id: string
  message_key: string
  kind: MessageKind
  channel: MessageChannel
  status: 'queued' | 'sending' | 'sent' | 'skipped' | 'cancelled' | 'failed' | 'blocked'
  customer_id: string | null
  to_address: string | null
  refs: Record<string, unknown>
  send_after: string
  expires_at: string | null
  attempts: number
  claimed_at: string | null
  sent_at: string | null
  skip_reason: string | null
  last_error: string | null
  created_at: string
}

// ── Company context ─────────────────────────────────────────────────────────────────────────────────────────────────

type OrgRow = { id: string; name?: string | null; address?: string | null; phone?: string | null; email?: string | null; settings?: Record<string, unknown> | null; timezone?: string | null; logo_url?: string | null }

export type SendContext = {
  admin: SupabaseClient
  orgId: string
  timeZone: string
  now: Date
  today: string
  hour: number
  settings: CustomerMessageSettings
  company: EmailCompany
  /** The company's own sender (name + email). */
  from: { name: string; address: string }
  replyTo: string | null
  appUrl: string
  proposalWord: string
  channel: MessageChannelSender
  /** Set when the company can't send yet (what to fix, in plain words): every due row is marked 'blocked' instead. */
  blocked: BlockReason | null
  /** Sends left in this run. */
  budget: { left: number }
  stats: RunStats
}

export type RunStats = { sent: number; skipped: number; cancelled: number; failed: number; queued: number; deferred: number; blocked: number }

const emptyStats = (): RunStats => ({ sent: 0, skipped: 0, cancelled: 0, failed: 0, queued: 0, deferred: 0, blocked: 0 })

/** The company's message settings (`orgs.settings.customerMessages`), all OFF when nothing is saved. */
export function messageSettingsOf(settings: Record<string, unknown> | null | undefined): CustomerMessageSettings {
  return readCustomerMessageSettings((settings ?? {})[CUSTOMER_MESSAGES_SETTINGS_KEY])
}

const present = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Why a company can't send customer emails (each one a fix the owner makes in Settings → Company settings). */
export type BlockReason = 'missing_company_name' | 'missing_company_email' | 'missing_company_address'

export const BLOCK_REASON_TEXT: Record<BlockReason, string> = {
  missing_company_name: 'Add your company name in Settings → Company settings: emails go out under it.',
  missing_company_email: 'Add your company email in Settings → Company settings: emails are sent from it and replies go to it.',
  missing_company_address: 'Add your business address in Settings → Company settings: the law requires a postal address in these emails.',
}

/**
 * The company's identity in a customer email, read ONLY from its own row — name, email, postal address and phone are
 * `orgs` columns, website `settings.brand.website` — never a fallback (no other company's values can ever appear, whatever
 * the deployment). `missing` = required fields that are blank: nothing is sent until they are filled.
 */
export function companyIdentity(org: OrgRow, appUrl: string | null): { company: EmailCompany; from: { name: string; address: string }; missing: BlockReason[] } {
  const brand = (org.settings?.brand ?? {}) as Record<string, unknown>
  const name = present(org.name)
  const email = normalizeEmail(org.email) ?? ''
  const addressLine = present(org.address)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(', ')
  const missing: BlockReason[] = []
  if (!name) missing.push('missing_company_name')
  if (!email) missing.push('missing_company_email')
  if (!addressLine) missing.push('missing_company_address')
  return {
    company: {
      name,
      phone: present(org.phone) ? formatPhone(present(org.phone)) : '',
      email,
      website: present(brand.website),
      addressLine,
      logoUrl: appUrl ? orgLogoHref(org.id, org as Parameters<typeof orgLogoHref>[1], { appUrl }) : null,
    },
    from: { name, address: email },
    missing,
  }
}

/** Is the send log there (migration 202611120050 applied)? */
export async function customerMessagesReady(admin: SupabaseClient, orgId: string): Promise<boolean> {
  const { error } = await orgDb(admin, orgId).from('customer_messages').select('id').limit(1)
  if (!error) return true
  if (isMissingTable(error)) return false
  throw new Error(`customer messages: ${error.message}`)
}

type ContextResult = { ok: true; ctx: SendContext } | { ok: false; reason: 'feature_off' | 'all_off' | 'no_email' | 'not_ready' | 'no_app_url' | 'no_org' | 'no_link_secret' }

/** Everything a send needs, or why nothing can be sent for this company right now. */
export async function loadSendContext(admin: SupabaseClient, orgId: string, now: Date = new Date()): Promise<ContextResult> {
  const features = await loadOrgFeatures(admin, orgId)
  if (!features.customerMessages) return { ok: false, reason: 'feature_off' }
  const { data: org } = await admin.from('orgs').select('id, name, address, phone, email, settings, timezone, logo_url').eq('id', orgId).maybeSingle()
  if (!org) return { ok: false, reason: 'no_org' }
  const o = org as OrgRow
  const settings = messageSettingsOf(o.settings)
  if (!anyMessageOn(settings)) return { ok: false, reason: 'all_off' }
  const channel = channelSender('email')
  if (!channel.available()) return { ok: false, reason: 'no_email' }
  if (!linkSecret()) return { ok: false, reason: 'no_link_secret' }
  if (!(await customerMessagesReady(admin, orgId))) return { ok: false, reason: 'not_ready' }
  // Every automatic message carries its own unsubscribe link on the company's address: no address, no message.
  const appUrl = await tryOrgAppUrl(orgId, 'customer-messages')
  if (!appUrl) return { ok: false, reason: 'no_app_url' }
  const timeZone = orgTimeZone(o.timezone)
  const id = companyIdentity(o, appUrl)
  return {
    ok: true,
    ctx: {
      admin,
      orgId,
      timeZone,
      now,
      today: ymdInZone(now, timeZone),
      hour: hourInZone(now, timeZone),
      settings,
      company: id.company,
      from: id.from,
      replyTo: id.company.email || null,
      appUrl,
      proposalWord: t(resolveOrgProfile(o.settings), 'proposal'),
      channel,
      blocked: id.missing[0] ?? null,
      budget: { left: MAX_SENDS_PER_RUN },
      stats: emptyStats(),
    },
  }
}

/**
 * Owners' Today card when customer emails are switched on but can't go out (company name / email / postal address
 * missing). Null when nothing is wrong (or the module is off).
 */
export async function loadCustomerMessagesBlockedQueue(admin: SupabaseClient, orgId: string): Promise<TodayQueue | null> {
  const features = await loadOrgFeatures(admin, orgId)
  if (!features.customerMessages) return null
  const { data: org } = await admin.from('orgs').select('id, name, address, phone, email, settings').eq('id', orgId).maybeSingle()
  if (!org || !anyMessageOn(messageSettingsOf((org as OrgRow).settings))) return null
  const { missing } = companyIdentity(org as OrgRow, null)
  if (missing.length === 0) return null
  const { count } = await orgDb(admin, orgId).from('customer_messages').select('id', { count: 'exact', head: true }).eq('status', 'blocked')
  return {
    id: 'customer-messages-blocked',
    title: 'Customer emails are stopped',
    count: Math.max(count ?? 0, 1),
    empty: 'Customer emails are going out.',
    items: missing.map((m) => ({ id: m, title: BLOCK_REASON_TEXT[m], detail: count ? `${count} email${count === 1 ? '' : 's'} waiting` : 'Nothing has been sent yet', href: '/admin/settings', ref: 'Customer emails', note: BLOCK_REASON_TEXT[m] })),
  }
}

// ── Opt-outs ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type SuppressionReason = 'unsubscribed' | 'bounced' | 'complained'

/**
 * THE writer of the suppression list: this address gets no automatic message from this company again. The first
 * reason is kept. A provider webhook (bounces / complaints) would call this too.
 */
export async function suppressAddress(
  admin: SupabaseClient,
  orgId: string,
  channel: MessageChannel,
  rawAddress: string,
  reason: SuppressionReason,
  opts: { messageId?: string | null; detail?: string | null } = {}
): Promise<void> {
  const address = channel === 'email' ? normalizeEmail(rawAddress) : rawAddress.trim().toLowerCase()
  if (!address) return
  const { error } = await orgDb(admin, orgId)
    .from('customer_message_suppressions')
    .upsert({ channel, address, reason, message_id: opts.messageId ?? null, detail: opts.detail?.slice(0, 300) ?? null }, { onConflict: 'org_id,channel,address', ignoreDuplicates: true })
  if (error) throw new Error(`suppress address: ${error.message}`)
}

async function suppressionOf(admin: SupabaseClient, orgId: string, channel: MessageChannel, address: string): Promise<{ reason: SuppressionReason; created_at: string } | null> {
  const { data } = await orgDb(admin, orgId).from('customer_message_suppressions').select('reason, created_at').eq('channel', channel).eq('address', address).maybeSingle()
  return (data as { reason: SuppressionReason; created_at: string } | null) ?? null
}

type CustomerFacts = { id: string; name: string | null; email: string | null; off: boolean }

async function loadCustomer(admin: SupabaseClient, orgId: string, customerId: string | null): Promise<CustomerFacts | null> {
  if (!customerId) return null
  const { data, error } = await orgDb(admin, orgId).from('customers').select('id, name, email, messages_off_at').eq('id', customerId).maybeSingle()
  if (error && isMissingColumn(error, 'messages_off_at')) return null
  const c = data as { id: string; name: string | null; email: string | null; messages_off_at: string | null } | null
  return c ? { id: c.id, name: c.name, email: c.email, off: !!c.messages_off_at } : null
}

// ── Queue + deliver ─────────────────────────────────────────────────────────────────────────────────────────────────

type NewMessage = { kind: MessageKind; key: string; customerId: string | null; refs: Record<string, unknown>; sendAfter: Date; expiresAt?: Date | null; createdBy?: string | null }

/** Insert a message row unless its key exists. Returns the new row, or null when the key was already used. */
export async function enqueueMessage(admin: SupabaseClient, orgId: string, m: NewMessage): Promise<MessageRow | null> {
  const { data, error } = await orgDb(admin, orgId)
    .from('customer_messages')
    .insert({
      message_key: m.key,
      kind: m.kind,
      channel: 'email',
      status: 'queued',
      attempts: 0,
      customer_id: m.customerId,
      refs: m.refs,
      send_after: m.sendAfter.toISOString(),
      expires_at: m.expiresAt ? m.expiresAt.toISOString() : null,
      created_by: m.createdBy ?? null,
    })
    .select(ROW_COLS)
    .single()
  if (error) {
    if (error.code === '23505') return null
    throw new Error(`queue message: ${error.message}`)
  }
  return data as MessageRow
}

/** Keys (of `keys`) already in the log, so a scan never re-tries an insert every run. */
async function existingKeys(admin: SupabaseClient, orgId: string, keys: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  // Keys are ~70 characters: 50 per request keeps the URL small (PostgREST / proxies cap request lines).
  for (let i = 0; i < keys.length; i += KEY_CHUNK) {
    const { data, error } = await orgDb(admin, orgId).from('customer_messages').select('message_key').in('message_key', keys.slice(i, i + KEY_CHUNK))
    if (error) throw new Error(`message keys: ${error.message}`)
    for (const r of (data ?? []) as Array<{ message_key: string }>) out.add(r.message_key)
  }
  return out
}

async function finish(ctx: SendContext, row: MessageRow, patch: Record<string, unknown>): Promise<void> {
  const { error } = await orgDb(ctx.admin, ctx.orgId)
    .from('customer_messages')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .eq('status', 'sending')
  if (error) console.error('[customer-messages] could not record the result', { orgId: ctx.orgId, id: row.id, error })
}

/** Close or park a row nobody has claimed — conditional on what we read, so a racing claim always wins. */
async function closeUnclaimed(ctx: SendContext, row: MessageRow, patch: Record<string, unknown>): Promise<boolean> {
  const { data } = await orgDb(ctx.admin, ctx.orgId)
    .from('customer_messages')
    .update({ ...patch, updated_at: ctx.now.toISOString() })
    .eq('id', row.id)
    .eq('status', row.status)
    .eq('attempts', row.attempts)
    .select('id')
  return ((data ?? []) as unknown[]).length === 1
}

/** What a message says and to whom, re-checked at send time — or why it is no longer sent. */
type Built =
  | {
      send: true
      customerId: string | null
      to: string
      /** Side effects that only make sense once the row is ours (e.g. making a pay link). */
      prepare?: () => Promise<Record<string, string | null>>
      render: (links: Links, prepared: Record<string, string | null>) => RenderedMessage
    }
  | { send: false; status: 'skipped' | 'cancelled'; reason: string; to?: string | null }
  | { defer: true; untilMs: number; reason: string }

type Links = { page: string; unsubscribe: string; unsubscribePost: string }

/** Secret behind every message's link token (env CUSTOMER_MESSAGE_LINK_SECRET, else derived from the service key). */
function linkSecret(): string | null {
  const s = process.env.CUSTOMER_MESSAGE_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  return s && s.length >= 16 ? s : null
}

/**
 * A message's link token: HMAC of its row id, so a retry carries the SAME links as an earlier try that may have arrived
 * (an "unknown" SMTP outcome) — never a second token that would kill the first email's links. Only its hash is stored.
 */
export function linkTokenFor(messageId: string): string {
  const secret = linkSecret()
  if (!secret) throw new Error('customer messages: no link secret')
  return createHmac('sha256', secret).update(`customer-message:${messageId}`).digest('base64url')
}

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** A stable Message-ID per message (same on every retry) on the company's own address. */
function messageIdFor(ctx: SendContext, rowId: string): string {
  let host = 'localhost'
  try {
    host = new URL(ctx.appUrl).hostname || host
  } catch {
    /* keep localhost */
  }
  return `<cm-${rowId}@${host}>`
}

/** Recipient checks shared by every kind: office "don't email", no usable address, suppressed. (The daily cap is in the claim.) */
async function recipientRefusal(ctx: SendContext, customer: CustomerFacts | null, to: string | null): Promise<{ reason: string } | null> {
  if (customer?.off) return { reason: 'customer_opted_out' }
  if (!to) return { reason: 'no_address' }
  if (await suppressionOf(ctx.admin, ctx.orgId, ctx.channel.channel, to)) return { reason: 'suppressed' }
  return null
}

const CLAIMABLE = new Set<MessageRow['status']>(['queued', 'failed', 'blocked'])

/**
 * Send one row that is waiting (queued, failed with tries left, or blocked earlier). It is re-checked FIRST (read-only:
 * still turned on, still within its late window, still true, recipient allowed), then claimed atomically together with
 * the per-address daily cap (SQL customer_message_claim), then prepared, sent and recorded. "On the way" ignores quiet hours.
 */
export async function deliver(ctx: SendContext, row: MessageRow): Promise<'sent' | 'skipped' | 'cancelled' | 'failed' | 'deferred' | 'blocked' | 'not_claimed'> {
  if (!CLAIMABLE.has(row.status)) return 'not_claimed'
  if (row.expires_at && Date.parse(row.expires_at) <= ctx.now.getTime()) {
    if (await closeUnclaimed(ctx, row, { status: 'skipped', skip_reason: 'expired' })) ctx.stats.skipped++
    return 'skipped'
  }
  if (ctx.blocked) {
    // Nothing goes out under a missing identity. Parked (looked at again hourly); sent once fixed if still in its window.
    await closeUnclaimed(ctx, row, { status: 'blocked', skip_reason: ctx.blocked, send_after: new Date(ctx.now.getTime() + 3_600_000).toISOString() })
    ctx.stats.blocked++
    return 'blocked'
  }
  if (row.kind !== 'visit_on_the_way' && isQuietHour(ctx.hour, ctx.settings)) return 'deferred'
  if (ctx.budget.left <= 0) {
    ctx.stats.deferred++
    return 'deferred'
  }

  let built: Built
  try {
    built = await build(ctx, row)
  } catch (e) {
    // A read failed: try again later (attempts counted, so a broken row can't loop forever).
    await closeUnclaimed(ctx, row, { status: 'failed', attempts: row.attempts + 1, last_error: errText(e), send_after: retryAt(ctx, row.attempts + 1) })
    ctx.stats.failed++
    return 'failed'
  }
  if ('defer' in built) {
    await closeUnclaimed(ctx, row, { status: 'queued', send_after: new Date(built.untilMs).toISOString(), last_error: built.reason })
    ctx.stats.deferred++
    return 'deferred'
  }
  if (!built.send) {
    if (await closeUnclaimed(ctx, row, { status: built.status, skip_reason: built.reason, to_address: built.to ?? null })) ctx.stats[built.status === 'skipped' ? 'skipped' : 'cancelled']++
    return built.status
  }

  const token = linkTokenFor(row.id)
  const { data: claim, error: claimError } = await ctx.admin.rpc('customer_message_claim', {
    p_org: ctx.orgId,
    p_id: row.id,
    p_from_status: row.status,
    p_attempts: row.attempts,
    p_to: built.to,
    p_token_hash: hashLinkToken(token),
    p_max: MAX_PER_ADDRESS_PER_DAY,
    p_since: new Date(ctx.now.getTime() - 86_400_000).toISOString(),
    p_now: ctx.now.toISOString(),
  })
  if (claimError) {
    console.error('[customer-messages] claim failed', { orgId: ctx.orgId, id: row.id, claimError })
    return 'not_claimed'
  }
  if (claim === 'capped') {
    ctx.stats.skipped++
    return 'skipped'
  }
  if (claim !== 'claimed') return 'not_claimed'
  ctx.budget.left--

  let prepared: Record<string, string | null> = {}
  try {
    prepared = built.prepare ? await built.prepare() : {}
  } catch (e) {
    await finish(ctx, row, { status: 'failed', last_error: errText(e), send_after: retryAt(ctx, row.attempts + 1) })
    ctx.stats.failed++
    return 'failed'
  }
  const links: Links = {
    page: `${ctx.appUrl}/m/${token}`,
    unsubscribe: `${ctx.appUrl}/m/${token}?stop=1`,
    unsubscribePost: `${ctx.appUrl}/api/m/${token}/unsubscribe`,
  }
  const rendered = built.render(links, prepared)
  const out = await ctx.channel.send(built.to, rendered, {
    from: ctx.from,
    replyTo: ctx.replyTo,
    messageId: messageIdFor(ctx, row.id),
    unsubscribeUrl: links.unsubscribe,
    unsubscribePostUrl: links.unsubscribePost,
  })
  if (out.ok) {
    await finish(ctx, row, { status: 'sent', sent_at: new Date().toISOString(), customer_id: built.customerId, subject: rendered.subject.slice(0, 300), last_error: null })
    ctx.stats.sent++
    return 'sent'
  }
  if (out.permanent) {
    await suppressAddress(ctx.admin, ctx.orgId, ctx.channel.channel, built.to, 'bounced', { messageId: row.id, detail: out.error }).catch((e) =>
      console.error('[customer-messages] could not suppress a bounced address', { orgId: ctx.orgId, e })
    )
    await finish(ctx, row, { status: 'skipped', skip_reason: 'bounced', last_error: out.error })
    ctx.stats.skipped++
    return 'skipped'
  }
  // No definite answer (timeout / dropped line): it may have gone out. Never retried soon — after UNKNOWN_RETRY_HOURS,
  // with the same Message-ID and links, so a copy that did arrive is recognizable and its links keep working.
  const delayMs = out.unknown ? UNKNOWN_RETRY_HOURS * 3_600_000 : null
  await finish(ctx, row, {
    status: 'failed',
    last_error: `${out.unknown ? 'unknown (may have been sent): ' : ''}${out.error}`.slice(0, 300),
    send_after: delayMs ? new Date(ctx.now.getTime() + delayMs).toISOString() : retryAt(ctx, row.attempts + 1),
  })
  ctx.stats.failed++
  return 'failed'
}

/** An SMTP send with no definite answer is tried again only this much later (same Message-ID). */
export const UNKNOWN_RETRY_HOURS = 6

function errText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 300)
}

/** 30 min, then 2 h before the last try. */
function retryAt(ctx: SendContext, attempts: number): string {
  return new Date(ctx.now.getTime() + (attempts <= 1 ? 30 : 120) * 60_000).toISOString()
}

// ── Build: per kind, from the row's refs, re-checked now ────────────────────────────────────────────────────────────

async function build(ctx: SendContext, row: MessageRow): Promise<Built> {
  switch (row.kind) {
    case 'visit_reminder':
      return buildVisitReminder(ctx, row)
    case 'visit_on_the_way':
    case 'visit_done':
      return buildVisitEvent(ctx, row)
    case 'quote_follow_up':
      return buildQuoteFollowUp(ctx, row)
    case 'invoice_reminder':
      return buildInvoiceReminder(ctx, row)
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

type VisitRow = { id: string; customer_id: string | null; property_id: string | null; scheduled_date: string; status: string; service_plan_id: string | null; visit_step: string | null; address: string | null; title: string | null; completed_at: string | null }
const VISIT_COLS = 'id, customer_id, property_id, scheduled_date, status, service_plan_id, visit_step, address, title, completed_at'

/** "What we're doing": the plan's name, with the follow-on step's label for a step visit. */
async function describeVisits(ctx: SendContext, visits: VisitRow[]): Promise<Map<string, { address: string | null; what: string }>> {
  const planIds = Array.from(new Set(visits.map((v) => v.service_plan_id).filter((x): x is string => !!x)))
  const propIds = Array.from(new Set(visits.map((v) => v.property_id).filter((x): x is string => !!x)))
  const plans = new Map<string, { name: string; steps: Array<{ key?: string; label?: string }> }>()
  const props = new Map<string, string>()
  for (let i = 0; i < planIds.length; i += CHUNK) {
    const { data } = await orgDb(ctx.admin, ctx.orgId).from('service_plans').select('id, name, steps').in('id', planIds.slice(i, i + CHUNK))
    for (const p of (data ?? []) as Array<{ id: string; name: string; steps: unknown }>) plans.set(p.id, { name: p.name, steps: Array.isArray(p.steps) ? (p.steps as Array<{ key?: string; label?: string }>) : [] })
  }
  for (let i = 0; i < propIds.length; i += CHUNK) {
    const { data } = await orgDb(ctx.admin, ctx.orgId).from('properties').select('id, address_text').in('id', propIds.slice(i, i + CHUNK))
    for (const p of (data ?? []) as Array<{ id: string; address_text: string | null }>) if (p.address_text) props.set(p.id, p.address_text)
  }
  const out = new Map<string, { address: string | null; what: string }>()
  for (const v of visits) {
    const plan = v.service_plan_id ? plans.get(v.service_plan_id) : undefined
    const step = v.visit_step && v.visit_step !== SERVICE_STEP ? plan?.steps.find((s) => s.key === v.visit_step)?.label : null
    const base = plan?.name || v.title || 'Your scheduled service'
    out.set(v.id, { address: (v.property_id && props.get(v.property_id)) || v.address || null, what: step ? `${step} (${base})` : base })
  }
  return out
}

async function buildVisitReminder(ctx: SendContext, row: MessageRow): Promise<Built> {
  const customerId = str(row.refs.customerId)
  const day = str(row.refs.day)
  if (!customerId || !day) return { send: false, status: 'cancelled', reason: 'bad_refs' }
  if (!ctx.settings.visitReminder) return { send: false, status: 'cancelled', reason: 'turned_off' }
  const timing = visitReminderTiming(ctx.today, day, ctx.settings.visitReminderDays, ctx.hour)
  if (!timing) return { send: false, status: 'skipped', reason: 'too_late' }
  const { data, error } = await orgDb(ctx.admin, ctx.orgId)
    .from('work_orders')
    .select(VISIT_COLS)
    .eq('work_order_type', SERVICE_VISIT_TYPE)
    .eq('customer_id', customerId)
    .eq('scheduled_date', day)
    .eq('status', 'scheduled')
    .order('id')
  if (error) throw new Error(`visits: ${error.message}`)
  const visits = (data ?? []) as VisitRow[]
  // Skipped / moved / cancelled since this was queued: nothing left to remind about.
  if (visits.length === 0) return { send: false, status: 'cancelled', reason: 'no_visits_that_day' }
  const customer = await loadCustomer(ctx.admin, ctx.orgId, customerId)
  const to = ctx.channel.addressFor({ email: customer?.email ?? null, phone: null })
  const refusal = await recipientRefusal(ctx, customer, to)
  if (refusal) return { send: false, status: 'skipped', reason: refusal.reason, to }
  const what = await describeVisits(ctx, visits)
  // Same address listed once per thing being done there.
  const lines = visits.map((v) => what.get(v.id)!).filter((x, i, a) => a.findIndex((y) => y.address === x.address && y.what === x.what) === i)
  return {
    send: true,
    customerId,
    to: to!,
    render: (links) =>
      renderVisitReminder(msgCtx(ctx, customer, links), { today: ctx.today, day, visits: lines, window: ctx.settings.visitWindow, note: ctx.settings.visitNote }),
  }
}

function msgCtx(ctx: SendContext, customer: CustomerFacts | null, links: Links, customerName?: string | null): MessageContext {
  return { company: ctx.company, customerName: customerName ?? customer?.name ?? null, unsubscribeUrl: links.unsubscribe }
}

async function buildVisitEvent(ctx: SendContext, row: MessageRow): Promise<Built> {
  const visitId = str(row.refs.visitId)
  if (!visitId) return { send: false, status: 'cancelled', reason: 'bad_refs' }
  const { data } = await orgDb(ctx.admin, ctx.orgId).from('work_orders').select(VISIT_COLS).eq('id', visitId).eq('work_order_type', SERVICE_VISIT_TYPE).maybeSingle()
  const v = data as VisitRow | null
  if (!v) return { send: false, status: 'cancelled', reason: 'visit_gone' }
  const done = row.kind === 'visit_done'
  if (done && v.status !== 'completed') return { send: false, status: 'cancelled', reason: 'reopened' }
  if (!done && v.status !== 'scheduled') return { send: false, status: 'cancelled', reason: 'visit_closed' }
  if (done ? !ctx.settings.visitDone : !ctx.settings.onTheWay) return { send: false, status: 'cancelled', reason: 'turned_off' }
  const customer = await loadCustomer(ctx.admin, ctx.orgId, v.customer_id)
  const to = ctx.channel.addressFor({ email: customer?.email ?? null, phone: null })
  const refusal = await recipientRefusal(ctx, customer, to)
  if (refusal) return { send: false, status: 'skipped', reason: refusal.reason, to }
  const info = (await describeVisits(ctx, [v])).get(v.id)!
  let photos = false
  if (done && ctx.settings.visitDonePhotos) {
    const { count } = await orgDb(ctx.admin, ctx.orgId).from('photos').select('id', { count: 'exact', head: true }).eq('work_order_id', v.id).is('deleted_at', null)
    photos = (count ?? 0) > 0
  }
  return {
    send: true,
    customerId: v.customer_id,
    to: to!,
    render: (links) =>
      done
        ? renderVisitDone(msgCtx(ctx, customer, links), { address: info.address, what: info.what, day: v.scheduled_date, photosUrl: photos ? links.page : null })
        : renderOnTheWay(msgCtx(ctx, customer, links), { address: info.address, what: info.what }),
  }
}

async function buildQuoteFollowUp(ctx: SendContext, row: MessageRow): Promise<Built> {
  const proposalId = str(row.refs.proposalId)
  if (!proposalId) return { send: false, status: 'cancelled', reason: 'bad_refs' }
  if (!ctx.settings.quoteFollowUp) return { send: false, status: 'cancelled', reason: 'turned_off' }
  // The one "waiting for a signature" rule: still 'sent', deal not won or lost.
  const [p] = await listUnsignedProposals(ctx.admin, ctx.orgId, { ids: [proposalId] })
  if (!p) return { send: false, status: 'cancelled', reason: 'signed_or_declined' }
  // Still this step's turn, inside its late window (and the step is still one of the company's days).
  if (dueStep(daysBetweenYmd(ymdInZone(new Date(p.sent_at), ctx.timeZone), ctx.today), ctx.settings.quoteFollowUpDays) !== row.refs.step) {
    return { send: false, status: 'skipped', reason: 'too_late' }
  }
  let customerId: string | null = null
  if (p.opportunity_id) {
    const { data: opp } = await orgDb(ctx.admin, ctx.orgId).from('opportunities').select('customer_id').eq('id', p.opportunity_id).maybeSingle()
    customerId = (opp as { customer_id: string | null } | null)?.customer_id ?? null
  }
  const customer = await loadCustomer(ctx.admin, ctx.orgId, customerId)
  const to = ctx.channel.addressFor({ email: p.customer_email || customer?.email || null, phone: null })
  const refusal = await recipientRefusal(ctx, customer, to)
  if (refusal) return { send: false, status: 'skipped', reason: refusal.reason, to }
  // A signing link already sent for this quote (still waiting) is the button; otherwise "reply to this email".
  const { data: contract } = await orgDb(ctx.admin, ctx.orgId)
    .from('order_form_contracts')
    .select('signing_token, signing_token_enc')
    .eq('proposal_id', proposalId)
    .eq('status', 'pending_customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const token = signingTokenOf(contract as { signing_token: string | null; signing_token_enc: string | null } | null)
  const signUrl = token ? `${ctx.appUrl}/contracts/sign/${token}` : null
  return {
    send: true,
    customerId,
    to: to!,
    render: (links) =>
      renderQuoteFollowUp(msgCtx(ctx, customer, links, p.customer_name), {
        word: ctx.proposalWord,
        number: p.proposal_number == null ? null : String(p.proposal_number),
        total: p.total,
        sentOn: ymdInZone(new Date(p.sent_at), ctx.timeZone),
        signUrl,
      }),
  }
}

/** When an invoice is due, in the company's days: its due date, else the day it was sent (due on receipt). */
export function invoiceDueDay(inv: { due_at: string | null; sent_at: string | null; issued_at: string | null }, timeZone: string): string | null {
  if (inv.due_at) return /^\d{4}-\d{2}-\d{2}$/.test(inv.due_at) ? inv.due_at : ymdInZone(new Date(inv.due_at), timeZone)
  const base = inv.sent_at || inv.issued_at
  if (!base) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(base) ? base : ymdInZone(new Date(base), timeZone)
}

async function buildInvoiceReminder(ctx: SendContext, row: MessageRow): Promise<Built> {
  const invoiceId = str(row.refs.invoiceId)
  if (!invoiceId) return { send: false, status: 'cancelled', reason: 'bad_refs' }
  if (!ctx.settings.invoiceReminder) return { send: false, status: 'cancelled', reason: 'turned_off' }
  const found = await findOrgInvoice(ctx.admin, invoiceId, ctx.orgId)
  if (!found || (found.status !== 'sent' && found.status !== 'partially_paid')) return { send: false, status: 'cancelled', reason: found ? `invoice_${found.status}` : 'invoice_gone' }
  // org-scope-ok: found above in this company by findOrgInvoice (job invoices scope through their job)
  const { data: full, error: fullError } = await ctx.admin.from('job_invoices').select('*').eq('id', found.id).maybeSingle()
  if (fullError || !full) throw new Error(`invoice: ${fullError?.message ?? 'not found'}`)
  const invoice = full as JobInvoice
  const doc = await loadInvoiceDocument(ctx.admin, ctx.orgId, invoice)
  if (doc.isPaid || doc.balanceCents <= 0) return { send: false, status: 'cancelled', reason: 'paid' }
  const dueDay = invoiceDueDay(invoice, ctx.timeZone)
  if (!dueDay) return { send: false, status: 'cancelled', reason: 'not_sent' }
  // Still this step's turn, inside its late window (a due date moved, or the step taken off the company's list → no).
  if (dueStep(daysBetweenYmd(dueDay, ctx.today), ctx.settings.invoiceReminderDays) !== row.refs.step) return { send: false, status: 'skipped', reason: 'too_late' }
  let customerId = invoice.customer_id ?? null
  if (!customerId && invoice.job_id) {
    const { data: job } = await orgDb(ctx.admin, ctx.orgId).from('production_jobs').select('customer_id').eq('id', invoice.job_id).maybeSingle()
    customerId = (job as { customer_id: string | null } | null)?.customer_id ?? null
  }
  const customer = await loadCustomer(ctx.admin, ctx.orgId, customerId)
  const to = ctx.channel.addressFor({ email: doc.billTo.email, phone: null })
  const refusal = await recipientRefusal(ctx, customer, to)
  if (refusal) return { send: false, status: 'skipped', reason: refusal.reason, to }

  // Online payments: a pay link — and a customer on automatic payments hears nothing until their card has been tried.
  const { loadOnlinePayments } = await import('@/lib/online-payments/accounts')
  const op = await loadOnlinePayments(ctx.admin, ctx.orgId)
  if (op.ready && op.settings.autopay && !invoice.job_id && customerId) {
    const wait = await autopayPending(ctx, invoice.id, customerId)
    if (wait) return { defer: true, untilMs: ctx.now.getTime() + 6 * 3_600_000, reason: wait }
  }
  return {
    send: true,
    customerId,
    to: to!,
    // The pay link is made only once this row is ours (a lost claim never leaves a stray link behind).
    prepare: async () => {
      if (!op.ready) return { payUrl: null }
      const { createPaymentLink } = await import('@/lib/online-payments/links')
      return { payUrl: (await createPaymentLink(ctx.admin, ctx.orgId, { kind: 'invoice', invoiceId: invoice.id }, null, ctx.now)).url }
    },
    render: (links, prepared) =>
      renderInvoiceReminder(msgCtx(ctx, customer, links, doc.billTo.name), {
        invoiceNumber: invoice.invoice_number,
        balanceCents: doc.balanceCents,
        dueDay,
        daysPastDue: daysBetweenYmd(dueDay, ctx.today),
        payUrl: prepared.payUrl ?? null,
      }),
  }
}

/**
 * Why to hold an invoice reminder for a customer on automatic payments, or null. Held while an automatic charge has no
 * result yet (open / processing). A failed charge is a result (the customer was already told and gets the pay link); no
 * attempt at all means no charge is coming (the invoice went out before the card was saved), so the reminder goes.
 */
export async function autopayPending(ctx: Pick<SendContext, 'admin' | 'orgId' | 'now'>, invoiceId: string, customerId: string): Promise<string | null> {
  const { loadCardOnFile } = await import('@/lib/online-payments/cards')
  const card = await loadCardOnFile(ctx.admin, ctx.orgId, customerId)
  if (!card?.autopay) return null
  const { data } = await orgDb(ctx.admin, ctx.orgId).from('online_payments').select('status').eq('invoice_id', invoiceId).eq('kind', 'autopay')
  const statuses = ((data ?? []) as Array<{ status: string }>).map((r) => r.status)
  return statuses.some((s) => s === 'open' || s === 'processing') ? 'waiting_for_automatic_payment' : null
}

// ── Scans (the scheduled run) ───────────────────────────────────────────────────────────────────────────────────────

async function enqueueMissing(ctx: SendContext, items: NewMessage[]): Promise<void> {
  if (items.length === 0) return
  const have = await existingKeys(ctx.admin, ctx.orgId, items.map((i) => i.key))
  for (const m of items) {
    if (have.has(m.key)) continue
    if (await enqueueMessage(ctx.admin, ctx.orgId, m)) ctx.stats.queued++
  }
}

/** Visit days within reach today, one candidate per customer per day. */
export async function scanVisitReminders(ctx: SendContext): Promise<void> {
  const { from, to } = visitReminderRange(ctx.today, ctx.settings.visitReminderDays)
  const groups = new Map<string, { customerId: string; day: string }>()
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await orgDb(ctx.admin, ctx.orgId)
      .from('work_orders')
      .select('id, customer_id, scheduled_date')
      .eq('work_order_type', SERVICE_VISIT_TYPE)
      .eq('status', 'scheduled')
      .gte('scheduled_date', from)
      .lte('scheduled_date', to)
      .not('customer_id', 'is', null)
      .order('id')
      .range(off, off + PAGE - 1)
    if (error) throw new Error(`visit scan: ${error.message}`)
    for (const v of (data ?? []) as Array<{ customer_id: string; scheduled_date: string }>) {
      if (!visitReminderTiming(ctx.today, v.scheduled_date, ctx.settings.visitReminderDays, ctx.hour)) continue
      groups.set(`${v.customer_id}:${v.scheduled_date}`, { customerId: v.customer_id, day: v.scheduled_date })
    }
    if (!data || data.length < PAGE) break
  }
  await enqueueMissing(
    ctx,
    Array.from(groups.values()).map((g) => ({
      kind: 'visit_reminder' as const,
      key: messageKey.visitReminder('email', g.customerId, g.day),
      customerId: g.customerId,
      refs: { customerId: g.customerId, day: g.day },
      sendAfter: ctx.now,
    }))
  )
}

export async function scanQuoteFollowUps(ctx: SendContext): Promise<void> {
  const open = await listUnsignedProposals(ctx.admin, ctx.orgId)
  const items: NewMessage[] = []
  for (const p of open) {
    const step = dueStep(daysBetweenYmd(ymdInZone(new Date(p.sent_at), ctx.timeZone), ctx.today), ctx.settings.quoteFollowUpDays)
    if (step == null) continue
    items.push({ kind: 'quote_follow_up', key: messageKey.quoteFollowUp('email', p.id, step), customerId: null, refs: { proposalId: p.id, step }, sendAfter: ctx.now })
  }
  await enqueueMissing(ctx, items)
}

export async function scanInvoiceReminders(ctx: SendContext): Promise<void> {
  const items: NewMessage[] = []
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await orgDb(ctx.admin, ctx.orgId)
      .from('job_invoices')
      .select('id, customer_id, due_at, sent_at, issued_at')
      .in('status', ['sent', 'partially_paid'])
      .order('id')
      .range(off, off + PAGE - 1)
    if (error) throw new Error(`invoice scan: ${error.message}`)
    for (const inv of (data ?? []) as Array<{ id: string; customer_id: string | null; due_at: string | null; sent_at: string | null; issued_at: string | null }>) {
      const due = invoiceDueDay(inv, ctx.timeZone)
      if (!due) continue
      const step = dueStep(daysBetweenYmd(due, ctx.today), ctx.settings.invoiceReminderDays)
      if (step == null) continue
      items.push({ kind: 'invoice_reminder', key: messageKey.invoiceReminder('email', inv.id, step), customerId: inv.customer_id, refs: { invoiceId: inv.id, step }, sendAfter: ctx.now })
    }
    if (!data || data.length < PAGE) break
  }
  await enqueueMissing(ctx, items)
}

/** Rows stuck in `sending` (the process died mid-send): failed, never retried — the email may have gone out. */
async function closeStaleSends(ctx: SendContext): Promise<void> {
  await orgDb(ctx.admin, ctx.orgId)
    .from('customer_messages')
    .update({ status: 'failed', attempts: MAX_SEND_ATTEMPTS, last_error: 'Stopped mid-send — not retried in case it went out', updated_at: ctx.now.toISOString() })
    .eq('status', 'sending')
    .lt('claimed_at', new Date(ctx.now.getTime() - STALE_SENDING_MS).toISOString())
}

/** Everything due to go: queued rows and failed ones with tries left, oldest first. */
async function drain(ctx: SendContext): Promise<void> {
  const { data, error } = await orgDb(ctx.admin, ctx.orgId)
    .from('customer_messages')
    .select(ROW_COLS)
    .in('status', ['queued', 'failed', 'blocked'])
    .lt('attempts', MAX_SEND_ATTEMPTS)
    .lte('send_after', ctx.now.toISOString())
    .order('send_after', { ascending: true })
    .limit(MAX_SENDS_PER_RUN * 3)
  if (error) throw new Error(`message queue: ${error.message}`)
  for (const row of (data ?? []) as MessageRow[]) {
    if (ctx.budget.left <= 0) break
    await deliver(ctx, row)
  }
}

export type OrgRunResult = { orgId: string; skipped?: string; stats?: RunStats }

/** The scheduled run for one company (cron). Never throws for a single bad message; a scan failure is reported. */
export async function runCustomerMessagesForOrg(admin: SupabaseClient, orgId: string, now: Date = new Date()): Promise<OrgRunResult> {
  const loaded = await loadSendContext(admin, orgId, now)
  if (!loaded.ok) return { orgId, skipped: loaded.reason }
  const ctx = loaded.ctx
  await closeStaleSends(ctx)
  if (!isQuietHour(ctx.hour, ctx.settings)) {
    const s = ctx.settings
    const scans: Array<[boolean, (c: SendContext) => Promise<void>, string]> = [
      [s.visitReminder, scanVisitReminders, 'visit reminders'],
      [s.invoiceReminder, scanInvoiceReminders, 'invoice reminders'],
      [s.quoteFollowUp, scanQuoteFollowUps, 'quote follow-ups'],
    ]
    for (const [on, scan, label] of scans) {
      if (!on) continue
      await scan(ctx).catch((e) => console.error(`[customer-messages] ${label} scan failed`, { orgId, e }))
    }
  }
  // "On the way" rows may still be waiting (an SMTP blip); they go even in quiet hours, the rest wait (deliver decides).
  await drain(ctx)
  return { orgId, stats: ctx.stats }
}

// ── Events (crew taps) ──────────────────────────────────────────────────────────────────────────────────────────────

export type EventResult = { status: 'sent' | 'queued' | 'already' | 'off' | 'not_today' | 'not_ready' | 'failed' | 'skipped' | 'cancelled' | 'deferred' | 'blocked' }

async function visitForEvent(admin: SupabaseClient, orgId: string, visitId: string): Promise<VisitRow | null> {
  const { data } = await orgDb(admin, orgId).from('work_orders').select(VISIT_COLS).eq('id', visitId).eq('work_order_type', SERVICE_VISIT_TYPE).maybeSingle()
  return (data as VisitRow | null) ?? null
}

/** The crew tapped "On my way": the customer gets an email now (once per visit per day). */
export async function notifyVisitOnTheWay(admin: SupabaseClient, orgId: string, visitId: string, now: Date = new Date()): Promise<EventResult> {
  const loaded = await loadSendContext(admin, orgId, now)
  if (!loaded.ok) return { status: loaded.reason === 'not_ready' ? 'not_ready' : 'off' }
  const ctx = loaded.ctx
  if (!ctx.settings.onTheWay) return { status: 'off' }
  const v = await visitForEvent(admin, orgId, visitId)
  if (!v || v.status !== 'scheduled' || v.scheduled_date !== ctx.today) return { status: 'not_today' }
  const row = await enqueueMessage(admin, orgId, {
    kind: 'visit_on_the_way',
    key: messageKey.onTheWay('email', visitId, ctx.today),
    customerId: v.customer_id,
    refs: { visitId },
    sendAfter: now,
    expiresAt: new Date(now.getTime() + ON_THE_WAY_EXPIRES_MINUTES * 60_000),
  })
  if (!row) return { status: 'already' }
  const r = await deliver(ctx, row)
  return { status: r === 'not_claimed' ? 'already' : r }
}

/**
 * A visit was marked done (crew or office): "done" goes out DONE_DELAY_MINUTES later by the scheduled run, so a
 * mis-tap reopened meanwhile cancels it and photos taken right after are in the link. Only for a visit done on the day
 * it sits (catch-up marking days later sends nothing). Never throws (the visit is already saved).
 */
export async function queueVisitDone(admin: SupabaseClient, orgId: string, visitId: string, now: Date = new Date()): Promise<EventResult> {
  try {
    const features = await loadOrgFeatures(admin, orgId)
    if (!features.customerMessages) return { status: 'off' }
    const { data: org } = await admin.from('orgs').select('settings, timezone').eq('id', orgId).maybeSingle()
    const o = (org ?? {}) as { settings?: Record<string, unknown> | null; timezone?: string | null }
    if (!messageSettingsOf(o.settings).visitDone) return { status: 'off' }
    const today = ymdInZone(now, orgTimeZone(o.timezone))
    const v = await visitForEvent(admin, orgId, visitId)
    if (!v || v.status !== 'completed' || v.scheduled_date !== today) return { status: 'not_today' }
    const row = await enqueueMessage(admin, orgId, {
      kind: 'visit_done',
      key: messageKey.visitDone('email', visitId),
      customerId: v.customer_id,
      refs: { visitId },
      sendAfter: new Date(now.getTime() + DONE_DELAY_MINUTES * 60_000),
      expiresAt: new Date(now.getTime() + DONE_EXPIRES_HOURS * 3_600_000),
    })
    return { status: row ? 'queued' : 'already' }
  } catch (e) {
    // Before the migration (no table) or a blip: the visit stands; no "done" email for it.
    if (!isMissingTable(e as { code?: string })) console.error('[customer-messages] could not queue the done email', { orgId, visitId, e })
    return { status: 'not_ready' }
  }
}

// ── Customer pages (/m/<token>) and the office ──────────────────────────────────────────────────────────────────────

/** The message a link token belongs to (any company — the caller fences by host), or null. */
export async function findMessageByToken(admin: SupabaseClient, token: unknown): Promise<MessageRow | null> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null
  // org-scope-ok: lookup by the hash of a secret per-message token; the row names its own company, which every later query uses
  const { data } = await admin.from('customer_messages').select(ROW_COLS).eq('link_token_hash', hashLinkToken(token)).maybeSingle()
  return (data as MessageRow | null) ?? null
}

/** The customer asked to stop (link or one-click): suppress the address, and mark their customer record. Idempotent. */
export async function unsubscribeMessage(admin: SupabaseClient, row: MessageRow): Promise<void> {
  if (row.to_address) await suppressAddress(admin, row.org_id, row.channel, row.to_address, 'unsubscribed', { messageId: row.id })
  if (row.customer_id) {
    const { error } = await orgDb(admin, row.org_id).from('customers').update({ messages_off_at: new Date().toISOString(), messages_off_by: null }).eq('id', row.customer_id).is('messages_off_at', null)
    if (error && !isMissingColumn(error, 'messages_off_at')) throw new Error(`unsubscribe: ${error.message}`)
  }
}

/** Visit photos a "done" email links to (signed, short-lived), only within PHOTO_LINK_DAYS of sending. */
export async function messagePhotos(admin: SupabaseClient, row: MessageRow, now: Date = new Date()): Promise<string[]> {
  if (row.kind !== 'visit_done' || !row.sent_at) return []
  if (now.getTime() - Date.parse(row.sent_at) > PHOTO_LINK_DAYS * 86_400_000) return []
  const visitId = str(row.refs.visitId)
  if (!visitId) return []
  const { data } = await orgDb(admin, row.org_id).from('photos').select('storage_path, mime_type').eq('work_order_id', visitId).is('deleted_at', null).order('created_at').limit(40)
  const { signFilesObject } = await import('@/lib/files/files-object')
  const out: string[] = []
  for (const p of (data ?? []) as Array<{ storage_path: string | null; mime_type: string | null }>) {
    if (!p.storage_path || (p.mime_type && !p.mime_type.startsWith('image/'))) continue
    const url = await signFilesObject(admin, p.storage_path, 3600)
    if (url) out.push(url)
  }
  return out
}

export type CustomerMessageState = {
  /** Office "don't email" or the customer unsubscribed. */
  off: boolean
  offAt: string | null
  /** 'office' | 'customer' (unsubscribed) | null */
  offBy: 'office' | 'customer' | null
  email: string | null
  /** The customer's current address is on the suppression list. */
  suppressed: { reason: SuppressionReason; at: string } | null
  recent: Array<{ id: string; kind: MessageKind; status: string; at: string; reason: string | null; subject: string | null }>
}

/** The Customer File card: on / off, why, and the last messages. Null before the migration. */
export async function loadCustomerMessageState(admin: SupabaseClient, orgId: string, customerId: string): Promise<CustomerMessageState | null> {
  const { data: c, error } = await orgDb(admin, orgId).from('customers').select('id, email, messages_off_at, messages_off_by').eq('id', customerId).maybeSingle()
  if (error) {
    if (isMissingColumn(error, 'messages_off_at')) return null
    throw new Error(`customer: ${error.message}`)
  }
  if (!c) return null
  const cust = c as { email: string | null; messages_off_at: string | null; messages_off_by: string | null }
  const email = normalizeEmail(cust.email)
  const [sup, { data: rows }] = await Promise.all([
    email ? suppressionOf(admin, orgId, 'email', email) : Promise.resolve(null),
    orgDb(admin, orgId).from('customer_messages').select('id, kind, status, created_at, sent_at, skip_reason, subject').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(10),
  ])
  return {
    off: !!cust.messages_off_at,
    offAt: cust.messages_off_at,
    offBy: cust.messages_off_at ? (cust.messages_off_by ? 'office' : 'customer') : null,
    email,
    suppressed: sup ? { reason: sup.reason, at: sup.created_at } : null,
    recent: ((rows ?? []) as Array<{ id: string; kind: MessageKind; status: string; created_at: string; sent_at: string | null; skip_reason: string | null; subject: string | null }>).map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      at: r.sent_at ?? r.created_at,
      reason: r.skip_reason,
      subject: r.subject,
    })),
  }
}

/**
 * The office's switch on a customer. Off = "don't email" (kept with who did it). On again clears the office flag — and,
 * only when `customerAsked` (the customer unsubscribed or the address bounced, so turning it back on needs the
 * customer's own say-so), the customer's flag and their address's suppression too.
 */
export async function setCustomerMessages(
  admin: SupabaseClient,
  orgId: string,
  customerId: string,
  on: boolean,
  by: string,
  customerAsked = false
): Promise<{ ok: true } | { ok: false; status: 404 | 409; error: string }> {
  const state = await loadCustomerMessageState(admin, orgId, customerId)
  if (!state) return { ok: false, status: 404, error: 'Customer not found' }
  const db = orgDb(admin, orgId)
  if (!on) {
    if (!state.off) await db.from('customers').update({ messages_off_at: new Date().toISOString(), messages_off_by: by }).eq('id', customerId)
    return { ok: true }
  }
  const needsCustomer = state.offBy === 'customer' || !!state.suppressed
  if (needsCustomer && !customerAsked) return { ok: false, status: 409, error: 'The customer stopped these emails (or the address bounced). Turn them back on only if the customer asked.' }
  await db.from('customers').update({ messages_off_at: null, messages_off_by: null }).eq('id', customerId)
  if (state.email && state.suppressed) await db.from('customer_message_suppressions').delete().eq('channel', 'email').eq('address', state.email)
  return { ok: true }
}
