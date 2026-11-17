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

export type StaffLinkResult = { ok: true; url: string; minutes: number; invited: boolean } | { ok: false; status: 404 | 409 | 429 | 500; error: string; needsInvite?: boolean }

/** The link_sent event of a staff-made token carries this in `detail` (first 16 hex of the token hash, never the token) so the login can be traced to the staff member. */
export const STAFF_LINK_DETAIL_PREFIX = 'staff link t:'
export const staffLinkDetail = (token: string) => `${STAFF_LINK_DETAIL_PREFIX}${hashPortalToken(token).slice(0, 16)}`

/**
 * Staff "Copy sign-in link": the same one-time token as the emailed link (portal_login_tokens, used once, LOGIN_LINK_MINUTES),
 * handed to the staff member instead of mailed. For testing the portal (a demo company sends no email) or a customer on the phone.
 * Whoever holds it can open this customer's portal once, so it is logged (link_sent, via staff:<user>, detail marks the token) and rate
 * limited. The login it produces is logged as via 'staff_link' with the staff user id.
 * `sent_to` is the customer's address on file although NOTHING is emailed: consumeLoginLink kills a link whose sent_to no longer matches
 * the address on file, and that check is wanted here too.
 * Invitation: copying a link does NOT invite the customer. In an invite-only company a session needs the invitation, so an uninvited
 * customer gets a link only when the owner explicitly chooses "invite" (opts.invite); otherwise 409 `needsInvite`.
 */
export async function createStaffSignInLink(admin: SupabaseClient, orgId: string, customerId: string, staffUserId: string, opts: { invite?: boolean } = {}): Promise<StaffLinkResult> {
  const db = orgDb(admin, orgId)
  const { data } = await db.from('customers').select('id, email, portal_invited_at').eq('id', customerId).maybeSingle()
  const c = data as { id: string; email: string | null; portal_invited_at?: string | null } | null
  if (!c) return { ok: false, status: 404, error: 'Not found' }
  // The address first: if it cannot be built nothing is written (no token, no invitation, no log line).
  let base: string
  try {
    base = await orgAppUrl(orgId)
  } catch {
    return { ok: false, status: 500, error: "The company's app address is not set up, so no link can be made." }
  }
  const { loadPortalSettings } = await import('@/lib/portal/settings')
  const needsInvite = (await loadPortalSettings(admin, orgId)).inviteOnly && !c.portal_invited_at
  if (needsInvite && !opts.invite) return { ok: false, status: 409, needsInvite: true, error: 'This customer has not been invited to the portal. Choose "Invite and copy link".' }
  if (!(await takePortalAttempt(admin, `staff-link:${customerId}`, { limit: 10, windowSeconds: 3600 }))) return { ok: false, status: 429, error: 'Too many links for this customer. Try again in an hour.' }
  const token = newPortalToken()
  const { error: insErr } = await db.from('portal_login_tokens').insert({ customer_id: customerId, token_hash: hashPortalToken(token), sent_to: c.email ? String(c.email).trim() : null, expires_at: loginLinkExpiry().toISOString() })
  if (insErr) return { ok: false, status: 500, error: 'Could not make the link. Please try again.' }
  if (needsInvite) {
    const { error: invErr } = await db.from('customers').update({ portal_invited_at: new Date().toISOString() }).eq('id', customerId).is('portal_invited_at', null)
    if (invErr) return { ok: false, status: 409, error: 'The link needs the customer portal update to be applied first.' }
  }
  await logPortalEvent(admin, orgId, { kind: 'link_sent', customerId, via: `staff:${staffUserId}`, detail: staffLinkDetail(token) })
  return { ok: true, url: `${base}/portal/enter?t=${token}`, minutes: LOGIN_LINK_MINUTES, invited: needsInvite }
}

/** Was this (just consumed) token made by a staff member? Returns that staff user id, else null. */
export async function staffLinkMaker(admin: SupabaseClient, orgId: string, customerId: string, token: string): Promise<string | null> {
  const { data } = await orgDb(admin, orgId).from('portal_login_events').select('via').eq('kind', 'link_sent').eq('customer_id', customerId).eq('detail', staffLinkDetail(token)).like('via', 'staff:%').limit(1).maybeSingle()
  const via = (data as { via?: string | null } | null)?.via
  return via ? via.slice('staff:'.length) : null
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
