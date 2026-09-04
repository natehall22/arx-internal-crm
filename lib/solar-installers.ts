/**
 * Solar installer identity + business status.
 *
 * The orphaned-solar campaign turns on one question: is the company that
 * installed this array still in business? Permits record the installer as a free
 * text string, spelled differently on nearly every row, so nothing works until
 * those strings collapse to a stable key.
 *
 * Deliberately conservative. Over-merging is the expensive failure here — fusing
 * two real companies into one key means telling a homeowner their installer is
 * dead when it isn't, which is both wrong and a UDTPA problem. Near-misses are
 * surfaced for human review instead (see `installerNameSimilarity`).
 */

export type InstallerStatus = 'active' | 'defunct' | 'unknown'

/** How an installer's status was determined. */
export type InstallerStatusSource = 'nc_sos' | 'electrical_board' | 'manual'

export type SolarInstaller = {
  id: string
  nameKey: string
  displayName: string
  status: InstallerStatus
  statusSource: InstallerStatusSource | null
  statusDetail: string | null
  statusCheckedAt: string | null
}

/**
 * Entity types that are never part of a company's actual name, so stripping them
 * is always safe. Order matters: multi-word forms precede the words they contain.
 */
const HARD_SUFFIXES = [
  'limited liability company',
  'limited partnership',
  'incorporated',
  'corporation',
  'pllc',
  'llp',
  'llc',
  'ltd',
  'inc',
  'corp',
  'lp',
  'pc',
]

/**
 * Suffixes that are usually decoration but sometimes the name itself — "Coastal
 * Solar Co" wants stripping, "The Solar Company" does not. Stripped only when
 * something distinctive survives; see `stripSuffixes`.
 */
const SOFT_SUFFIXES = ['company', 'co']

/**
 * Contractor values that identify no company at all. Owner-installed and
 * self-permitted systems record the homeowner here, and a homeowner is not a
 * defunct installer — they must never land in the installer registry.
 */
const NON_COMPANY_VALUES = new Set([
  'owner',
  'homeowner',
  'home owner',
  'self',
  'n a',
  'na',
  'none',
  'unknown',
  'tbd',
  'same',
  'owner builder',
  'property owner',
])

/** Words that identify a trade but not a business. */
const BARE_TRADE_WORDS = new Set(['solar', 'electric', 'electrical', 'roofing', 'energy'])

/** Nothing distinctive left to key on. */
function isTooGeneric(value: string): boolean {
  if (!value) return true
  if (NON_COMPANY_VALUES.has(value)) return true
  return BARE_TRADE_WORDS.has(value.replace(/^the\s+/, '').trim())
}

/**
 * Strip trailing entity suffixes. Hard suffixes always go; soft ones go only
 * while a distinctive name survives, so "The Solar Company" keeps its identity
 * and "Coastal Solar Co" loses its decoration.
 */
function stripSuffixes(input: string): string {
  let value = input
  let changed = true
  while (changed) {
    changed = false
    for (const suffix of HARD_SUFFIXES) {
      if (value === suffix) return ''
      if (value.endsWith(` ${suffix}`)) {
        value = value.slice(0, -(suffix.length + 1)).trim()
        changed = true
        break
      }
    }
  }
  for (const suffix of SOFT_SUFFIXES) {
    if (value === suffix) return ''
    if (value.endsWith(` ${suffix}`)) {
      const candidate = value.slice(0, -(suffix.length + 1)).trim()
      // Only strip when the remainder still names something.
      if (!isTooGeneric(candidate)) value = candidate
      break
    }
  }
  return value
}

/**
 * Collapse a permit's raw contractor string to a stable join key.
 *
 * Returns null when the value names no company — an empty cell, a homeowner
 * self-install, or a string too generic to identify anyone. Callers must treat
 * null as "no installer known", never as an installer named "".
 */
export function installerNameKey(raw: string | null | undefined): string | null {
  if (!raw) return null

  let value = raw.toLowerCase()

  // "ACME SOLAR LLC DBA SUNPRO" — the trading name after d/b/a is what tends to
  // appear on later permits, but the legal name is the one the Secretary of
  // State knows. Key on the legal name and let display carry the rest.
  value = value.split(/\bd\/?b\/?a\b/)[0]

  // Periods first, so "L.L.C." becomes "llc" rather than "l l c" — otherwise the
  // suffix match below silently misses every punctuated entity type.
  value = value.replace(/\.(?=\s|$)/g, ' ').replace(/\./g, '')

  // Remaining punctuation becomes spaces, so "sun-pro" and "sun pro" agree.
  value = value.replace(/[^a-z0-9]+/g, ' ').trim()

  value = stripSuffixes(value)
  value = value.replace(/\s+/g, ' ').trim()

  if (isTooGeneric(value)) return null

  return value.replace(/^the\s+/, '').trim() || null
}

/**
 * Human-facing name for an installer, cleaned but not collapsed. Keeps the
 * original capitalization intent without shouting a permit's all-caps entry.
 */
export function installerDisplayName(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/\s+/g, ' ').trim()
  if (!cleaned) return null
  if (!installerNameKey(cleaned)) return null

  // All-caps permit entries read as shouting; title-case them. Mixed-case input
  // is left alone, since it usually carries real intent ("SunPower", "iSolar").
  if (cleaned === cleaned.toUpperCase()) {
    return cleaned
      .toLowerCase()
      .replace(/\b([a-z])/g, (_, c: string) => c.toUpperCase())
      // Re-shout genuine initialisms that title-casing flattened.
      .replace(/\b(Llc|Inc|Pllc|Llp|Lp|Pc|Usa|Nc|Hvac)\b/g, (m) => m.toUpperCase())
  }
  return cleaned
}

/**
 * Token-overlap similarity in [0,1] between two installer keys.
 *
 * Used to SURFACE probable duplicates for a human to confirm, never to merge
 * automatically. "abc solar charlotte" vs "abc solar raleigh" scores high but
 * may be separate franchises with separate fates.
 */
export function installerNameSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const setA = new Set(a.split(' ').filter(Boolean))
  const setB = new Set(b.split(' ').filter(Boolean))
  if (!setA.size || !setB.size) return 0
  let shared = 0
  setA.forEach((token) => {
    if (setB.has(token)) shared += 1
  })
  return shared / Math.max(setA.size, setB.size)
}

/** Pairs at or above this overlap are worth a human look during ingest. */
export const INSTALLER_REVIEW_SIMILARITY = 0.6

/**
 * Is this install worth the orphaned-system pitch?
 *
 * Only a confirmed-defunct installer earns it. 'unknown' deliberately does not:
 * telling a homeowner their installer is out of business when we simply failed
 * to match the name is a false claim, and NC's UDTPA needs no intent to bite.
 */
export function isOrphaned(status: InstallerStatus): boolean {
  return status === 'defunct'
}
