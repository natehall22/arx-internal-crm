/**
 * Support access (server only) — the ONE audited door into another company's CRM. Everything about who may enter, for how
 * long, as whom, and the log lives here; `lib/auth.ts` (`resolveAuth`) is the only caller that turns a session into a profile.
 *
 *  - A company other than the operator's must GRANT access first (`support_access_grants`: 1 day / 1 week / 1 month / 1 year),
 *    and its owner can end it at any time. `orgs.support_access_always` (set only by the server) keeps the operator's own
 *    company open without a grant.
 *  - Who may use it: `platform_support_staff` (service role only; rows added by SQL by the operator).
 *  - Every use re-checks all of it: staff row, staff account active, live grant / always-on, acting-as user in the company
 *    and active. Ending a grant therefore ends every session on the next request.
 *  - Every table here is missing until migration 202611260010 is applied: a read error means "no access" (fail closed).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { User } from '@/lib/types/database'
import { SUPPORT_SESSION_MAX_MS, type SupportLevel, type SupportSessionPayload } from '@/lib/support/token'

export const GRANT_DURATIONS = {
  day: { label: '1 day', ms: 24 * 60 * 60 * 1000 },
  week: { label: '1 week', ms: 7 * 24 * 60 * 60 * 1000 },
  month: { label: '1 month', ms: 30 * 24 * 60 * 60 * 1000 },
  year: { label: '1 year', ms: 365 * 24 * 60 * 60 * 1000 },
} as const
export type GrantDuration = keyof typeof GRANT_DURATIONS
export const isGrantDuration = (v: unknown): v is GrantDuration => typeof v === 'string' && Object.prototype.hasOwnProperty.call(GRANT_DURATIONS, v)

export type SupportEvent = 'enter' | 'exit' | 'upgrade' | 'write' | 'blocked_send'

/** What a live session carries after the checks; `AuthContext.support` in lib/auth.ts. */
export type SupportMarker = {
  staffUserId: string
  orgId: string
  actingAsUserId: string
  level: SupportLevel
  /** 'always' = the company's own always-on setting; otherwise the grant's expiry. */
  access: { kind: 'always' } | { kind: 'grant'; expiresAt: string }
}

export type LiveAccess = SupportMarker['access']

/** Is this person platform support staff (a row, and an active account)? A read error is "no". */
export async function isPlatformStaff(admin: SupabaseClient, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false
  try {
    const { data: row, error } = await admin.from('platform_support_staff').select('user_id').eq('user_id', userId).maybeSingle()
    if (error || !row) return false
    // org-scope-ok: platform staff are users of the operator's own company; this is keyed by the staff user id on purpose
    const { data: u, error: uErr } = await admin.from('users').select('id, active').eq('id', userId).maybeSingle()
    return !uErr && !!u && (u as { active?: boolean | null }).active !== false
  } catch {
    return false
  }
}

/** The company's live support access right now: always-on, a grant that is neither ended nor expired, or null. */
export async function liveSupportAccess(admin: SupabaseClient, orgId: string, now: Date = new Date()): Promise<LiveAccess | null> {
  try {
    const { data: org, error } = await admin.from('orgs').select('id, support_access_always').eq('id', orgId).maybeSingle()
    if (error || !org) return null
    if ((org as { support_access_always?: boolean | null }).support_access_always === true) return { kind: 'always' }
    const { data: grants, error: gErr } = await admin
      .from('support_access_grants')
      .select('expires_at')
      .eq('org_id', orgId)
      .is('ended_at', null)
      .gt('expires_at', now.toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
    if (gErr || !grants?.length) return null
    return { kind: 'grant', expiresAt: String((grants[0] as { expires_at: string }).expires_at) }
  } catch {
    return null
  }
}

/** A session never outlives 8 hours or the grant. */
export function sessionExpiry(access: LiveAccess, now: number): number {
  const cap = now + SUPPORT_SESSION_MAX_MS
  return access.kind === 'grant' ? Math.min(cap, new Date(access.expiresAt).getTime()) : cap
}

export type SupportSessionCheck =
  | { status: 'ok'; profile: User; support: SupportMarker }
  | { status: 'denied'; reason: 'not_staff' | 'no_access' | 'no_acting_user' | 'expired' }

/**
 * Re-check a signed session payload against the database. Used on EVERY request that carries the cookie: the signature only
 * proves we issued it, never that it is still allowed.
 */
export async function checkSupportSession(admin: SupabaseClient, payload: SupportSessionPayload, now: Date = new Date()): Promise<SupportSessionCheck> {
  if (!(payload.exp > now.getTime())) return { status: 'denied', reason: 'expired' }
  if (!(await isPlatformStaff(admin, payload.s))) return { status: 'denied', reason: 'not_staff' }
  const access = await liveSupportAccess(admin, payload.o, now)
  if (!access) return { status: 'denied', reason: 'no_access' }
  const { data: acting, error } = await admin.from('users').select('*').eq('id', payload.a).eq('org_id', payload.o).maybeSingle()
  const row = acting as User | null
  if (error || !row || row.active === false) return { status: 'denied', reason: 'no_acting_user' }
  return { status: 'ok', profile: row, support: { staffUserId: payload.s, orgId: payload.o, actingAsUserId: payload.a, level: payload.l, access } }
}

/** Append one row to the log. THROWS when it cannot be written: callers that must be audited (enter, upgrade, write) stop on it. */
export async function logSupportEvent(
  admin: SupabaseClient,
  e: { orgId: string; staffUserId: string; actingAsUserId: string | null; level: SupportLevel; event: SupportEvent; detail?: Record<string, unknown>; handoffId?: string }
): Promise<void> {
  const { error } = await admin.from('support_access_log').insert({
    org_id: e.orgId,
    staff_user_id: e.staffUserId,
    acting_as_user_id: e.actingAsUserId,
    level: e.level,
    event: e.event,
    detail: e.detail ?? {},
    ...(e.handoffId ? { handoff_id: e.handoffId } : {}),
  })
  if (error) throw new Error(`support log failed: ${error.message}`)
}

export type EnterResult = { ok: true; payload: SupportSessionPayload; access: LiveAccess } | { ok: false; status: number; error: string }

/**
 * Start a session for platform staff: checks the staff row, the company's live access and the acting-as user (the company's
 * active owner when `actingAsUserId` is null), logs 'enter' (no log, no session), and returns the payload to sign.
 */
export async function enterSupportSession(
  admin: SupabaseClient,
  input: { staffUserId: string; orgId: string; actingAsUserId: string | null },
  now: Date = new Date()
): Promise<EnterResult> {
  if (!(await isPlatformStaff(admin, input.staffUserId))) return { ok: false, status: 403, error: 'Forbidden' }
  const access = await liveSupportAccess(admin, input.orgId, now)
  if (!access) return { ok: false, status: 403, error: 'This company has not granted support access (or it has ended).' }
  let actingAs = input.actingAsUserId
  if (!actingAs) {
    const { data: owners } = await admin.from('users').select('id, active').eq('org_id', input.orgId).eq('is_super_admin', true).order('created_at', { ascending: true }).limit(10)
    actingAs = ((owners as Array<{ id: string; active?: boolean | null }> | null) ?? []).find((u) => u.active !== false)?.id ?? null
    if (!actingAs) return { ok: false, status: 409, error: 'This company has no active owner to enter as. Pick a specific user.' }
  }
  const { data: target } = await admin.from('users').select('id, active').eq('id', actingAs).eq('org_id', input.orgId).maybeSingle()
  if (!target || (target as { active?: boolean | null }).active === false) return { ok: false, status: 404, error: 'That user is not an active user of this company.' }
  const payload: SupportSessionPayload = { k: 'session', s: input.staffUserId, o: input.orgId, a: actingAs, l: 'view', exp: sessionExpiry(access, now.getTime()) }
  try {
    await logSupportEvent(admin, { orgId: input.orgId, staffUserId: input.staffUserId, actingAsUserId: actingAs, level: 'view', event: 'enter', detail: { access: access.kind, as: input.actingAsUserId ? 'user' : 'owner' } })
  } catch (e) {
    console.error('[support] could not log enter', e)
    return { ok: false, status: 500, error: 'Could not record the entry, so it was refused.' }
  }
  return { ok: true, payload, access }
}

/* ---------------------------- the company's side ---------------------------- */

export type SupportStatus = { always: boolean; active: { grantedAt: string; expiresAt: string } | null }

export async function supportStatus(admin: SupabaseClient, orgId: string, now: Date = new Date()): Promise<SupportStatus> {
  const live = await liveSupportAccess(admin, orgId, now)
  if (!live) return { always: false, active: null }
  if (live.kind === 'always') return { always: true, active: null }
  const { data } = await admin.from('support_access_grants').select('granted_at, expires_at').eq('org_id', orgId).is('ended_at', null).gt('expires_at', now.toISOString()).order('expires_at', { ascending: false }).limit(1)
  const g = (data as Array<{ granted_at: string; expires_at: string }> | null)?.[0]
  return { always: false, active: g ? { grantedAt: g.granted_at, expiresAt: g.expires_at } : { grantedAt: '', expiresAt: live.expiresAt } }
}

/** Grant access to the owner's OWN company. Ends any earlier live grant first, so there is one live grant at a time. */
export async function grantSupportAccess(admin: SupabaseClient, orgId: string, grantedBy: string, duration: GrantDuration, now: Date = new Date()): Promise<{ expiresAt: string }> {
  await endSupportAccess(admin, orgId, grantedBy, now)
  const expiresAt = new Date(now.getTime() + GRANT_DURATIONS[duration].ms).toISOString()
  const { error } = await admin.from('support_access_grants').insert({ org_id: orgId, granted_by: grantedBy, granted_at: now.toISOString(), expires_at: expiresAt })
  if (error) throw new Error(`Could not save the grant: ${error.message}`)
  return { expiresAt }
}

/** End every live grant of the company now. Sessions stop on their next request (every request re-checks). */
export async function endSupportAccess(admin: SupabaseClient, orgId: string, endedBy: string, now: Date = new Date()): Promise<void> {
  const { error } = await admin
    .from('support_access_grants')
    .update({ ended_at: now.toISOString(), ended_by: endedBy })
    .eq('org_id', orgId)
    .is('ended_at', null)
    .gt('expires_at', now.toISOString())
  if (error) throw new Error(`Could not end access: ${error.message}`)
}

export type SupportLogRow = { id: number; at: string; event: SupportEvent; level: SupportLevel; staff: string; actingAs: string | null; detail: Record<string, unknown> }

/** The company's own support log, newest first, with names. */
export async function listSupportLog(admin: SupabaseClient, orgId: string, limit = 100): Promise<SupportLogRow[]> {
  const { data, error } = await admin.from('support_access_log').select('id, at, event, level, staff_user_id, acting_as_user_id, detail').eq('org_id', orgId).order('id', { ascending: false }).limit(limit)
  if (error || !data) return []
  const rows = data as Array<{ id: number; at: string; event: SupportEvent; level: SupportLevel; staff_user_id: string; acting_as_user_id: string | null; detail: Record<string, unknown> | null }>
  const ids = Array.from(new Set(rows.flatMap((r) => [r.staff_user_id, r.acting_as_user_id]).filter((v): v is string => !!v)))
  const names = new Map<string, string>()
  if (ids.length) {
    // org-scope-ok: ids come from this company's own log rows (staff of the operator's company + this company's acting-as users)
    const { data: us } = await admin.from('users').select('id, full_name, email').in('id', ids)
    for (const u of (us as Array<{ id: string; full_name: string | null; email: string | null }> | null) ?? []) names.set(u.id, u.full_name || u.email || 'Unknown')
  }
  return rows.map((r) => ({ id: r.id, at: r.at, event: r.event, level: r.level, staff: names.get(r.staff_user_id) ?? 'Support', actingAs: r.acting_as_user_id ? names.get(r.acting_as_user_id) ?? null : null, detail: r.detail ?? {} }))
}

/* ---------------------------- the staff's side ---------------------------- */

export type SupportCompany = { orgId: string; name: string; access: LiveAccess; users: Array<{ id: string; name: string; role: string }> }

/** Companies a staff member can enter right now: always-on, or with a live grant. */
export async function listSupportCompanies(admin: SupabaseClient, now: Date = new Date()): Promise<SupportCompany[]> {
  const found = new Map<string, LiveAccess>()
  const { data: always } = await admin.from('orgs').select('id').eq('support_access_always', true)
  for (const o of (always as Array<{ id: string }> | null) ?? []) found.set(o.id, { kind: 'always' })
  // org-scope-ok: the staff list is cross-company on purpose (companies that currently allow support); platform staff only
  const { data: grants } = await admin.from('support_access_grants').select('org_id, expires_at').is('ended_at', null).gt('expires_at', now.toISOString()).order('expires_at', { ascending: false })
  for (const g of (grants as Array<{ org_id: string; expires_at: string }> | null) ?? []) if (!found.has(g.org_id)) found.set(g.org_id, { kind: 'grant', expiresAt: g.expires_at })
  if (!found.size) return []
  const ids = Array.from(found.keys())
  const [{ data: orgs }, { data: users }] = await Promise.all([
    admin.from('orgs').select('id, name').in('id', ids),
    admin.from('users').select('id, org_id, full_name, email, role, active').in('org_id', ids).order('full_name', { ascending: true }).limit(2000),
  ])
  const byOrg = new Map<string, SupportCompany['users']>()
  for (const u of (users as Array<{ id: string; org_id: string; full_name: string | null; email: string | null; role: string; active?: boolean | null }> | null) ?? []) {
    if (u.active === false) continue
    const list = byOrg.get(u.org_id) ?? []
    list.push({ id: u.id, name: u.full_name || u.email || 'Unnamed', role: u.role })
    byOrg.set(u.org_id, list)
  }
  return ((orgs as Array<{ id: string; name: string | null }> | null) ?? [])
    .map((o) => ({ orgId: o.id, name: o.name || 'Company', access: found.get(o.id)!, users: byOrg.get(o.id) ?? [] }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
