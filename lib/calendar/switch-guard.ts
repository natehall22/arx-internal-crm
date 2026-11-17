/**
 * Switching a user's calendar provider (Google <-> Outlook) is blocked while that user is the org's install-scheduling
 * account and future install events sit on the calendar they have now. Event ids belong to one provider: after a
 * switch we could neither update nor remove those events, and the crews' invites would be orphaned. There is no column
 * recording which provider wrote an event, so the safe rule is "no switch while any future install event exists".
 * Self-contained (direct queries) so both connection.ts and google-calendar.ts can use it without an import cycle.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatInTimeZone } from 'date-fns-tz'

import { microsoftConfigured } from '@/lib/calendar/microsoft-calendar'
import type { CalendarProviderId } from '@/lib/calendar/provider'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'

const NAME: Record<CalendarProviderId, string> = { google: 'Google Calendar', microsoft: 'Outlook Calendar' }

/** A plain-words reason the user may not connect `target` now, or null when switching (or first connecting) is fine. */
export async function calendarSwitchBlockReason(
  admin: SupabaseClient,
  userId: string,
  orgId: string,
  target: CalendarProviderId
): Promise<string | null> {
  try {
    // org-scope-ok: the signed-in user's own rows by user_id
    const [g, m] = await Promise.all([
      admin.from('user_google_tokens').select('user_id').eq('user_id', userId).maybeSingle(),
      microsoftConfigured() ? admin.from('user_microsoft_tokens').select('user_id').eq('user_id', userId).maybeSingle() : Promise.resolve({ data: null }),
    ])
    const current: CalendarProviderId | null = m.data ? 'microsoft' : g.data ? 'google' : null
    if (!current || current === target) return null

    const { data: org } = await admin.from('orgs').select('install_scheduling_user_id').eq('id', orgId).maybeSingle()
    if (!org || org.install_scheduling_user_id !== userId) return null

    const today = formatInTimeZone(new Date(), DEFAULT_TIMEZONE, 'yyyy-MM-dd')
    const { count, error } = await admin
      .from('work_orders')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .not('install_google_event_id', 'is', null)
      .gte('scheduled_date', today)
    if (error) return `Could not check the install schedule, so ${NAME[target]} was not connected. Try again.`
    if ((count ?? 0) > 0) {
      return `Your ${NAME[current]} is the install-scheduling account and ${count} upcoming install${count === 1 ? ' is' : 's are'} on it. Switching to ${NAME[target]} would orphan those crew invites. Move the installs first, or pick another install-scheduling account, then switch.`
    }
    return null
  } catch (e) {
    console.error('calendarSwitchBlockReason failed', e)
    return `Could not check the install schedule, so ${NAME[target]} was not connected. Try again.`
  }
}
