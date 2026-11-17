/**
 * The ONE place that answers "which calendar does this user have, and give me a client for it". It replaces the eight
 * hand-copied `getValidAccessToken` helpers. One provider per user: connecting one clears the other (saveXConnection).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { googleClient } from '@/lib/calendar/google-provider'
import {
  exchangeMicrosoftCode,
  fetchMicrosoftAccountEmail,
  microsoftClient,
  microsoftConfigured,
  refreshMicrosoftToken,
} from '@/lib/calendar/microsoft-calendar'
import type { CalendarClient, CalendarProviderId } from '@/lib/calendar/provider'
import { refreshAccessToken } from '@/lib/google-calendar'
import { integrationSecretKey, openWithKey, sealWithKey } from '@/lib/secret-seal'

const REFRESH_WINDOW_MS = 5 * 60 * 1000
const SEAL_LABEL = 'microsoft-calendar'

export type GetClientOptions = {
  /**
   * Google only. When a refresh fails: false (default, what almost every caller always did) returns null unless the
   * stored token has not expired yet; true hands back the stored token even if expired (the older appointment-sync
   * behavior, kept for those callers so their outcomes don't change).
   */
  useExpiredOnRefreshFailure?: boolean
}

async function googleToken(admin: SupabaseClient, userId: string, opts: GetClientOptions): Promise<string | null> {
  // org-scope-ok: keyed by user_id (unique per user); callers pass a user already resolved inside their own org
  const { data: row } = await admin
    .from('user_google_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (!row) return null
  const expiresAt = new Date(row.expires_at)
  if (expiresAt.getTime() - Date.now() >= REFRESH_WINDOW_MS) return row.access_token
  try {
    const refreshed = await refreshAccessToken(row.refresh_token)
    // org-scope-ok: updates the one row of this user_id
    await admin
      .from('user_google_tokens')
      .update({ access_token: refreshed.access_token, expires_at: refreshed.expires_at.toISOString() })
      .eq('user_id', userId)
    return refreshed.access_token
  } catch (error) {
    console.error(`Failed to refresh Google token for user ${userId}:`, error)
    if (opts.useExpiredOnRefreshFailure || expiresAt.getTime() > Date.now()) return row.access_token
    return null
  }
}

type MsRow = { access_token_sealed: string; refresh_token_sealed: string; expires_at: string }

async function microsoftToken(admin: SupabaseClient, userId: string): Promise<string | null> {
  const key = integrationSecretKey(SEAL_LABEL)
  if (!key) return null
  const read = async (): Promise<MsRow | null> => {
    // org-scope-ok: keyed by user_id (unique per user); callers pass a user already resolved inside their own org
    const { data } = await admin
      .from('user_microsoft_tokens')
      .select('access_token_sealed, refresh_token_sealed, expires_at')
      .eq('user_id', userId)
      .maybeSingle()
    return (data as MsRow | null) ?? null
  }
  const row = await read()
  if (!row) return null
  const access = openWithKey(key, row.access_token_sealed, `${userId}:access`)
  const refresh = openWithKey(key, row.refresh_token_sealed, `${userId}:refresh`)
  if (!refresh) return null // sealed under another key: needs reconnect
  const expiresAt = new Date(row.expires_at)
  if (access && expiresAt.getTime() - Date.now() >= REFRESH_WINDOW_MS) return access
  try {
    const t = await refreshMicrosoftToken(refresh)
    // Refresh tokens rotate: store the new pair. Only if nobody else rotated meanwhile (compare-and-set on the old one).
    // org-scope-ok: updates the one row of this user_id
    await admin
      .from('user_microsoft_tokens')
      .update({
        access_token_sealed: sealWithKey(key, t.accessToken, `${userId}:access`),
        refresh_token_sealed: sealWithKey(key, t.refreshToken, `${userId}:refresh`),
        expires_at: t.expiresAt.toISOString(),
        scope: t.scope,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('refresh_token_sealed', row.refresh_token_sealed)
    return t.accessToken
  } catch {
    // A concurrent request may have rotated it already: use what it stored if that is fresh.
    const again = await read()
    const fresh = again && again.refresh_token_sealed !== row.refresh_token_sealed ? openWithKey(key, again.access_token_sealed, `${userId}:access`) : null
    if (fresh && new Date(again!.expires_at).getTime() - Date.now() >= 60_000) return fresh
    return access && expiresAt.getTime() > Date.now() ? access : null
  }
}

/** A client for the user's connected calendar (Google or Outlook), or null when they have none / it can't be used. */
export async function getCalendarClient(admin: SupabaseClient, userId: string, opts: GetClientOptions = {}): Promise<CalendarClient | null> {
  // Outlook off (env unset) = no extra query: today's Google-only behavior is untouched.
  const ms = microsoftConfigured() ? await microsoftToken(admin, userId) : null
  if (ms) return microsoftClient(ms)
  const g = await googleToken(admin, userId, opts)
  return g ? googleClient(g) : null
}

/** Which users (of `userIds`) have any calendar connected — the "has a calendar" test for closer pickers and round robin. */
export async function calendarConnectedUserIds(admin: SupabaseClient, userIds: string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)))
  const out = new Set<string>()
  if (ids.length === 0) return out
  // org-scope-ok: filtered to explicit user ids the caller already resolved inside its own org
  const [g, m] = await Promise.all([
    admin.from('user_google_tokens').select('user_id').in('user_id', ids),
    microsoftConfigured() ? admin.from('user_microsoft_tokens').select('user_id').in('user_id', ids) : Promise.resolve({ data: [] }),
  ])
  for (const r of (g.data ?? []) as { user_id: string }[]) out.add(r.user_id)
  for (const r of (m.data ?? []) as { user_id: string }[]) out.add(r.user_id)
  return out
}

export type CalendarConnectionStatus = { provider: CalendarProviderId; expires_at: string; account_email: string | null } | null

/** For the connect screens: which provider (if any) the user has, without any token material. */
export async function getCalendarConnectionStatus(admin: SupabaseClient, userId: string): Promise<CalendarConnectionStatus> {
  // org-scope-ok: the signed-in user's own rows by user_id
  const [m, g] = await Promise.all([
    admin.from('user_microsoft_tokens').select('expires_at, account_email').eq('user_id', userId).maybeSingle(),
    admin.from('user_google_tokens').select('expires_at').eq('user_id', userId).maybeSingle(),
  ])
  if (m.data) return { provider: 'microsoft', expires_at: m.data.expires_at, account_email: m.data.account_email ?? null }
  if (g.data) return { provider: 'google', expires_at: g.data.expires_at, account_email: null }
  return null
}

/** Clears one provider's connection for the user (both when `provider` is omitted). Returns an error message or null. */
export async function disconnectCalendar(admin: SupabaseClient, userId: string, provider?: CalendarProviderId): Promise<string | null> {
  if (!provider || provider === 'google') {
    // org-scope-ok: the signed-in user's own row
    const { error } = await admin.from('user_google_tokens').delete().eq('user_id', userId)
    if (error) return error.message
  }
  if (!provider || provider === 'microsoft') {
    // org-scope-ok: the signed-in user's own row
    const { error } = await admin.from('user_microsoft_tokens').delete().eq('user_id', userId)
    if (error) return error.message
  }
  return null
}

/**
 * Complete an Outlook connect: exchange the one-time code (+ PKCE verifier), seal and store the tokens for this user,
 * then clear their Google connection (one provider per user). False when anything failed.
 */
export async function saveMicrosoftConnection(admin: SupabaseClient, code: string, codeVerifier: string, userId: string, orgId: string): Promise<boolean> {
  const key = integrationSecretKey(SEAL_LABEL)
  if (!key) return false
  let tokens
  try {
    tokens = await exchangeMicrosoftCode(code, codeVerifier)
  } catch {
    return false
  }
  const email = await fetchMicrosoftAccountEmail(tokens.accessToken)
  // org-scope-ok: upsert key user_id is the signed-in user and orgId is that user's own profile org
  const { error } = await admin.from('user_microsoft_tokens').upsert(
    {
      user_id: userId,
      org_id: orgId,
      access_token_sealed: sealWithKey(key, tokens.accessToken, `${userId}:access`),
      refresh_token_sealed: sealWithKey(key, tokens.refreshToken, `${userId}:refresh`),
      expires_at: tokens.expiresAt.toISOString(),
      scope: tokens.scope,
      account_email: email,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  )
  if (error) {
    console.error('Failed to store Microsoft tokens:', error.message)
    return false
  }
  return (await disconnectCalendar(admin, userId, 'google')) === null
}
