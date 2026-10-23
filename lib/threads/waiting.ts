import type { SupabaseClient } from '@supabase/supabase-js'

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
}

const ORDER = { urgent: 0, needs_reply: 1, fyi: 2 } as const

export async function listWaiting(admin: SupabaseClient, userId: string, now = new Date()): Promise<WaitingItem[]> {
  const { data } = await admin
    .from('notifications')
    .select('id, type, priority, title, body, link_url, activity_id, created_at, snoozed_until')
    .eq('recipient_user_id', userId)
    .is('resolved_at', null)
    .in('priority', ['urgent', 'needs_reply', 'fyi'])
    .not('activity_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(200)
  return ((data ?? []) as Array<WaitingItem & { type: string; snoozed_until: string | null }>)
    .filter((n) => !n.snoozed_until || new Date(n.snoozed_until) <= now)
    .map((n) => ({
      id: n.id, priority: n.priority, title: n.title, body: n.body, link_url: n.link_url,
      activity_id: n.activity_id, created_at: n.created_at, blind: n.type === 'thread_mention_blind',
    }))
    .sort((a, b) => ORDER[a.priority] - ORDER[b.priority] || a.created_at.localeCompare(b.created_at))
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
