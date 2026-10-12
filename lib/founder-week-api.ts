import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { isOrgSuperuserRoleSlug } from '@/lib/org-role-constants'

/**
 * Access check for the founder calendar (/foundercalendar) and its APIs (/api/founder-week/*).
 *
 * Same-origin with the CRM, so the CRM login is the key: requireAuthApi() (session cookie or the
 * iOS Bearer token), then owner/admin only while it's being tested. Not linked from any nav.
 * Non-superusers get 404 so the page stays invisible to everyone else.
 */
export type FounderWeekUser = { orgId: string; userId: string }

export async function requireFounderWeekUser(): Promise<{ ok: true; user: FounderWeekUser } | { ok: false; response: NextResponse }> {
  let ctx
  try {
    ctx = await requireAuthApi()
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } }) }
  }
  const { profile } = ctx
  if (!isOrgSuperuserRoleSlug(profile.role) || !profile.org_id) {
    return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } }) }
  }
  return { ok: true, user: { orgId: profile.org_id, userId: profile.id } }
}
