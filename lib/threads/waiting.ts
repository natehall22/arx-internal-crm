import type { SupabaseClient } from '@supabase/supabase-js'

import { dealRefsFor } from '@/lib/threads/get-thread'
import { canReadRowOnDeal, type ThreadViewer } from '@/lib/threads/visibility'

/** "Waiting on you": open needs_reply / urgent / mention notifications for ONE user. */

export type WaitingItem = {
  id: string
  priority: 'fyi' | 'needs_reply' | 'urgent'
  title: string
  body: string
  link_url: string | null
  activity_id: string | null
  created_at: string
  blind: boolean
  /** The person can no longer read the message this points at (role/audience/deal changed, or it was deleted): title/body are redacted. */
  redacted?: boolean
}

export const REDACTED_TITLE = 'A message you can no longer see'
export const REDACTED_BODY = 'You no longer have access to this message.'

const ORDER = { urgent: 0, needs_reply: 1, fyi: 2 } as const

export async function listWaiting(admin: SupabaseClient, viewer: ThreadViewer, now = new Date()): Promise<WaitingItem[]> {
  const { data } = await admin
    .from('notifications')
    .select('id, type, priority, title, body, link_url, activity_id, created_at, snoozed_until')
    .eq('recipient_user_id', viewer.userId)
    .is('resolved_at', null)
    .in('priority', ['urgent', 'needs_reply', 'fyi'])
    .not('activity_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200)
  const rows = ((data ?? []) as Array<WaitingItem & { type: string; snoozed_until: string | null }>).filter((n) => !n.snoozed_until || new Date(n.snoozed_until) <= now)

  const out = await redactThreadNotifications(admin, viewer, rows)
  return out
    .map((n) => ({
      id: n.id, priority: n.priority, title: n.title, body: n.body, link_url: n.link_url,
      activity_id: n.activity_id, created_at: n.created_at, blind: n.type === 'thread_mention_blind', ...(n.redacted ? { redacted: true } : {}),
    } as WaitingItem))
    .sort((a, b) => ORDER[a.priority] - ORDER[b.priority] || a.created_at.localeCompare(b.created_at))
}

/**
 * The ONE read-time permission check for notification text. A notification was addressed to someone who COULD read the message when
 * it was sent; permissions, the deal's people and the message's audience all change. Before any row that points at a message
 * (activity_id) is returned to the person — Waiting on you, the bell, the live stream — their CURRENT access is checked, and what
 * they cannot see (or what was deleted) comes back redacted with no link. A blind mention already carries no message text.
 */
export async function redactThreadNotifications<T extends { type?: string | null; activity_id?: string | null; title?: string | null; body?: string | null; link_url?: string | null }>(
  admin: SupabaseClient,
  viewer: ThreadViewer,
  rows: T[]
): Promise<Array<T & { redacted?: boolean }>> {
  const actIds = Array.from(new Set(rows.map((n) => n.activity_id).filter((x): x is string => !!x)))
  if (actIds.length === 0) return rows
  const acts = new Map<string, { opportunity_id: string | null; audience: string | null; restricted_pricing: boolean | null; deleted_at: string | null }>()
  const { data: a } = await admin.from('activities').select('id, opportunity_id, audience, restricted_pricing, deleted_at').eq('org_id', viewer.orgId).in('id', actIds)
  for (const r of (a ?? []) as Array<{ id: string; opportunity_id: string | null; audience: string | null; restricted_pricing: boolean | null; deleted_at: string | null }>) acts.set(r.id, r)
  const refs = await dealRefsFor(admin, viewer.orgId, Array.from(acts.values()).map((r) => r.opportunity_id).filter((x): x is string => !!x))
  const canSee = (activityId: string): boolean => {
    const act = acts.get(activityId)
    if (!act || act.deleted_at) return false
    const ref = act.opportunity_id ? refs.get(act.opportunity_id) ?? 'none' : 'none'
    return canReadRowOnDeal(viewer, ref, { audience: act.audience as never, restricted_pricing: act.restricted_pricing })
  }
  return rows.map((n) => {
    if (!n.activity_id || n.type === 'thread_mention_blind' || canSee(n.activity_id)) return n
    return { ...n, title: REDACTED_TITLE, body: REDACTED_BODY, link_url: null, redacted: true }
  })
}

export async function resolveWaiting(
  admin: SupabaseClient,
  userId: string,
  id: string,
  action: 'done' | 'snooze',
  now = new Date()
): Promise<boolean> {
  const patch =
    action === 'done'
      ? { resolved_at: now.toISOString(), resolution: 'done', read_at: now.toISOString() }
      : { snoozed_until: new Date(now.getTime() + 3600 * 1000).toISOString(), resolution: 'snoozed' }
  const { data } = await admin.from('notifications').update(patch).eq('id', id).eq('recipient_user_id', userId).select('id')
  return (data ?? []).length > 0
}

/** Replying in a thread clears that person's open needs-reply/urgent items for the parent (or the whole thread). */
export async function resolveByReply(admin: SupabaseClient, userId: string, activityIds: string[], now = new Date()): Promise<void> {
  if (activityIds.length === 0) return
  await admin
    .from('notifications')
    .update({ resolved_at: now.toISOString(), resolution: 'replied', read_at: now.toISOString() })
    .eq('recipient_user_id', userId)
    .is('resolved_at', null)
    .in('activity_id', activityIds)
}
