/**
 * Connecting a referral to the record the referred person turned into.
 *
 * The opportunity is the primary link: it carries the address, inspection, measure
 * and proposal, and it becomes the project whose install earns the bonus. Customer,
 * lead and project links are derived from it by the DB trigger in
 * 202607290002_referrals_opportunity_link.sql, so callers only pick one record.
 */

/**
 * Roles that can move a referral through its payout lifecycle (qualify, install, pay).
 * Single source of truth for both the UI gate (customer page) and the API routes that
 * accept a status change — kept together so the two cannot drift apart.
 */
export const REFERRAL_MANAGER_ROLES = new Set([
  'admin',
  'regional_manager',
  'sales_manager',
  'operations',
])

export function isReferralManagerRole(role: string | null | undefined): boolean {
  return REFERRAL_MANAGER_ROLES.has(String(role || '').toLowerCase())
}

export type ReferralLinkTargetType = 'opportunity' | 'customer' | 'lead'

export const REFERRAL_LINK_TARGET_TYPES: readonly ReferralLinkTargetType[] = [
  'opportunity',
  'customer',
  'lead',
] as const

export interface ReferralLinkTarget {
  id: string
  type: ReferralLinkTargetType
  /** Primary line in the picker — the person's name where we have one. */
  name: string
  /** Secondary line: address, status, or whatever disambiguates two same-name hits. */
  detail: string | null
  phone: string | null
  email: string | null
  address: string | null
}

export function isReferralLinkTargetType(value: unknown): value is ReferralLinkTargetType {
  return typeof value === 'string' && REFERRAL_LINK_TARGET_TYPES.includes(value as ReferralLinkTargetType)
}

/**
 * Builds a `%term%` operand for a PostgREST `ilike` filter used inside `or()`.
 *
 * Double-quoted, because `or()` splits on commas and parens at the top level: an
 * unquoted search for "Smith, John" is rejected with PGRST100, and a term carrying a
 * quote can otherwise close the value and append a real filter operand (verified
 * against this project's PostgREST -- an unescaped `x",status.eq.paid,name.ilike."y`
 * resolved `status` as a column). So `"` and `\` must be escaped, and are honoured.
 *
 * LIKE wildcards are stripped rather than escaped: `\%` and `\_` are NOT honoured
 * through this path (both still matched everything when tested), so escaping them
 * would be a silent lie that turns a typed `%` into match-all.
 */
export function buildIlikeFilterValue(term: string): string {
  const sanitized = term
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[%_]/g, ' ')
  return `"%${sanitized}%"`
}

/** Which referral columns a chosen target sets. The DB trigger fills in the rest. */
export function referralLinkColumns(
  target: Pick<ReferralLinkTarget, 'id' | 'type'>
): Record<string, string | null> {
  switch (target.type) {
    case 'opportunity':
      return { referred_opportunity_id: target.id }
    case 'customer':
      return { referred_customer_id: target.id }
    case 'lead':
      return { referred_lead_id: target.id }
  }
}

/** Clears every link column, so an unlink can't leave a half-attached referral behind. */
export function referralUnlinkColumns(): Record<string, null> {
  return {
    referred_opportunity_id: null,
    referred_customer_id: null,
    referred_lead_id: null,
    referred_project_id: null,
  }
}

export function formatOpportunityDetail(input: {
  address_text?: string | null
  status?: string | null
  project_type?: string | null
}): string | null {
  const parts = [
    input.address_text || null,
    input.status ? String(input.status).replace(/_/g, ' ') : null,
    input.project_type ? String(input.project_type).replace(/_/g, ' ') : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' • ') : null
}

/**
 * Sorts exact-ish name matches to the top so the rep's first hit is usually right,
 * then dedupes: an opportunity already implies its customer and lead, so showing all
 * three for one household is noise.
 */
export function rankAndDedupeLinkTargets(
  targets: ReferralLinkTarget[],
  query: string
): ReferralLinkTarget[] {
  const needle = query.trim().toLowerCase()
  const typeRank: Record<ReferralLinkTargetType, number> = { opportunity: 0, customer: 1, lead: 2 }

  const seen = new Set<string>()
  const deduped: ReferralLinkTarget[] = []

  const sorted = [...targets].sort((a, b) => {
    const aStarts = a.name.toLowerCase().startsWith(needle) ? 0 : 1
    const bStarts = b.name.toLowerCase().startsWith(needle) ? 0 : 1
    if (aStarts !== bStarts) return aStarts - bStarts
    if (typeRank[a.type] !== typeRank[b.type]) return typeRank[a.type] - typeRank[b.type]
    return a.name.localeCompare(b.name)
  })

  for (const target of sorted) {
    // Same id can legitimately appear once per type; key on both.
    const idKey = `${target.type}:${target.id}`
    if (seen.has(idKey)) continue
    seen.add(idKey)
    deduped.push(target)
  }

  return deduped
}
