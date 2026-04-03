/** Matches org `settings.inspection_outcomes` rows (admin Inspection Outcomes UI). */
export interface InspectionOutcomeConfigRow {
  id: string
  label: string
  description: string
  color: string
  icon: string
  active: boolean
  converts_to_opportunity: boolean
  /** When true, opportunities with this inspection_outcome count toward Team Stats "Sits". */
  counts_as_sit?: boolean
  sort_order: number
}

/** Default list — keep in sync with `app/admin/settings/page.tsx` initial state. */
export const DEFAULT_INSPECTION_OUTCOMES: InspectionOutcomeConfigRow[] = [
  {
    id: 'sale',
    label: 'Sale',
    description: 'Customer signed the contract',
    color: '#22c55e',
    icon: '✓',
    active: true,
    converts_to_opportunity: true,
    sort_order: 0,
  },
  {
    id: 'moving_to_close',
    label: 'Moving to Close',
    description: 'Customer interested, following up to close',
    color: '#10b981',
    icon: '→',
    active: true,
    converts_to_opportunity: true,
    counts_as_sit: true,
    sort_order: 1,
  },
  {
    id: 'insurance_follow_up',
    label: 'Insurance Follow Up',
    description: 'Waiting on insurance claim/approval',
    color: '#8b5cf6',
    icon: '📋',
    active: true,
    converts_to_opportunity: false,
    sort_order: 2,
  },
  {
    id: 'said_no',
    label: 'Said No',
    description: 'Customer declined after presentation',
    color: '#ef4444',
    icon: '✗',
    active: true,
    converts_to_opportunity: false,
    sort_order: 3,
  },
  {
    id: 'not_home',
    label: 'Not Home',
    description: 'Customer was not present',
    color: '#f59e0b',
    icon: '?',
    active: true,
    converts_to_opportunity: false,
    sort_order: 4,
  },
  {
    id: 'no_problems_found',
    label: 'No Problems Found',
    description: 'Roof inspection showed no issues',
    color: '#6b7280',
    icon: '○',
    active: true,
    converts_to_opportunity: false,
    sort_order: 5,
  },
  {
    id: 'needs_repair',
    label: 'Needs Repair',
    description: 'Roof needs repair work, not full replacement',
    color: '#f97316',
    icon: '🔧',
    active: true,
    converts_to_opportunity: false,
    sort_order: 6,
  },
  {
    id: 'rescheduled',
    label: 'Rescheduled',
    description: 'Appointment moved to new date',
    color: '#3b82f6',
    icon: '↻',
    active: true,
    converts_to_opportunity: false,
    sort_order: 7,
  },
]

export function sortInspectionOutcomes(
  rows: InspectionOutcomeConfigRow[],
  options?: { includeInactive?: boolean }
): InspectionOutcomeConfigRow[] {
  const includeInactive = options?.includeInactive === true
  return [...rows]
    .filter((o) => includeInactive || o.active !== false)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
}

export function sortActiveOutcomes(rows: InspectionOutcomeConfigRow[]): InspectionOutcomeConfigRow[] {
  return sortInspectionOutcomes(rows, { includeInactive: false })
}

/** Normalize outcome ids for comparisons (admin may use hyphens or different casing). */
export function normalizeInspectionOutcomeId(id: string | null | undefined): string {
  return String(id || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
}

/** Normalized outcome ids that count as a "sit" for Team Stats (admin Inspection outcomes). */
export function getSitOutcomeNormalizedIdSet(
  orgRows: InspectionOutcomeConfigRow[] | null | undefined
): Set<string> {
  const rows =
    Array.isArray(orgRows) && orgRows.length > 0 ? orgRows : DEFAULT_INSPECTION_OUTCOMES
  const set = new Set<string>()
  for (const o of rows) {
    if (o.active === false) continue
    const idNorm = normalizeInspectionOutcomeId(o.id)
    const countsAsSit =
      o.counts_as_sit === true ||
      (o.counts_as_sit === undefined && idNorm === 'moving_to_close')
    if (!countsAsSit) continue
    set.add(idNorm)
  }
  return set
}

/** True when id matches the built-in moving-to-close outcome after normalization. */
export function isMovingToCloseOutcomeId(id: string | null | undefined): boolean {
  return normalizeInspectionOutcomeId(id) === 'moving_to_close'
}

/**
 * Whether this outcome should show the close scheduling UI (team round-robin or individual closer).
 * Handles customized org outcomes that keep the default label but a generated id (e.g. outcome_…).
 */
export function inspectionOutcomeRequiresCloseSchedule(
  o: Pick<InspectionOutcomeConfigRow, 'id' | 'label'>
): boolean {
  if (isMovingToCloseOutcomeId(o.id)) return true
  const label = (o.label || '').trim().toLowerCase()
  return label === 'moving to close'
}
