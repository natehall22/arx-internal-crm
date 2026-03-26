/** Matches org `settings.inspection_outcomes` rows (admin Inspection Outcomes UI). */
export interface InspectionOutcomeConfigRow {
  id: string
  label: string
  description: string
  color: string
  icon: string
  active: boolean
  converts_to_opportunity: boolean
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
