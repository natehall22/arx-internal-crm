import { isThreadSchemaMissing, SCHEMA_PENDING_MESSAGE } from '@/lib/threads/schema-guard'
import type { SupabaseClient } from '@supabase/supabase-js'

import { contactBody, type ContactKind, type ContactOutcome } from '@/lib/customer-contact'
import { mentionCandidates, resolveNoteMentions } from '@/lib/note-mentions'
import { orgDb } from '@/lib/supabase/org-db'
import { jobIdForDeal } from '@/lib/threads/job-notes'
import { toMessage, type ThreadMessage } from '@/lib/threads/get-thread'
import { loadOrgFeatures } from '@/lib/org-features'
import { resolveThreadViewer } from '@/lib/threads/viewer'
import {
  canReadMessage,
  defaultAudience,
  looksLikePricing,
  writableAudiences,
  type Audience,
  type DealRef,
  type Priority,
  type Surface,
  type ThreadViewer,
} from '@/lib/threads/visibility'

/**
 * THE write path for deal conversations. The composer's audience chip is only a request:
 * audience, pricing flag, mentions, priority and recipients are all decided here.
 */

export const MAX_MESSAGE_LENGTH = 5000
const URGENT_PER_DAY = 3

export type MessageDraft = {
  body: string
  surface?: Surface
  /** requested audience; ignored unless the viewer may write it */
  audience?: Audience | null
  replyToId?: string | null
  /** ids picked in the @ dropdown — only disambiguate same-named users, never add anyone */
  selectedMentionIds?: string[]
  priority?: Priority | null
  /** "Let setters see it" — only honoured when the author may; default flags pricing. */
  allowSetters?: boolean
  clientId?: string | null
  source?: string | null
  /** A logged call/text/email/visit: the row is written as that type with its outcome, and `body` becomes the optional note. */
  contact?: { kind: ContactKind; outcome: ContactOutcome } | null
}

export type PostResult =
  | {
      ok: true
      message: ThreadMessage
      /** users to notify, already filtered to people who can read the message */
      recipients: { userId: string; priority: Priority; reason: 'mention' | 'reply' | 'urgent' }[]
      /** true when this is the original of a retried (same clientId) post: nothing new was written, so nothing may be sent */
      replayed?: boolean
      /** mentioned people who may NOT read it (they get a content-free ping) */
      blindMentions: string[]
      pricingNotice: boolean
    }
  | { ok: false; status: 400 | 403 | 404 | 409 | 429 | 503; error: string }

export type DealForPost = {
  id: string
  owner_user_id: string | null
  setter_user_id: string | null
  customer_id: string | null
  lead_id: string | null
  closer_user_ids?: string[]
  extra_user_ids?: string[]
}

type OrgUser = { id: string; full_name: string | null; email: string | null; active: boolean | null; role: string; custom_role_id: string | null; is_super_admin: boolean | null; org_id: string }

/** "?" at the end of a sentence, or a leading question word, aimed at someone = needs a reply. */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim()
  if (/\?\s*$/.test(t) || /\?[\s)"'\]]*$/.test(t)) return true
  return /\b(can|could|will|would|did|do|does|are|is|when|where|who|what|why|how)\b[^.!?]{0,120}\?/i.test(t)
}

export async function postMessage(
  admin: SupabaseClient,
  profile: { id: string; org_id: string; role: string; custom_role_id?: string | null; is_super_admin?: boolean | null; active?: boolean | null },
  deal: DealForPost,
  draft: MessageDraft,
  opts: { viewer?: ThreadViewer; now?: Date; resolveViewer?: (u: OrgUser) => Promise<ThreadViewer> } = {}
): Promise<PostResult> {
  const contact = draft.contact ?? null
  const body = contact ? contactBody(contact, draft.body) : String(draft.body ?? '').trim()
  if (!body) return { ok: false, status: 400, error: 'Message is required' }
  if (body.length > MAX_MESSAGE_LENGTH) return { ok: false, status: 400, error: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters)` }

  const viewer = opts.viewer ?? (await resolveThreadViewer(admin, profile))
  const dealRef: DealRef = { owner_user_id: deal.owner_user_id, setter_user_id: deal.setter_user_id, closer_user_ids: deal.closer_user_ids ?? [], extra_user_ids: deal.extra_user_ids ?? [] }
  const features = await loadOrgFeatures(admin, viewer.orgId)
  const allowed = writableAudiences(viewer, dealRef, features.customerPortal || features.customerMessages || features.texting)
  if (allowed.length === 0) return { ok: false, status: 403, error: 'You cannot post on this deal' }

  // Idempotent retry (offline outbox): the same client_id returns the original message.
  if (draft.clientId) {
    const { data: existing } = await admin
      .from('activities')
      .select('id')
      .eq('client_id', draft.clientId)
      .eq('org_id', viewer.orgId)
      .eq('user_id', viewer.userId)
      .maybeSingle()
    if (existing) {
      const prior = await loadMessage(admin, viewer.orgId, (existing as { id: string }).id)
      if (prior) return { ok: true, message: prior, recipients: [], blindMentions: [], pricingNotice: false, replayed: true }
    }
  }

  // A reply inherits the parent's audience and pricing flag, and must be one the author can read.
  let parent: ThreadMessage | null = null
  if (draft.replyToId) {
    parent = await loadMessage(admin, viewer.orgId, draft.replyToId)
    const { data: parentRow } = await admin.from('activities').select('opportunity_id').eq('id', draft.replyToId).eq('org_id', viewer.orgId).maybeSingle()
    if (!parent || (parentRow as { opportunity_id: string | null } | null)?.opportunity_id !== deal.id || !canReadMessage(viewer, dealRef, parent)) {
      return { ok: false, status: 404, error: 'Reply target not found' }
    }
  }

  let audience: Audience
  // A reply inherits the parent's audience, never 'customer' (that one is always chosen on purpose).
  if (parent?.audience && parent.audience !== 'customer' && allowed.includes(parent.audience)) {
    audience = parent.audience
  } else if (draft.audience) {
    if (!allowed.includes(draft.audience)) return { ok: false, status: 403, error: `You cannot write ${draft.audience} messages` }
    audience = draft.audience
  } else {
    audience = defaultAudience(viewer, { surface: draft.surface ?? 'other', replyTo: parent }, dealRef)
  }
  // "To customer" needs a customer to send it to (it is emailed and shown in their portal).
  if (audience === 'customer' && !deal.customer_id) return { ok: false, status: 409, error: 'This deal has no customer on file yet, so there is nobody to send it to.' }
  // A customer contact is never crew talk, and job catch-up does not read sales-audience rows: log it as team
  // (or production when that was picked) so it always shows as the job's "last customer contact".
  if (contact && audience !== 'team' && audience !== 'production') {
    if (!allowed.includes('team')) return { ok: false, status: 403, error: 'You cannot log a contact on this deal' }
    audience = 'team'
  }

  // Pricing guard: flagged by default when it looks like pricing; an author who may
  // see pricing can opt setters in; a setter-like author can never un-flag.
  const pricing = looksLikePricing(body)
  // A pricing-barred author (setter) has no prices to protect and could not read their own
  // flagged message, so only authors who may see pricing set the flag.
  // Crew messages leave the building on the crew link: a price-looking one is ALWAYS flagged, and the
  // crew link never shows flagged messages.
  const restricted =
    parent?.restricted_pricing === true ||
    (pricing && audience === 'crew') ||
    (pricing && !viewer.pricingBarred && draft.allowSetters !== true)

  // Someone has to be waiting for a needs-reply / urgent to mean anything: the people @mentioned, or the author of the message replied to.
  let priority: Priority = 'fyi'

  // Mentions: exact "@Full Name" only. The picker's ids just disambiguate duplicates.
  const { data: orgUsers } = await admin
    .from('users')
    .select('id, full_name, email, active, role, custom_role_id, is_super_admin, org_id')
    .eq('org_id', viewer.orgId)
    .eq('active', true)
  const candidates = mentionCandidates(((orgUsers ?? []) as OrgUser[]).map((u) => ({ ...u })))
  const mentioned = resolveNoteMentions(body, candidates, draft.selectedMentionIds ?? [])
    .filter((u) => u.id !== viewer.userId)

  const parentAuthor = parent?.user_id && parent.user_id !== viewer.userId ? parent.user_id : null
  const hasAudience = mentioned.length > 0 || !!parentAuthor
  if (hasAudience) {
    if (draft.priority === 'urgent') priority = 'urgent'
    else if (draft.priority === 'needs_reply' || (mentioned.length > 0 && looksLikeQuestion(body))) priority = 'needs_reply'
  }

  if (priority === 'urgent') {
    const since = new Date((opts.now ?? new Date()).getTime() - 24 * 3600 * 1000).toISOString()
    const { count } = await admin
      .from('activities')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', viewer.orgId)
      .eq('user_id', viewer.userId)
      .eq('priority', 'urgent')
      .gte('created_at', since)
    if ((count ?? 0) >= URGENT_PER_DAY) {
      return { ok: false, status: 429, error: `Urgent is limited to ${URGENT_PER_DAY} a day` }
    }
  }

  const thread = await ensureThread(admin, viewer.orgId, deal)

  const { data: inserted, error } = await admin
    .from('activities')
    .insert({
      org_id: viewer.orgId,
      opportunity_id: deal.id,
      customer_id: deal.customer_id,
      lead_id: deal.lead_id,
      thread_id: thread?.id ?? null,
      production_job_id: audience === 'production' || audience === 'crew' ? await jobIdForDeal(admin, viewer.orgId, deal.id) : null,
      user_id: viewer.userId,
      type: contact ? contact.kind : 'note',
      ...(contact ? { contact_outcome: contact.outcome } : {}),
      body,
      origin: 'human',
      audience,
      restricted_pricing: restricted,
      priority,
      reply_to_id: parent?.id ?? null,
      mentioned_user_ids: mentioned.map((u) => u.id),
      client_id: draft.clientId ?? null,
      source: draft.source ?? 'web',
    })
    .select('id')
    .single()
  if (error || !inserted) {
    // A retry racing its own first attempt hits the unique client_id index: the message DID post — return it.
    if (draft.clientId) {
      const { data: again } = await admin.from('activities').select('id').eq('client_id', draft.clientId).eq('org_id', viewer.orgId).eq('user_id', viewer.userId).maybeSingle()
      const prior = again ? await loadMessage(admin, viewer.orgId, (again as { id: string }).id) : null
      if (prior) return { ok: true, message: prior, recipients: [], blindMentions: [], pricingNotice: false, replayed: true }
    }
    // Code live before migration 202610270010: a clear, retryable answer, nothing half-written.
    if (isThreadSchemaMissing(error)) return { ok: false, status: 503, error: SCHEMA_PENDING_MESSAGE }
    return { ok: false, status: 409, error: 'Failed to post message' }
  }

  const message = (await loadMessage(admin, viewer.orgId, (inserted as { id: string }).id)) as ThreadMessage
  if (thread) {
    await admin.from('threads').update({ last_message_at: message.created_at }).eq('id', thread.id).eq('org_id', viewer.orgId)
    // Membership (thread_id, user_id is its key): update the author's own row, else add it. Every step names the company.
    const member = orgDb(admin, viewer.orgId).from('thread_members')
    const { data: have } = await member.select('thread_id').eq('thread_id', thread.id).eq('user_id', viewer.userId).maybeSingle()
    if (have) await orgDb(admin, viewer.orgId).from('thread_members').update({ last_read_at: message.created_at }).eq('thread_id', thread.id).eq('user_id', viewer.userId)
    else await orgDb(admin, viewer.orgId).from('thread_members').insert({ thread_id: thread.id, user_id: viewer.userId, reason: 'joined', last_read_at: message.created_at })
  }

  // Who hears about it. Content follows the RECIPIENT's rights: a mentioned person who
  // cannot read the audience still gets a content-free ping, and is never added to the audience.
  const recipients: { userId: string; priority: Priority; reason: 'mention' | 'reply' | 'urgent' }[] = []
  const blindMentions: string[] = []
  const seen = new Set<string>()
  const readers = new Map<string, boolean>()
  for (const u of mentioned) {
    const rv = await (opts.resolveViewer ?? ((x) => resolveThreadViewer(admin, x)))(u as OrgUser)
    const canRead = canReadMessage(rv, dealRef, message)
    readers.set(u.id, canRead)
    seen.add(u.id)
    if (canRead) recipients.push({ userId: u.id, priority, reason: priority === 'urgent' ? 'urgent' : 'mention' })
    else blindMentions.push(u.id)
  }
  if (parent?.user_id && parent.user_id !== viewer.userId && !seen.has(parent.user_id)) {
    const pu = ((orgUsers ?? []) as OrgUser[]).find((u) => u.id === parent!.user_id)
    if (pu) {
      const rv = await (opts.resolveViewer ?? ((x) => resolveThreadViewer(admin, x)))(pu)
      if (canReadMessage(rv, dealRef, message)) recipients.push({ userId: pu.id, priority: priority === 'fyi' ? 'fyi' : priority, reason: priority === 'urgent' ? 'urgent' : 'reply' })
    }
  }

  return { ok: true, message, recipients, blindMentions, pricingNotice: restricted && !parent?.restricted_pricing }
}

export async function loadMessage(admin: SupabaseClient, orgId: string, id: string): Promise<ThreadMessage | null> {
  const { data } = await admin
    .from('activities')
    .select(
      'id, user_id, type, body, created_at, audience, origin, priority, restricted_pricing, reply_to_id, mentioned_user_ids, pinned_at, pin_scope, pin_expires_at, edited_at, deleted_at, deleted_user_name, users(full_name)'
    )
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle()
  return data ? toMessage(data as never) : null
}

/** One thread per deal (prospect threads re-key onto the deal when the lead converts). */
export async function ensureThread(
  admin: SupabaseClient,
  orgId: string,
  deal: { id: string; customer_id: string | null; lead_id: string | null }
): Promise<{ id: string } | null> {
  const { data: found } = await admin.from('threads').select('id').eq('org_id', orgId).eq('opportunity_id', deal.id).eq('kind', 'deal').maybeSingle()
  if (found) return found as { id: string }
  const { data: created, error } = await admin
    .from('threads')
    .insert({ org_id: orgId, kind: 'deal', opportunity_id: deal.id, customer_id: deal.customer_id, lead_id: deal.lead_id })
    .select('id')
    .single()
  if (error) {
    // Lost a race against the unique index — the other writer's row is the thread.
    const { data: again } = await admin.from('threads').select('id').eq('org_id', orgId).eq('opportunity_id', deal.id).eq('kind', 'deal').maybeSingle()
    return (again as { id: string } | null) ?? null
  }
  return created as { id: string }
}

/**
 * What a customer's own words may write: ONE customer's message, on their latest deal (or, with no deal, on the customer
 * alone). `origin` says how it arrived: their portal (default) or a text to the company's number.
 */
export type CustomerPortalPost = { orgId: string; customerId: string; body: string; clientId?: string | null; origin?: 'customer_portal' | 'sms' }

/**
 * The customer wrote to the company — from their portal, or by text. Written through THIS module (the one write path for
 * conversations) as an ordinary team-audience row — `origin: 'customer_portal'` / `'sms'`, no user, type 'text' so job
 * catch-up reads it as the customer's own contact. Staff see it in the Customer File thread like any other message; the
 * customer sees only their own rows (audience 'customer', or origin 'customer_portal' / 'sms') through `loadPortalThread`.
 * With a `clientId` the write is idempotent: the same id returns the first row (a carrier retrying a webhook).
 */
export async function postCustomerMessage(admin: SupabaseClient, p: CustomerPortalPost): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const body = String(p.body ?? '').trim()
  if (!body) return { ok: false, error: 'Message is required' }
  if (body.length > 2000) return { ok: false, error: 'Message is too long' }
  const origin = p.origin ?? 'customer_portal'
  if (p.clientId) {
    const { data: again } = await admin.from('activities').select('id').eq('org_id', p.orgId).eq('client_id', p.clientId).eq('origin', origin).maybeSingle()
    if (again) return { ok: true, id: (again as { id: string }).id }
  }
  // The customer's most recent deal, if any (org- and customer-scoped).
  const { data: deal } = await admin
    .from('opportunities')
    .select('id, customer_id, lead_id')
    .eq('org_id', p.orgId)
    .eq('customer_id', p.customerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const d = deal as { id: string; customer_id: string | null; lead_id: string | null } | null
  const thread = d ? await ensureThread(admin, p.orgId, d) : null
  const { data, error } = await admin
    .from('activities')
    .insert({
      org_id: p.orgId,
      opportunity_id: d?.id ?? null,
      customer_id: p.customerId,
      lead_id: d?.lead_id ?? null,
      thread_id: thread?.id ?? null,
      user_id: null,
      type: 'text',
      contact_outcome: 'replied',
      body,
      origin,
      audience: 'team',
      restricted_pricing: false,
      priority: 'fyi',
      mentioned_user_ids: [],
      client_id: p.clientId ?? null,
      source: origin,
      created_at: new Date().toISOString(),
    })
    .select('id, created_at')
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? 'insert failed' }
  const row = data as { id: string; created_at: string }
  if (thread) await admin.from('threads').update({ last_message_at: row.created_at }).eq('id', thread.id).eq('org_id', p.orgId)
  return { ok: true, id: row.id }
}
