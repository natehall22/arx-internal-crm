import type { SupabaseClient } from '@supabase/supabase-js'

import { mentionCandidates, resolveNoteMentions } from '@/lib/note-mentions'
import { toMessage, type ThreadMessage } from '@/lib/threads/get-thread'
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
}

export type PostResult =
  | {
      ok: true
      message: ThreadMessage
      /** users to notify, already filtered to people who can read the message */
      recipients: { userId: string; priority: Priority; reason: 'mention' | 'reply' | 'urgent' }[]
      /** mentioned people who may NOT read it (they get a content-free ping) */
      blindMentions: string[]
      pricingNotice: boolean
    }
  | { ok: false; status: 400 | 403 | 404 | 409 | 429; error: string }

export type DealForPost = {
  id: string
  owner_user_id: string | null
  setter_user_id: string | null
  customer_id: string | null
  lead_id: string | null
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
  const body = String(draft.body ?? '').trim()
  if (!body) return { ok: false, status: 400, error: 'Message is required' }
  if (body.length > MAX_MESSAGE_LENGTH) return { ok: false, status: 400, error: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters)` }

  const viewer = opts.viewer ?? (await resolveThreadViewer(admin, profile))
  const dealRef: DealRef = { owner_user_id: deal.owner_user_id, setter_user_id: deal.setter_user_id }
  const allowed = writableAudiences(viewer, dealRef)
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
      if (prior) return { ok: true, message: prior, recipients: [], blindMentions: [], pricingNotice: false }
    }
  }

  // A reply inherits the parent's audience and pricing flag, and must be one the author can read.
  let parent: ThreadMessage | null = null
  if (draft.replyToId) {
    parent = await loadMessage(admin, viewer.orgId, draft.replyToId)
    if (!parent || !canReadMessage(viewer, dealRef, parent)) return { ok: false, status: 404, error: 'Reply target not found' }
  }

  let audience: Audience
  if (parent?.audience && allowed.includes(parent.audience)) {
    audience = parent.audience
  } else if (draft.audience) {
    if (!allowed.includes(draft.audience)) return { ok: false, status: 403, error: `You cannot write ${draft.audience} messages` }
    audience = draft.audience
  } else {
    audience = defaultAudience(viewer, { surface: draft.surface ?? 'other', replyTo: parent }, dealRef)
  }

  // Pricing guard: flagged by default when it looks like pricing; an author who may
  // see pricing can opt setters in; a setter-like author can never un-flag.
  const pricing = looksLikePricing(body)
  // A pricing-barred author (setter) has no prices to protect and could not read their own
  // flagged message, so only authors who may see pricing set the flag.
  const restricted =
    parent?.restricted_pricing === true ||
    (pricing && !viewer.pricingBarred && draft.allowSetters !== true)

  let priority: Priority = 'fyi'
  if (draft.priority === 'urgent') priority = 'urgent'

  // Mentions: exact "@Full Name" only. The picker's ids just disambiguate duplicates.
  const { data: orgUsers } = await admin
    .from('users')
    .select('id, full_name, email, active, role, custom_role_id, is_super_admin, org_id')
    .eq('org_id', viewer.orgId)
    .eq('active', true)
  const candidates = mentionCandidates(((orgUsers ?? []) as OrgUser[]).map((u) => ({ ...u })))
  const mentioned = resolveNoteMentions(body, candidates, draft.selectedMentionIds ?? [])
    .filter((u) => u.id !== viewer.userId)

  if (priority !== 'urgent' && mentioned.length > 0 && (draft.priority === 'needs_reply' || looksLikeQuestion(body))) {
    priority = 'needs_reply'
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
      user_id: viewer.userId,
      type: 'note',
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
  if (error || !inserted) return { ok: false, status: 409, error: 'Failed to post message' }

  const message = (await loadMessage(admin, viewer.orgId, (inserted as { id: string }).id)) as ThreadMessage
  if (thread) {
    await admin.from('threads').update({ last_message_at: message.created_at }).eq('id', thread.id)
    await admin
      .from('thread_members')
      .upsert({ thread_id: thread.id, user_id: viewer.userId, org_id: viewer.orgId, reason: 'joined', last_read_at: message.created_at }, { onConflict: 'thread_id,user_id' })
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
      if (canReadMessage(rv, dealRef, message)) recipients.push({ userId: pu.id, priority: 'fyi', reason: 'reply' })
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
  const { data: found } = await admin.from('threads').select('id').eq('opportunity_id', deal.id).eq('kind', 'deal').maybeSingle()
  if (found) return found as { id: string }
  const { data: created, error } = await admin
    .from('threads')
    .insert({ org_id: orgId, kind: 'deal', opportunity_id: deal.id, customer_id: deal.customer_id, lead_id: deal.lead_id })
    .select('id')
    .single()
  if (error) {
    // Lost a race against the unique index — the other writer's row is the thread.
    const { data: again } = await admin.from('threads').select('id').eq('opportunity_id', deal.id).eq('kind', 'deal').maybeSingle()
    return (again as { id: string } | null) ?? null
  }
  return created as { id: string }
}
