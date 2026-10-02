/**
 * Canvass map disposition filter — one value, three shapes:
 *   null / ''              → all pins
 *   '<id>' | 'scheduled'   → only that disposition
 *   '!<id>'                → every pin EXCEPT that disposition (e.g. hide Solar Home pins)
 * Client-side matching for merged map pins (viewport + offline pending) lives here, and
 * /api/canvass/leads/viewport parses the same value with parseExcludedDisposition, so the two
 * cannot drift.
 */
const EXCLUDE_PREFIX = '!'

// Disposition ids are admin-generated (`dispo_<ms>`) or built-in snake_case. Anything else is
// rejected because the excluded id is interpolated into a PostgREST `.or()` filter string.
const DISPOSITION_ID_RE = /^[a-z0-9_]{1,64}$/

export function excludeDispositionFilter(dispositionId: string): string {
  return `${EXCLUDE_PREFIX}${dispositionId}`
}

/** True for any '!…' value, valid or not — callers must not treat those as an include filter. */
export function isExcludeDispositionFilter(filter: string | null | undefined): boolean {
  return Boolean(filter && filter.startsWith(EXCLUDE_PREFIX))
}

/** The disposition id an exclude filter hides, or null if the filter is not a (valid) exclude. */
export function parseExcludedDisposition(filter: string | null | undefined): string | null {
  if (!isExcludeDispositionFilter(filter)) return null
  const id = filter!.slice(EXCLUDE_PREFIX.length)
  return DISPOSITION_ID_RE.test(id) ? id : null
}

/**
 * The org's "Solar Home" disposition — an admin-created custom disposition, so its id differs
 * per org; matched by label.
 */
export function findSolarHomeDispositionId(
  dispositions: Array<{ id: string; label: string; active?: boolean }>
): string | null {
  const match = dispositions.find((d) => d.active !== false && /\bsolar\b/i.test(d.label))
  return match?.id ?? null
}

export function matchesCanvassDispositionFilter(
  pin: {
    disposition?: string | null
    status?: string
    d?: string | null
    s?: string
  },
  filter: string | null
): boolean {
  if (filter == null || filter === '') return true

  const disp = pin.disposition ?? pin.d ?? null

  if (isExcludeDispositionFilter(filter)) {
    const excluded = parseExcludedDisposition(filter)
    return excluded == null || disp !== excluded
  }

  if (filter === 'scheduled') {
    return (
      pin.status === 'inspection' ||
      pin.s === 'inspection' ||
      pin.disposition === 'inspection_scheduled' ||
      pin.d === 'inspection_scheduled'
    )
  }

  return disp === filter
}
