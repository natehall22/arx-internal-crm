import type { InspectionOutcomeConfigRow } from '@/lib/inspection-outcomes'
import { sortInspectionOutcomes } from '@/lib/inspection-outcomes'

/** Same row shape as inspection outcomes; `converts_to_opportunity` is stored for UI parity but ignored for close feedback server logic. */
export type CloseOutcomeConfigRow = InspectionOutcomeConfigRow

/** Default close feedback outcomes — keep ids stable for server behavior (`sold`, `said_no`, `insurance_follow_up`). */
export const DEFAULT_CLOSE_OUTCOMES: CloseOutcomeConfigRow[] = [
  {
    id: 'sold',
    label: 'Sold',
    description: 'Customer signed the contract',
    color: '#22c55e',
    icon: '✅',
    active: true,
    converts_to_opportunity: false,
    sort_order: 0,
  },
  {
    id: 'needs_another_visit',
    label: 'Needs Another Visit',
    description: 'Requires a follow-up close appointment',
    color: '#3b82f6',
    icon: '🔄',
    active: true,
    converts_to_opportunity: false,
    sort_order: 1,
  },
  {
    id: 'waiting_on_insurance',
    label: 'Waiting on Insurance',
    description: 'Pending insurance approval (no follow-up time yet)',
    color: '#8b5cf6',
    icon: '📋',
    active: true,
    converts_to_opportunity: false,
    sort_order: 2,
  },
  {
    id: 'insurance_follow_up',
    label: 'Insurance Follow Up',
    description: 'Schedule when to return (same as inspection feedback)',
    color: '#a855f7',
    icon: '📅',
    active: true,
    converts_to_opportunity: false,
    sort_order: 3,
  },
  {
    id: 'said_no',
    label: 'Said No',
    description: 'Customer declined',
    color: '#ef4444',
    icon: '❌',
    active: true,
    converts_to_opportunity: false,
    sort_order: 4,
  },
  {
    id: 'not_home',
    label: 'Not Home',
    description: "Customer wasn't there",
    color: '#f59e0b',
    icon: '❓',
    active: true,
    converts_to_opportunity: false,
    sort_order: 5,
  },
  {
    id: 'rescheduled',
    label: 'Rescheduled',
    description: 'Moved to a new date',
    color: '#6366f1',
    icon: '🔃',
    active: true,
    converts_to_opportunity: false,
    sort_order: 6,
  },
]

export function sortCloseOutcomes(
  rows: CloseOutcomeConfigRow[],
  options?: { includeInactive?: boolean }
): CloseOutcomeConfigRow[] {
  return sortInspectionOutcomes(rows, options)
}

export function resolveCloseOutcomeLabel(
  outcome: string | null | undefined,
  configured: CloseOutcomeConfigRow[] | undefined | null
): string {
  if (!outcome) return 'Recorded'
  const rows =
    Array.isArray(configured) && configured.length > 0
      ? configured
      : DEFAULT_CLOSE_OUTCOMES
  const found = rows.find((r) => r.id.toLowerCase() === outcome.toLowerCase())
  if (found?.label) return found.label
  return outcome.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getValidCloseOutcomeIdsFromSettings(
  configured: Array<{ id: string }> | undefined | null
): string[] {
  const rows =
    Array.isArray(configured) && configured.length > 0
      ? configured
      : DEFAULT_CLOSE_OUTCOMES
  return rows.map((r) => r.id).filter(Boolean)
}
