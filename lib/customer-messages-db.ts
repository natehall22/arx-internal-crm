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
import { isDemoSenderOrg } from '@/lib/demo-org'
import { demoSuppressedChannel, channelSender, normalizeEmail, type MessageChannelSender } from '@/lib/customer-message-channels'
import { suppressAddress, suppressionOf, type SuppressionReason } from '@/lib/customer-message-suppressions'
import { smsWords } from '@/lib/sms/compliance'
import { recordConsent } from '@/lib/sms/consent'
import {
  checkSmsRecipient,
  outsideSmsFloor,
  smsZones,
  inConversation,
  isSmsQuietHour,
  SMS_MAX_PER_NUMBER_PER_DAY,
  SMS_MAX_STAFF_PER_NUMBER_PER_DAY,
} from '@/lib/sms/gate'
import { loadOrgSms, smsNotReadyReason } from '@/lib/sms/org-sms'
import { getSmsProvider, priceMicros } from '@/lib/sms/provider'
import { countSegments } from '@/lib/sms/segments'
import { logUsage, sentToday } from '@/lib/sms/usage'
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
  kindSentOn,
  messageKey,
  readCustomerMessageSettings,
  renderInvoiceReminder,
  renderOnTheWay,
  renderQuoteFollowUp,
  renderCustomerReply,
  renderVisitDone,
  renderVisitReminder,
  visitReminderRange,
  visitReminderTiming,
  type CustomerMessageSettings,
  type MessageChannel,
  type MessageContext,
  type MessageKind,
  type RenderedMessage,
  type RowKind,
} from '@/lib/customer-messages'
import { orgLogoHref } from '@/lib/files/files-object'
import { loadCustomerVisitPhotos } from '@/lib/customer-visit-photos'
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
  kind: RowKind
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
  /** Texts only: the company's own number, its per-day ceiling, and the texts already sent today (counted once, then kept). */
  sms: { from: string; dailyCap: number; sentToday: number | null } | null
  /** Are the automatic messages (reminders, follow-ups …) on for THIS channel? A context may exist only to answer a staff reply or a STOP. */
  autoOn: boolean
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

type ContextResult =
  | { ok: true; ctx: SendContext }
  | { ok: false; reason: 'feature_off' | 'all_off' | 'no_email' | 'not_ready' | 'no_app_url' | 'no_org' | 'no_link_secret' | 'sms_not_ready' }

/**
 * What the context is for. 'auto' = the scheduled / event messages (the company's `customerMessages` switch and at least
 * one message on for the channel). 'reply' = a staff member's own text (only the `texting` switch). 'compliance' = the
 * STOP / HELP / START answer a carrier requires (sent even when texting is off, but only to answer the person).
 */
export type ContextPurpose = 'auto' | 'reply' | 'compliance'

/** Everything a send needs, or why nothing can be sent for this company right now. */
export async function loadSendContext(
  admin: SupabaseClient,
  orgId: string,
  now: Date = new Date(),
  opts: { channel?: MessageChannel; purpose?: ContextPurpose } = {}
): Promise<ContextResult> {
  const channelId: MessageChannel = opts.channel ?? 'email'
  const purpose: ContextPurpose = opts.purpose ?? 'auto'
  const sms = channelId === 'sms'
  const features = await loadOrgFeatures(admin, orgId)
  if (sms ? purpose !== 'compliance' && !features.texting : !features.customerMessages) return { ok: false, reason: 'feature_off' }
  const { data: org } = await admin.from('orgs').select('id, name, address, phone, email, settings, timezone, logo_url').eq('id', orgId).maybeSingle()
  if (!org) return { ok: false, reason: 'no_org' }
  const o = org as OrgRow
  const settings = messageSettingsOf(o.settings)
  const autoOn = (!sms || features.customerMessages) && anyMessageOn(settings, channelId)
  if (purpose === 'auto' && !autoOn) return { ok: false, reason: sms && !features.customerMessages ? 'feature_off' : 'all_off' }
  // A demo company runs the whole pipeline but only logs the message (lib/demo-org.ts).
  const channel = (await isDemoSenderOrg(admin, orgId)) ? demoSuppressedChannel(channelSender(channelId)) : channelSender(channelId)
  if (!channel.available()) return { ok: false, reason: sms ? 'sms_not_ready' : 'no_email' }
  if (!linkSecret()) return { ok: false, reason: 'no_link_secret' }
  if (!(await customerMessagesReady(admin, orgId))) return { ok: false, reason: 'not_ready' }
  let smsRow: { from: string; dailyCap: number; sentToday: number | null } | null = null
  if (sms) {
    const row = await loadOrgSms(admin, orgId)
    if (smsNotReadyReason(row) || !row?.e164) return { ok: false, reason: 'sms_not_ready' }
    smsRow = { from: row.e164, dailyCap: row.daily_cap, sentToday: null }
  }
  // Every automatic EMAIL carries its own unsubscribe link on the company's address: no address, no message. A text
  // needs the address only for the photo page link (automatic texts); a staff reply or a STOP answer needs none.
  const appUrl = await tryOrgAppUrl(orgId, 'customer-messages')
  if (!appUrl && (!sms || purpose === 'auto')) return { ok: false, reason: 'no_app_url' }
  const timeZone = orgTimeZone(o.timezone)
  const id = companyIdentity(o, appUrl)
  // A text goes out under the company's NAME and number: the email and postal address are an email's requirements.
  const blocked = sms ? (id.missing.includes('missing_company_name') ? 'missing_company_name' : null) : (id.missing[0] ?? null)
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
      appUrl: appUrl ?? '',
      proposalWord: t(resolveOrgProfile(o.settings), 'proposal'),
      channel,
      sms: smsRow,
      autoOn,
      blocked,
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

export { suppressAddress, type SuppressionReason }

type CustomerFacts = { id: string; name: string | null; email: string | null; phone: string | null; off: boolean }

async function loadCustomer(admin: SupabaseClient, orgId: string, customerId: string | null): Promise<CustomerFacts | null> {
  if (!customerId) return null
  const { data, error } = await orgDb(admin, orgId).from('customers').select('id, name, email, phone, messages_off_at').eq('id', customerId).maybeSingle()
  if (error && isMissingColumn(error, 'messages_off_at')) return null
  const c = data as { id: string; name: string | null; email: string | null; phone: string | null; messages_off_at: string | null } | null
  return c ? { id: c.id, name: c.name, email: c.email, phone: c.phone, off: !!c.messages_off_at } : null
}

// ── Queue + deliver ─────────────────────────────────────────────────────────────────────────────────────────────────

type NewMessage = { kind: RowKind; key: string; channel?: MessageChannel; customerId: string | null; refs: Record<string, unknown>; sendAfter: Date; expiresAt?: Date | null; createdBy?: string | null }

/** Insert a message row unless its key exists. Returns the new row, or null when the key was already used. */
export async function enqueueMessage(admin: SupabaseClient, orgId: string, m: NewMessage): Promise<MessageRow | null> {
  const { data, error } = await orgDb(admin, orgId)
    .from('customer_messages')
    .insert({
      message_key: m.key,
      kind: m.kind,
      channel: m.channel ?? 'email',
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

/**
 * Recipient checks shared by every kind: office "don't message", no usable address, suppressed — and for a text, consent
 * (lib/sms/gate.ts: the one place those rules live). (The daily cap is in the claim.)
 */
async function recipientRefusal(ctx: SendContext, customer: CustomerFacts | null, to: string | null, reply = false): Promise<{ reason: string } | null> {
  if (customer?.off) return { reason: 'customer_opted_out' }
  if (!to) return { reason: 'no_address' }
  if (ctx.channel.channel === 'sms') {
    const check = await checkSmsRecipient(ctx.admin, ctx.orgId, to, ctx.now, { reply })
    if (check.ok) return null
    return { reason: check.code === 'no_consent' ? 'no_consent' : 'suppressed' }
  }
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
  // A row belongs to ONE channel's sender; a context for the other channel never touches it.
  if (row.channel !== ctx.channel.channel) return 'not_claimed'
  const sms = ctx.channel.channel === 'sms'
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
  if (sms ? await smsClosedNow(ctx, row) : row.kind !== 'visit_on_the_way' && isQuietHour(ctx.hour, ctx.settings)) return 'deferred'
  if (ctx.budget.left <= 0) {
    ctx.stats.deferred++
    return 'deferred'
  }
  if (sms && (await smsCapReached(ctx, row))) {
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
    p_max: sms ? smsPerNumberCap(row.kind) : MAX_PER_ADDRESS_PER_DAY,
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
  let rendered = built.render(links, prepared)
  if (sms) rendered = await finalizeText(ctx, row, built.to, rendered)
  const out = await ctx.channel.send(built.to, rendered, {
    from: ctx.from,
    replyTo: ctx.replyTo,
    messageId: messageIdFor(ctx, row.id),
    unsubscribeUrl: links.unsubscribe,
    unsubscribePostUrl: links.unsubscribePost,
    smsFrom: ctx.sms?.from ?? null,
  })
  if (out.ok) {
    const segments = sms ? (out.segments ?? countSegments(rendered.sms).segments) : null
    await finish(ctx, row, {
      status: 'sent',
      sent_at: new Date().toISOString(),
      customer_id: built.customerId,
      subject: rendered.subject.slice(0, 300),
      last_error: null,
      ...(sms ? { provider_message_id: out.providerId, segments, delivery_status: 'sent' } : {}),
    })
    if (sms && out.providerId) {
      if (ctx.sms && ctx.sms.sentToday != null) ctx.sms.sentToday++
      await logUsage(ctx.admin, ctx.orgId, { direction: 'out', kind: row.kind, segments: segments ?? 1, costMicros: out.costMicros ?? priceMicros('out', segments ?? 1, getSmsProvider()?.id), providerMessageId: out.providerId, customerMessageId: row.id, at: ctx.now })
    }
    ctx.stats.sent++
    return 'sent'
  }
  if (out.permanent) {
    // A text the carrier refused because the person already texted STOP to the carrier is an opt-out, not a bad number.
    const reason: SuppressionReason = sms && out.optedOut ? 'unsubscribed' : 'bounced'
    await suppressAddress(ctx.admin, ctx.orgId, ctx.channel.channel, built.to, reason, { messageId: row.id, detail: out.error }).catch((e) =>
      console.error('[customer-messages] could not suppress a bounced address', { orgId: ctx.orgId, e })
    )
    await finish(ctx, row, { status: 'skipped', skip_reason: reason === 'unsubscribed' ? 'suppressed' : 'bounced', last_error: out.error, ...(sms ? { delivery_status: 'failed', provider_error: out.error.slice(0, 300) } : {}) })
    ctx.stats.skipped++
    return 'skipped'
  }
  if (sms && out.unknown) {
    // A text that may have gone out is NEVER sent again by us (the customer would get it twice): closed as failed, no retries.
    await finish(ctx, row, { status: 'failed', attempts: MAX_SEND_ATTEMPTS, last_error: `unknown (may have been sent, not retried): ${out.error}`.slice(0, 300) })
    ctx.stats.failed++
    return 'failed'
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

// ── Texts: the rules that are only about SMS ────────────────────────────────────────────────────────────────────────

/** Texts to one number per 24 hours, by kind: automation is capped low, a person's conversation is not, the STOP answer never. */
function smsPerNumberCap(kind: RowKind): number {
  return kind === 'sms_compliance' ? 1000 : kind === 'staff_reply' ? SMS_MAX_STAFF_PER_NUMBER_PER_DAY : SMS_MAX_PER_NUMBER_PER_DAY
}

/**
 * Is this the wrong hour for this text? The company's quiet hours and the 8 AM / 9 PM floor — except the STOP answer (the
 * carrier requires it at once) and a staff reply to a customer who texted in the last 2 hours (a conversation).
 */
async function smsClosedNow(ctx: SendContext, row: MessageRow): Promise<boolean> {
  if (row.kind === 'sms_compliance') return false
  const phone = ctx.channel.addressFor({ email: null, phone: await rowPhone(ctx, row) })
  const zones = smsZones(ctx.timeZone, phone)
  if (row.kind === 'staff_reply' && phone && (await inConversation(ctx.admin, ctx.orgId, phone, ctx.now))) {
    // A conversation the customer started: past the company's quiet hours is fine, past 8 AM–9 PM (their clock too) is not.
    return zones.some((z) => outsideSmsFloor(hourInZone(ctx.now, z)))
  }
  return zones.some((z) => isSmsQuietHour(hourInZone(ctx.now, z), ctx.settings))
}

/** The company's own ceiling for texts in one day (a runaway guard); the STOP answer is exempt. */
async function smsCapReached(ctx: SendContext, row: MessageRow): Promise<boolean> {
  if (!ctx.sms || row.kind === 'sms_compliance') return false
  if (ctx.sms.sentToday == null) ctx.sms.sentToday = await sentToday(ctx.admin, ctx.orgId, ctx.now, ctx.timeZone)
  return ctx.sms.sentToday >= ctx.sms.dailyCap
}

async function rowPhone(ctx: SendContext, row: MessageRow): Promise<string | null> {
  if (row.kind === 'sms_compliance') return str(row.refs.to)
  return (await loadCustomer(ctx.admin, ctx.orgId, row.customer_id))?.phone ?? null
}

/**
 * The text as it goes out: plain characters (stays GSM-7 = cheap), and — on the FIRST text this number ever gets from the
 * company — "Reply STOP to opt out." A staff reply starts with the company's name on that first text (automatic texts
 * always begin with it). The STOP / HELP answers are sent exactly as written.
 */
async function finalizeText(ctx: SendContext, row: MessageRow, to: string, m: RenderedMessage): Promise<RenderedMessage> {
  if (row.kind === 'sms_compliance') return { ...m, sms: smsWords(m.sms, { first: false }) }
  const { count } = await orgDb(ctx.admin, ctx.orgId).from('customer_messages').select('id', { count: 'exact', head: true }).eq('channel', 'sms').eq('to_address', to).eq('status', 'sent')
  const first = (count ?? 0) === 0
  return { ...m, sms: smsWords(m.sms, { first, namePrefix: row.kind === 'staff_reply' && first ? ctx.company.name : null }) }
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
    case 'staff_reply':
      return buildStaffReply(ctx, row)
    case 'sms_compliance':
      return buildCompliance(ctx, row)
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
  if (!kindSentOn(ctx.settings, 'visit_reminder', ctx.channel.channel)) return { send: false, status: 'cancelled', reason: 'turned_off' }
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
  const to = ctx.channel.addressFor({ email: customer?.email ?? null, phone: customer?.phone ?? null })
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
  if (!kindSentOn(ctx.settings, done ? 'visit_done' : 'visit_on_the_way', ctx.channel.channel)) return { send: false, status: 'cancelled', reason: 'turned_off' }
  const customer = await loadCustomer(ctx.admin, ctx.orgId, v.customer_id)
  const to = ctx.channel.addressFor({ email: customer?.email ?? null, phone: customer?.phone ?? null })
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
  if (!kindSentOn(ctx.settings, 'quote_follow_up', ctx.channel.channel)) return { send: false, status: 'cancelled', reason: 'turned_off' }
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
  const to = ctx.channel.addressFor({ email: p.customer_email || customer?.email || null, phone: customer?.phone ?? null })
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
  if (!kindSentOn(ctx.settings, 'invoice_reminder', ctx.channel.channel)) return { send: false, status: 'cancelled', reason: 'turned_off' }
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
  const to = ctx.channel.addressFor({ email: doc.billTo.email, phone: customer?.phone ?? null })
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

// ── A staff member's text, and the carrier-required STOP / HELP / START answers ──────────────────────────────────────────

/** How long a staff text waits for texting hours before it is dropped (it is a reply: stale after a day). */
export const STAFF_TEXT_EXPIRES_HOURS = 24

/**
 * A reply a staff member wrote "To customer" and chose to send by text (refs: the thread message's id). Re-checked at send
 * time like every kind: the message must still exist, not be removed, and still be said TO the customer; the number must
 * pass the same consent / opt-out rules as an automatic text. The words are the staff member's own, unchanged.
 */
async function buildStaffReply(ctx: SendContext, row: MessageRow): Promise<Built> {
  if (ctx.channel.channel !== 'sms') return { send: false, status: 'cancelled', reason: 'bad_channel' }
  const activityId = str(row.refs.activityId)
  if (!activityId || !row.customer_id) return { send: false, status: 'cancelled', reason: 'bad_refs' }
  const { data } = await orgDb(ctx.admin, ctx.orgId).from('activities').select('id, body, audience, customer_id, deleted_at').eq('id', activityId).maybeSingle()
  const a = data as { id: string; body: string | null; audience: string | null; customer_id: string | null; deleted_at: string | null } | null
  if (!a || a.deleted_at || a.audience !== 'customer' || a.customer_id !== row.customer_id || !a.body?.trim()) return { send: false, status: 'cancelled', reason: 'message_gone' }
  const customer = await loadCustomer(ctx.admin, ctx.orgId, row.customer_id)
  const to = ctx.channel.addressFor({ email: null, phone: customer?.phone ?? null })
  const refusal = await recipientRefusal(ctx, customer, to, true)
  if (refusal) return { send: false, status: 'skipped', reason: refusal.reason, to }
  const body = a.body.trim()
  return {
    send: true,
    customerId: row.customer_id,
    to: to!,
    render: (links) => ({ ...renderCustomerReply(msgCtx(ctx, customer, links), { body, accountUrl: null }), sms: body }),
  }
}

/** The STOP / HELP / START answer (refs: `to` and the exact `text`). Goes even to a number on the opt-out list — it IS the answer. */
async function buildCompliance(ctx: SendContext, row: MessageRow): Promise<Built> {
  const to = ctx.channel.addressFor({ email: null, phone: str(row.refs.to) })
  const text = str(row.refs.text)
  if (ctx.channel.channel !== 'sms' || !to || !text) return { send: false, status: 'cancelled', reason: 'bad_refs' }
  return { send: true, customerId: row.customer_id, to, render: () => ({ subject: 'Text reply', html: '', text, sms: text }) }
}

export type StaffTextResult = {
  status: 'sent' | 'queued' | 'failed' | 'skipped' | 'cancelled' | 'blocked' | 'off' | 'not_ready' | 'already'
  /** Plain words for the person who tapped Send ("Will go out at 8 AM"). */
  note?: string
}

/**
 * Text a customer a reply a staff member wrote (thread audience "To customer", sent by text). The ONE staff text door:
 * a `staff_reply` row in the same send log, delivered by the same `deliver` — so consent, opt-out, quiet hours, the daily
 * caps, the company number and idempotency (one row per thread message) are the same rules as every automatic text.
 * Outside texting hours the row waits and the next scheduled run sends it (it expires after STAFF_TEXT_EXPIRES_HOURS).
 */
export async function sendStaffText(admin: SupabaseClient, orgId: string, customerId: string, activityId: string, createdBy: string | null, now: Date = new Date()): Promise<StaffTextResult> {
  try {
    const loaded = await loadSendContext(admin, orgId, now, { channel: 'sms', purpose: 'reply' })
    if (!loaded.ok) return { status: loaded.reason === 'feature_off' ? 'off' : 'not_ready' }
    const ctx = loaded.ctx
    const row = await enqueueMessage(admin, orgId, {
      kind: 'staff_reply',
      channel: 'sms',
      key: `staff_reply:sms:${activityId}`,
      customerId,
      refs: { activityId },
      sendAfter: now,
      expiresAt: new Date(now.getTime() + STAFF_TEXT_EXPIRES_HOURS * 3_600_000),
      createdBy,
    })
    if (!row) return { status: 'already' }
    const r = await deliver(ctx, row)
    if (r === 'sent') return { status: 'sent' }
    if (r === 'deferred') return { status: 'queued', note: 'It’s outside texting hours, so it will go out when they start again.' }
    if (r === 'not_claimed') return { status: 'already' }
    return { status: r }
  } catch (e) {
    console.error('[customer-messages] staff text failed', { orgId, e })
    return { status: 'failed' }
  }
}

/**
 * Send the carrier-required answer to a STOP / HELP / START (never throws). Idempotent per inbound message: the key is the
 * carrier's own message id, so a retried webhook cannot answer twice.
 */
export async function sendComplianceText(admin: SupabaseClient, orgId: string, o: { inboundId: string; to: string; text: string; customerId: string | null }, now: Date = new Date()): Promise<'sent' | 'skipped' | 'off'> {
  try {
    const loaded = await loadSendContext(admin, orgId, now, { channel: 'sms', purpose: 'compliance' })
    if (!loaded.ok) return 'off'
    const row = await enqueueMessage(admin, orgId, { kind: 'sms_compliance', channel: 'sms', key: `sms_compliance:${o.inboundId}`, customerId: o.customerId, refs: { to: o.to, text: o.text }, sendAfter: now })
    if (!row) return 'skipped'
    return (await deliver(loaded.ctx, row)) === 'sent' ? 'sent' : 'skipped'
  } catch (e) {
    console.error('[customer-messages] compliance text failed', { orgId, e })
    return 'skipped'
  }
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
      channel: ctx.channel.channel,
      key: messageKey.visitReminder(ctx.channel.channel, g.customerId, g.day),
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
    items.push({ kind: 'quote_follow_up', channel: ctx.channel.channel, key: messageKey.quoteFollowUp(ctx.channel.channel, p.id, step), customerId: null, refs: { proposalId: p.id, step }, sendAfter: ctx.now })
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
      items.push({ kind: 'invoice_reminder', channel: ctx.channel.channel, key: messageKey.invoiceReminder(ctx.channel.channel, inv.id, step), customerId: inv.customer_id, refs: { invoiceId: inv.id, step }, sendAfter: ctx.now })
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
    .eq('channel', ctx.channel.channel)
    .eq('status', 'sending')
    .lt('claimed_at', new Date(ctx.now.getTime() - STALE_SENDING_MS).toISOString())
}

/** Everything due to go: queued rows and failed ones with tries left, oldest first. */
async function drain(ctx: SendContext): Promise<void> {
  const { data, error } = await orgDb(ctx.admin, ctx.orgId)
    .from('customer_messages')
    .select(ROW_COLS)
    .eq('channel', ctx.channel.channel)
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

export type OrgRunResult = { orgId: string; skipped?: string; stats?: RunStats; /** Texts: only present once the company has the `texting` switch on and a number. */ sms?: { skipped?: string; stats?: RunStats } }

/** One channel's scheduled run: scans (when automatic messages are on for it), then everything due to go. */
async function runChannel(ctx: SendContext): Promise<void> {
  await closeStaleSends(ctx)
  const sms = ctx.channel.channel === 'sms'
  const closed = sms ? isSmsQuietHour(ctx.hour, ctx.settings) : isQuietHour(ctx.hour, ctx.settings)
  if (ctx.autoOn && !closed) {
    const ch = ctx.channel.channel
    const s = ctx.settings
    const scans: Array<[boolean, (c: SendContext) => Promise<void>, string]> = [
      [kindSentOn(s, 'visit_reminder', ch), scanVisitReminders, 'visit reminders'],
      [kindSentOn(s, 'invoice_reminder', ch), scanInvoiceReminders, 'invoice reminders'],
      [kindSentOn(s, 'quote_follow_up', ch), scanQuoteFollowUps, 'quote follow-ups'],
    ]
    for (const [on, scan, label] of scans) {
      if (!on) continue
      await scan(ctx).catch((e) => console.error(`[customer-messages] ${ch} ${label} scan failed`, { orgId: ctx.orgId, e }))
    }
  }
  // "On the way" emails may still be waiting (an SMTP blip); they go even in quiet hours, the rest wait (deliver decides).
  await drain(ctx)
}

/** The scheduled run for one company (cron). Never throws for a single bad message; a scan failure is reported. */
export async function runCustomerMessagesForOrg(admin: SupabaseClient, orgId: string, now: Date = new Date()): Promise<OrgRunResult> {
  const loaded = await loadSendContext(admin, orgId, now)
  const result: OrgRunResult = { orgId }
  if (loaded.ok) {
    await runChannel(loaded.ctx)
    result.stats = loaded.ctx.stats
  } else result.skipped = loaded.reason
  // Texts: its own context (the company's number, the texting switch). A company without texting costs one feature read.
  const text = await loadSendContext(admin, orgId, now, { channel: 'sms', purpose: 'reply' })
  if (text.ok) {
    await runChannel(text.ctx)
    result.sms = { stats: text.ctx.stats }
  } else if (text.reason !== 'feature_off') result.sms = { skipped: text.reason }
  return result
}

// ── Events (crew taps) ──────────────────────────────────────────────────────────────────────────────────────────────

export type EventResult = { status: 'sent' | 'queued' | 'already' | 'off' | 'not_today' | 'not_ready' | 'failed' | 'skipped' | 'cancelled' | 'deferred' | 'blocked' }

async function visitForEvent(admin: SupabaseClient, orgId: string, visitId: string): Promise<VisitRow | null> {
  const { data } = await orgDb(admin, orgId).from('work_orders').select(VISIT_COLS).eq('id', visitId).eq('work_order_type', SERVICE_VISIT_TYPE).maybeSingle()
  return (data as VisitRow | null) ?? null
}

/** The channels an event message goes on for this company: each one its owner chose ('how') and that is ready to send. */
const CHANNEL_ORDER: readonly MessageChannel[] = ['email', 'sms']

/** The crew tapped "On my way": the customer gets it now (once per visit per day, per channel the owner chose). */
export async function notifyVisitOnTheWay(admin: SupabaseClient, orgId: string, visitId: string, now: Date = new Date()): Promise<EventResult> {
  let result: EventResult = { status: 'off' }
  for (const channel of CHANNEL_ORDER) {
    const loaded = await loadSendContext(admin, orgId, now, { channel })
    if (!loaded.ok) {
      if (channel === 'email' && loaded.reason === 'not_ready') result = { status: 'not_ready' }
      continue
    }
    const ctx = loaded.ctx
    if (!kindSentOn(ctx.settings, 'visit_on_the_way', channel)) continue
    const v = await visitForEvent(admin, orgId, visitId)
    if (!v || v.status !== 'scheduled' || v.scheduled_date !== ctx.today) {
      if (result.status === 'off') result = { status: 'not_today' }
      continue
    }
    const row = await enqueueMessage(admin, orgId, {
      kind: 'visit_on_the_way',
      channel,
      key: messageKey.onTheWay(channel, visitId, ctx.today),
      customerId: v.customer_id,
      refs: { visitId },
      sendAfter: now,
      expiresAt: new Date(now.getTime() + ON_THE_WAY_EXPIRES_MINUTES * 60_000),
    })
    const r: EventResult = !row ? { status: 'already' } : await deliver(ctx, row).then((d) => ({ status: d === 'not_claimed' ? 'already' : d }) as EventResult)
    // The first channel that actually did something is the answer the crew's screen shows.
    if (result.status === 'off' || result.status === 'not_today' || result.status === 'not_ready' || (r.status === 'sent' && result.status !== 'sent')) result = r
  }
  return result
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
    const settings = messageSettingsOf(o.settings)
    // Email as the owner chose; a text only while the `texting` switch is on too.
    const channels = CHANNEL_ORDER.filter((c) => kindSentOn(settings, 'visit_done', c) && (c === 'email' || features.texting))
    if (channels.length === 0) return { status: 'off' }
    const today = ymdInZone(now, orgTimeZone(o.timezone))
    const v = await visitForEvent(admin, orgId, visitId)
    if (!v || v.status !== 'completed' || v.scheduled_date !== today) return { status: 'not_today' }
    let queued = false
    for (const channel of channels) {
      const row = await enqueueMessage(admin, orgId, {
        kind: 'visit_done',
        channel,
        key: messageKey.visitDone(channel, visitId),
        customerId: v.customer_id,
        refs: { visitId },
        sendAfter: new Date(now.getTime() + DONE_DELAY_MINUTES * 60_000),
        expiresAt: new Date(now.getTime() + DONE_EXPIRES_HOURS * 3_600_000),
      })
      if (row) queued = true
    }
    return { status: queued ? 'queued' : 'already' }
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
  if (row.channel === 'sms') {
    // A text's page link: stopping texts to THIS number. The customer's email stays as it was.
    if (row.to_address) await recordConsent(admin, row.org_id, { customerId: row.customer_id, phone: row.to_address, status: 'revoked', source: 'sms_stop', evidence: { via: 'message_page', messageId: row.id } })
    return
  }
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
  // The one "what may a customer see" rule (lib/customer-visit-photos.ts), shared with the portal.
  const photos = await loadCustomerVisitPhotos(admin, row.org_id, [visitId], { limit: 40 })
  const { signFilesObject } = await import('@/lib/files/files-object')
  const out: string[] = []
  for (const p of photos.slice().reverse()) {
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


// ── A staff reply "To customer" (Customer File thread) ──────────────────────────────────────────────────────────────

/**
 * Email the customer a reply a staff member wrote "To customer". It goes through the SAME checks as every customer email:
 * the company's `customerMessages` switch and identity (loadSendContext — name / email / address on file, mail set up),
 * then the recipient rules (office "don't email", suppression list). With the switch off nothing is emailed; the portal
 * still shows the reply. Company From / Reply-To. Never throws.
 */
export async function sendCustomerReply(
  admin: SupabaseClient,
  orgId: string,
  customerId: string,
  activityId: string,
  body: string,
  how: { channel?: 'email' | 'sms'; userId?: string | null } = {}
): Promise<'sent' | 'skipped' | 'off' | 'not_ready' | 'failed' | 'queued'> {
  if (how.channel === 'sms') {
    // By text: through the one send log (consent, opt-out, hours, caps). The words come from the thread message itself.
    const r = await sendStaffText(admin, orgId, customerId, activityId, how.userId ?? null)
    return r.status === 'sent' ? 'sent' : r.status === 'queued' ? 'queued' : r.status === 'off' ? 'off' : r.status === 'not_ready' ? 'not_ready' : r.status === 'failed' ? 'failed' : r.status === 'already' ? 'skipped' : 'skipped'
  }
  try {
    const loaded = await loadSendContext(admin, orgId)
    if (!loaded.ok) return loaded.reason === 'feature_off' || loaded.reason === 'all_off' ? 'off' : 'not_ready'
    const ctx = loaded.ctx
    if (ctx.blocked) return 'not_ready'
    const customer = await loadCustomer(admin, orgId, customerId)
    const to = ctx.channel.addressFor({ email: customer?.email ?? null, phone: null })
    if (await recipientRefusal(ctx, customer, to)) return 'skipped'
    const portalOn = (await loadOrgFeatures(admin, orgId)).customerPortal
    const appUrl = ctx.appUrl
    const id = { company: ctx.company, from: ctx.from }
    const channel = ctx.channel
    const rendered = renderCustomerReply({ company: id.company, customerName: customer?.name ?? null, unsubscribeUrl: null }, { body, accountUrl: portalOn && appUrl ? `${appUrl}/portal` : null })
    let host = 'localhost'
    try {
      host = appUrl ? new URL(appUrl).hostname || host : host
    } catch {
      /* keep localhost */
    }
    const out = await channel.send(to as string, rendered, { from: id.from, replyTo: ctx.replyTo, messageId: `<cr-${activityId}@${host}>`, unsubscribeUrl: null, unsubscribePostUrl: null })
    return out.ok ? 'sent' : 'failed'
  } catch (e) {
    console.error('[customer-messages] reply email failed', { orgId, e })
    return 'failed'
  }
}
