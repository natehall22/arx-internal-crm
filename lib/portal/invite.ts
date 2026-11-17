/**
 * Staff: invite one customer to the portal ("Invite to portal", one tap) or take their access away. The invitation is
 * `customers.portal_invited_at`; in an invite-only company (roofing default, lib/portal/settings.ts) only invited customers can get a
 * sign-in link or keep a session. Inviting emails the same one-time link as the customer's own request, to the address ON FILE only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { isUsableCustomerEmail } from '@/lib/invoice-document'
import { orgAppUrl } from '@/lib/company-links'
import { isDemoOrg } from '@/lib/demo-org'
import { emailIsSetUp, logPortalEvent, revokeCustomerPortalAccess, sendLoginLinks, takePortalAttempt } from '@/lib/portal/server'
import { hashPortalToken, loginLinkExpiry, LOGIN_LINK_MINUTES, newPortalToken } from '@/lib/portal/tokens'
import { orgDb } from '@/lib/supabase/org-db'

export type InviteResult = { ok: true; sentTo: string } | { ok: false; status: 404 | 409 | 429 | 500; error: string }

export async function inviteCustomerToPortal(admin: SupabaseClient, orgId: string, customerId: string, staffUserId: string): Promise<InviteResult> {
  const db = orgDb(admin, orgId)
  const { data } = await db.from('customers').select('id, name, email').eq('id', customerId).maybeSingle()
  const c = data as { id: string; name: string | null; email: string | null } | null
  if (!c) return { ok: false, status: 404, error: 'Not found' }
  if (!isUsableCustomerEmail(c.email)) return { ok: false, status: 409, error: 'Add an email address for this customer first.' }
  // Same fail-closed limits as a customer's own request, plus a staff-side cap so one tap cannot be held down.
  if (!(await takePortalAttempt(admin, `invite-cust:${customerId}`, { limit: 3, windowSeconds: 3600 }))) return { ok: false, status: 429, error: 'Email not sent: already sent a few times. Try again in an hour.' }
  if (!(await emailIsSetUp(orgId))) return { ok: false, status: 409, error: "Email not sent: email isn't set up for your company yet." }
  // Marked invited only once the email really went out (the invitation is what lets them in).
  const sent = await sendLoginLinks(admin, orgId, [c], `staff:${staffUserId}`, { invite: true })
  if (!sent) return { ok: false, status: 500, error: 'Email not sent. Please try again in a minute.' }
  const { error } = await db.from('customers').update({ portal_invited_at: new Date().toISOString() }).eq('id', customerId)
  if (error) return { ok: false, status: 409, error: 'Inviting turns on once the customer portal update is applied.' }
  return { ok: true, sentTo: String(c.email).trim() }
}

export type StaffLinkResult = { ok: true; url: string; minutes: number } | { ok: false; status: 404 | 409 | 429 | 500; error: string }

/**
 * Staff "Copy sign-in link": the same one-time token as the emailed link (portal_login_tokens, used once, LOGIN_LINK_MINUTES),
 * handed to the staff member instead of mailed. For testing the portal (a demo company sends no email) or a customer on the phone.
 * Whoever holds it can open this customer's portal once, so it is logged (link_sent, via staff:<user>) and rate limited. In an invite-only
 * company, making the link also invites the customer (a session needs the invitation).
 */
export async function createStaffSignInLink(admin: SupabaseClient, orgId: string, customerId: string, staffUserId: string): Promise<StaffLinkResult> {
  const db = orgDb(admin, orgId)
  const { data } = await db.from('customers').select('id, email').eq('id', customerId).maybeSingle()
  const c = data as { id: string; email: string | null } | null
  if (!c) return { ok: false, status: 404, error: 'Not found' }
  if (!(await takePortalAttempt(admin, `staff-link:${customerId}`, { limit: 10, windowSeconds: 3600 }))) return { ok: false, status: 429, error: 'Too many links for this customer. Try again in an hour.' }
  const token = newPortalToken()
  const { error: insErr } = await db.from('portal_login_tokens').insert({ customer_id: customerId, token_hash: hashPortalToken(token), sent_to: c.email ? String(c.email).trim() : null, expires_at: loginLinkExpiry().toISOString() })
  if (insErr) return { ok: false, status: 500, error: 'Could not make the link. Please try again.' }
  const { error: invErr } = await db.from('customers').update({ portal_invited_at: new Date().toISOString() }).eq('id', customerId).is('portal_invited_at', null)
  if (invErr) return { ok: false, status: 409, error: 'The link needs the customer portal update to be applied first.' }
  await logPortalEvent(admin, orgId, { kind: 'link_sent', customerId, via: `staff:${staffUserId}`, detail: 'staff copied a sign-in link' })
  return { ok: true, url: `${await orgAppUrl(orgId)}/portal/enter?t=${token}`, minutes: LOGIN_LINK_MINUTES }
}

/** Take access away: the invitation, every open session and every unused link. */
export async function removeCustomerPortalAccess(admin: SupabaseClient, orgId: string, customerId: string): Promise<boolean> {
  const { data } = await orgDb(admin, orgId).from('customers').select('id').eq('id', customerId).maybeSingle()
  if (!data) return false
  await orgDb(admin, orgId).from('customers').update({ portal_invited_at: null }).eq('id', customerId)
  await revokeCustomerPortalAccess(admin, orgId, customerId)
  return true
}


/** What the Customer File's portal card shows: is the company invite-only, and has this customer been invited. */
export async function loadPortalAccessState(admin: SupabaseClient, orgId: string, customerId: string): Promise<{ inviteOnly: boolean; invitedAt: string | null; emailSuppressed: boolean }> {
  const { loadPortalSettings } = await import('@/lib/portal/settings')
  const [settings, row, demo] = await Promise.all([loadPortalSettings(admin, orgId), orgDb(admin, orgId).from('customers').select('portal_invited_at').eq('id', customerId).maybeSingle(), isDemoOrg(admin, orgId)])
  const invitedAt = row.error ? null : ((row.data as { portal_invited_at?: string | null } | null)?.portal_invited_at ?? null)
  return { inviteOnly: settings.inviteOnly, invitedAt, emailSuppressed: demo }
}
