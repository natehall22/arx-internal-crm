/**
 * Contact data for setters / canvassers: names, phones, emails and notes are theirs only for their OWN work.
 * The rule itself lives in SQL (arx_private.lead_mine, migration 202610290070) and also gates their database token (RLS);
 * this module is how the service-role APIs ask the same question, so the app and the database cannot disagree.
 * Canvass pins stay visible to them on the map (address, location, disposition, who knocked) — only the fields below are blanked.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { isInsideSalesRoleLike } from '@/lib/inside-sales-follow-up'
import { isFieldRoleLike } from '@/lib/permissions'

/** Lead columns that identify a person. Everything else on a pin (address, lat/lng, disposition, owner, status) stays. */
export const LEAD_CONTACT_FIELDS = ['homeowner_name', 'phone', 'email', 'notes', 'canvass_notes', 'raw_payload', 'external_lead_id', 'customer_id'] as const

export type ScopeProfile = { id: string; role: string; custom_role_id?: string | null; is_super_admin?: boolean | null }

/** Setter / canvasser (not inside sales, which works the whole queue; not owners). Mirrors public.is_setter_canvasser_self(). */
export function isSetterCanvasserLike(input: { role?: string | null; customRoleName?: string | null; customRoleDisplayName?: string | null; isSuperAdmin?: boolean | null }): boolean {
  if (input.isSuperAdmin) return false
  return isFieldRoleLike(input) && !isInsideSalesRoleLike({ role: input.role ?? '', customRoleName: input.customRoleName ?? null, customRoleDisplayName: input.customRoleDisplayName ?? null })
}

/** True when this person's contact access is limited to their own work. */
export async function isContactScoped(admin: SupabaseClient, profile: ScopeProfile): Promise<boolean> {
  let customRoleName: string | null = null
  let customRoleDisplayName: string | null = null
  if (profile.custom_role_id) {
    const { data } = await admin.from('custom_roles').select('name, display_name').eq('id', profile.custom_role_id).maybeSingle()
    customRoleName = data?.name ?? null
    customRoleDisplayName = data?.display_name ?? null
  }
  return isSetterCanvasserLike({ role: profile.role, customRoleName, customRoleDisplayName, isSuperAdmin: profile.is_super_admin })
}

/** Which of these leads are this user's own work (same SQL rule as RLS). */
export async function myLeadIds(admin: SupabaseClient, userId: string, ids: string[]): Promise<Set<string>> {
  const mine = new Set<string>()
  const unique = Array.from(new Set(ids.filter(Boolean)))
  for (let i = 0; i < unique.length; i += 1000) {
    const { data, error } = await admin.rpc('my_lead_ids', { p_user: userId, p_ids: unique.slice(i, i + 1000) })
    if (error) throw new Error(`my_lead_ids: ${error.message}`)
    for (const row of (data ?? []) as Array<string | { my_lead_ids?: string }>) mine.add(typeof row === 'string' ? row : String(row.my_lead_ids))
  }
  return mine
}

export async function mayReadLead(admin: SupabaseClient, profile: ScopeProfile, leadId: string): Promise<boolean> {
  if (!(await isContactScoped(admin, profile))) return true
  return (await myLeadIds(admin, profile.id, [leadId])).has(leadId)
}

export function redactLeadContact<T extends Record<string, unknown>>(lead: T): T {
  const out: Record<string, unknown> = { ...lead }
  for (const f of LEAD_CONTACT_FIELDS) if (f in out) out[f] = null
  return out as T
}

/** Blank contact fields on every lead that is not this user's own (no-op for everyone else). Pins keep address / location / disposition / owner. */
export async function redactLeadsForViewer<T extends { id: string; owner_user_id?: string | null; pin_attributed_user_id?: string | null; closer_user_id?: string | null }>(
  admin: SupabaseClient,
  profile: ScopeProfile,
  leads: T[]
): Promise<T[]> {
  if (leads.length === 0 || !(await isContactScoped(admin, profile))) return leads
  const direct = (l: T) => l.owner_user_id === profile.id || l.pin_attributed_user_id === profile.id || l.closer_user_id === profile.id
  const rest = leads.filter((l) => !direct(l)).map((l) => l.id)
  const mine = rest.length ? await myLeadIds(admin, profile.id, rest) : new Set<string>()
  return leads.map((l) => (direct(l) || mine.has(l.id) ? l : redactLeadContact(l)))
}
