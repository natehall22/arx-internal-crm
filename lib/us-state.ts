/**
 * The two-letter US state at the end of an address, read the SAME way the database reads it (public.property_address_key,
 * migration 202611110010): drop a country and a ZIP from the end, then a state code only when at least three words remain before it
 * ("12 Oak Ct" keeps its "ct"). Used by the multi-state pay warning; a miss returns null (never a guess).
 */
export const US_STATE_CODES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'] as const

const CODES = new Set<string>(US_STATE_CODES)

export function stateFromAddress(address: string | null | undefined): string | null {
  let s = String(address ?? '').toLowerCase().replace(/[^a-z0-9#\- ]+/g, ' ').replace(/\s+/g, ' ').trim()
  s = s.replace(/\s(usa|us|united states|united states of america)$/, '').trim()
  s = s.replace(/\s\d{5}(-\d{4})?$/, '').trim()
  const words = s.split(' ')
  const last = words[words.length - 1]?.toUpperCase() ?? ''
  return words.length >= 4 && CODES.has(last) ? last : null
}

/** A state code typed by a person: two letters, any case, a real state. */
export function parseStateCode(v: unknown): string | null {
  const s = String(v ?? '').trim().toUpperCase()
  return CODES.has(s) ? s : null
}
