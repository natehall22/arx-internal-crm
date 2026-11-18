/**
 * Switching a user's calendar provider (Google <-> Outlook) is blocked while that user is the org's install-scheduling
 * account and future install events sit on the calendar they have now. Event ids belong to one provider: after a
 * switch we could neither update nor remove those events, and the crews' invites would be orphaned. There is no column
 * recording which provider (or which user's token) wrote an event, so the safe rule is "no switch while any future install
 * event exists" for the nominated install account; with no nominated account, only people who can schedule installs are guarded.
 * Self-contained (direct queries) so both connection.ts and google-calendar.ts can use it without an import cycle.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatInTimeZone } from 'date-fns-tz'

import { microsoftConfigured } from '@/lib/calendar/microsoft-calendar'
import type { CalendarProviderId } from '@/lib/calendar/provider'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'

const NAME: Record<CalendarProviderId, string> = { google: 'Google Calendar', microsoft: 'Outlook Calendar' }

/**
 * A plain-words reason the user may not connect `target` now, or null when switching (or first connecting) is fine.
 * It blocks ONLY on a confirmed non-empty count of future install events; a failed lookup never blocks (a first-time
 * connect must always get through, and the save path re-checks).
 */
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

    // An unset install account means installs act as whoever is signed in (resolveInstallGoogleToken). Nothing records whose token
    // wrote a given event, so only people who CAN schedule installs (the same `canEditJobs` the assign route checks) are guarded.
    const { data: org } = await admin.from('orgs').select('install_scheduling_user_id').eq('id', orgId).maybeSingle()
    if (!org) return null
    const nominated = !!org.install_scheduling_user_id
    if (nominated && org.install_scheduling_user_id !== userId) return null
    if (!nominated) {
      const { data: profile } = await admin.from('users').select('role, custom_role_id').eq('id', userId).eq('org_id', orgId).maybeSingle()
      if (!profile) return null
      const { resolveOpsAccess } = await import('@/lib/ops-access')
      if (!(await resolveOpsAccess(admin, userId, profile as { role: string; custom_role_id?: string | null })).canEditJobs) return null
    }

    const today = formatInTimeZone(new Date(), DEFAULT_TIMEZONE, 'yyyy-MM-dd')
    const { count, error } = await admin
      .from('work_orders')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .not('install_google_event_id', 'is', null)
      .gte('scheduled_date', today)
    if (error) {
      console.error('calendarSwitchBlockReason: install count failed', error.message)
      return null
    }
    if ((count ?? 0) > 0) {
      const n = `${count} upcoming install${count === 1 ? '' : 's'}`
      return nominated
        ? `Your ${NAME[current]} holds ${n}. Move or unschedule upcoming installs first, or keep using ${NAME[current]}.`
        : `The company has ${n} scheduled, and installs you schedule are written to your ${NAME[current]}, so they may sit there. Move or unschedule upcoming installs first, or keep using ${NAME[current]}.`
    }
    return null
  } catch (e) {
    console.error('calendarSwitchBlockReason failed', e)
    return null
  }
}

/** The settings-page error code after a connect's save returned false: the switch guard (a race) or a plain storage failure. */
export async function connectFailureCode(
  admin: SupabaseClient,
  userId: string,
  orgId: string,
  target: CalendarProviderId
): Promise<'calendar_switch_blocked' | 'token_storage'> {
  return (await calendarSwitchBlockReason(admin, userId, orgId, target)) ? 'calendar_switch_blocked' : 'token_storage'
}
