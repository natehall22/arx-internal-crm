/**
 * Staff: invite one customer to the portal ("Invite to portal", one tap) or take their access away. The invitation is
 * `customers.portal_invited_at`; in an invite-only company (roofing default, lib/portal/settings.ts) only invited customers can get a
 * sign-in link or keep a session. Inviting emails the same one-time link as the customer's own request, to the address ON FILE only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { isUsableCustomerEmail } from '@/lib/invoice-document'
import { revokeCustomerPortalAccess, sendLoginLinks, takePortalAttempt } from '@/lib/portal/server'
import { orgDb } from '@/lib/supabase/org-db'

export type InviteResult = { ok: true; sentTo: string } | { ok: false; status: 404 | 409 | 429 | 500; error: string }

export async function inviteCustomerToPortal(admin: SupabaseClient, orgId: string, customerId: string, staffUserId: string): Promise<InviteResult> {
  const db = orgDb(admin, orgId)
  const { data } = await db.from('customers').select('id, name, email').eq('id', customerId).maybeSingle()
  const c = data as { id: string; name: string | null; email: string | null } | null
  if (!c) return { ok: false, status: 404, error: 'Not found' }
  if (!isUsableCustomerEmail(c.email)) return { ok: false, status: 409, error: 'Add an email address for this customer first.' }
  // Same fail-closed limits as a customer's own request, plus a staff-side cap so one tap cannot be held down.
  if (!(await takePortalAttempt(admin, `invite-cust:${customerId}`, { limit: 3, windowSeconds: 3600 }))) return { ok: false, status: 429, error: 'Already sent a few times. Try again in an hour.' }
  const { error } = await db.from('customers').update({ portal_invited_at: new Date().toISOString() }).eq('id', customerId)
  if (error) return { ok: false, status: 409, error: 'Inviting turns on once the customer portal update is applied.' }
  const sent = await sendLoginLinks(admin, orgId, [c], `staff:${staffUserId}`, { invite: true })
  if (!sent) return { ok: false, status: 500, error: 'The invitation could not be emailed. Check that email is set up, then try again.' }
  return { ok: true, sentTo: String(c.email).trim() }
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
export async function loadPortalAccessState(admin: SupabaseClient, orgId: string, customerId: string): Promise<{ inviteOnly: boolean; invitedAt: string | null }> {
  const { loadPortalSettings } = await import('@/lib/portal/settings')
  const [settings, row] = await Promise.all([loadPortalSettings(admin, orgId), orgDb(admin, orgId).from('customers').select('portal_invited_at').eq('id', customerId).maybeSingle()])
  const invitedAt = row.error ? null : ((row.data as { portal_invited_at?: string | null } | null)?.portal_invited_at ?? null)
  return { inviteOnly: settings.inviteOnly, invitedAt }
}
