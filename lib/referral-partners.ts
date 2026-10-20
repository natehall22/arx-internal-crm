import type { SupabaseClient } from '@supabase/supabase-js'

import { effectiveHasPermission, resolveEffectivePermissionNames } from '@/lib/effective-permissions'

export type ReferralPartnerStatus = 'assigned' | 'open' | 'company_relationship'

/** Button label → `activities.type`. The labels are fixed product wording. */
export const TOUCH_BUTTONS = [
  { label: 'Called', type: 'call' },
  { label: 'Texted', type: 'text' },
  { label: 'Emailed', type: 'email' },
  { label: 'Visited', type: 'visit' },
] as const
export type TouchType = (typeof TOUCH_BUTTONS)[number]['type']
const TOUCH_TYPES = new Set<string>(TOUCH_BUTTONS.map((b) => b.type))
export function isTouchType(value: unknown): value is TouchType {
  return typeof value === 'string' && TOUCH_TYPES.has(value)
}

/** Partners that open within this many days are surfaced as "opening soon". */
export const OPENING_SOON_DAYS = 7
const DAY_MS = 86_400_000

export const PARTNER_SELECT =
  'id, org_id, type_id, other_type_text, name, phone, email, company, notes, assigned_user_id, status, assigned_at, last_touched_at, created_by, created_at, ' +
  'type:referral_partner_types(id, name, inactivity_days), assignee:users!referral_partners_assigned_user_id_fkey(id, full_name)'

export type ReferralPartnerRow = {
  id: string
  org_id: string
  type_id: string
  other_type_text: string | null
  name: string
  phone: string | null
  email: string | null
  company: string | null
  notes: string | null
  assigned_user_id: string | null
  status: ReferralPartnerStatus
  assigned_at: string | null
  last_touched_at: string
  created_by: string | null
  created_at: string
  type: { id: string; name: string; inactivity_days: number } | null
  assignee: { id: string; full_name: string | null } | null
}

/** Whole days until an `assigned` partner opens up; null when it can't (open / Company Relationship). */
export function daysUntilOpen(
  partner: Pick<ReferralPartnerRow, 'status' | 'last_touched_at' | 'type'>,
  now: Date = new Date()
): number | null {
  if (partner.status !== 'assigned' || !partner.type) return null
  const opensAt = new Date(partner.last_touched_at).getTime() + partner.type.inactivity_days * DAY_MS
  return Math.max(0, Math.ceil((opensAt - now.getTime()) / DAY_MS))
}

/** Reps see "Other: <text>" the way they typed it; everything else is the type name. */
export function partnerTypeLabel(partner: Pick<ReferralPartnerRow, 'type' | 'other_type_text'>): string {
  const name = partner.type?.name ?? 'Other'
  return name.toLowerCase() === 'other' && partner.other_type_text?.trim()
    ? partner.other_type_text.trim()
    : name
}

export function assignedToLabel(
  partner: Pick<ReferralPartnerRow, 'status' | 'assignee'>
): string {
  if (partner.status === 'company_relationship') return 'Company Relationship'
  if (partner.status === 'open') return 'Open'
  return partner.assignee?.full_name?.trim() || 'Unknown rep'
}

/** Normalised the same way as the DB (`referral_partner_normalize_phone`). */
export function normalizePartnerPhone(phone: string | null | undefined): string | null {
  const digits = String(phone ?? '')
    .replace(/\s*(x|ext\.?|extension)\s*\d+\s*$/i, '')
    .replace(/\D/g, '')
  if (!digits || digits.length > 15) return null
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

export type PartnerAccess = { canManage: boolean }

/** `referral_partners:manage` (admins/owners via admin:full, or a granted permission). */
export async function getPartnerAccess(
  supabase: SupabaseClient,
  userId: string,
  profile: { role: string; custom_role_id?: string | null }
): Promise<PartnerAccess> {
  const effective = await resolveEffectivePermissionNames(supabase, userId, profile)
  return { canManage: effectiveHasPermission(effective, 'referral_partners:manage') }
}

/**
 * Who may set "Referred By" on an opportunity. It decides who is paid on the deal, so it has
 * the same gate as setter/closer attribution (admin, owner, operations) plus partner managers.
 */
const REFERRED_BY_ROLES = new Set(['admin', 'owner', 'operations'])
export function canSetReferredBy(role: string | null | undefined, access: PartnerAccess): boolean {
  return access.canManage || REFERRED_BY_ROLES.has(String(role || '').toLowerCase())
}

/** The assigned rep, or a manager. Logging a touch and editing details use the same rule. */
export function canWorkPartner(
  partner: Pick<ReferralPartnerRow, 'assigned_user_id' | 'status'>,
  userId: string,
  access: PartnerAccess
): boolean {
  return access.canManage || (partner.status === 'assigned' && partner.assigned_user_id === userId)
}

/**
 * Everyone in the org sees THAT a partner exists and who it is Assigned To; phone, email and
 * notes belong to the assigned rep and admins. Apply to every partner the API returns.
 */
export function redactPartner<
  T extends Pick<ReferralPartnerRow, 'phone' | 'email' | 'notes' | 'assigned_user_id' | 'status'>,
>(partner: T, userId: string, access: PartnerAccess): T {
  if (canWorkPartner(partner, userId, access)) return partner
  return { ...partner, phone: null, email: null, notes: null }
}

/** PostgREST `or()` filter values: strip characters that would break out of the filter. */
export function safeLikeTerm(raw: string): string {
  return raw.replace(/[%_,()\\*"]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** A row as `/api/referral-partners` returns it. */
export type PartnerListItem = ReferralPartnerRow & {
  days_until_open: number | null
  is_mine: boolean
  /** Near-spelling match, not a prefix match. */
  similar: boolean
}

export function formatOpensIn(days: number | null): string | null {
  if (days === null) return null
  if (days === 0) return 'Opens today'
  return days === 1 ? 'Opens in 1 day' : `Opens in ${days} days`
}
