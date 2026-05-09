import type { InspectionOutcomeConfigRow } from '@/lib/inspection-outcomes'
import {
  DEFAULT_INSIDE_SALES_HANDOFF_DELAY_DAYS,
  normalizeInspectionOutcomeId,
  sortInspectionOutcomes,
} from '@/lib/inspection-outcomes'

export type CloseOutcomeAction = 'none' | 'won' | 'lost'

/** Same base row shape as inspection outcomes, with close-feedback routing fields. */
export type CloseOutcomeConfigRow = InspectionOutcomeConfigRow & {
  /** Close feedback server action. Future outcomes should use this instead of relying on reserved ids. */
  close_action?: CloseOutcomeAction
}

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
    close_action: 'won',
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
    inside_sales_handoff_enabled: true,
    inside_sales_handoff_delay_days: DEFAULT_INSIDE_SALES_HANDOFF_DELAY_DAYS,
    close_action: 'none',
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
    inside_sales_handoff_enabled: true,
    inside_sales_handoff_delay_days: DEFAULT_INSIDE_SALES_HANDOFF_DELAY_DAYS,
    close_action: 'none',
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
    inside_sales_handoff_enabled: true,
    inside_sales_handoff_delay_days: DEFAULT_INSIDE_SALES_HANDOFF_DELAY_DAYS,
    close_action: 'none',
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
    close_action: 'lost',
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
    inside_sales_handoff_enabled: true,
    inside_sales_handoff_delay_days: DEFAULT_INSIDE_SALES_HANDOFF_DELAY_DAYS,
    close_action: 'none',
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
    inside_sales_handoff_enabled: true,
    inside_sales_handoff_delay_days: DEFAULT_INSIDE_SALES_HANDOFF_DELAY_DAYS,
    close_action: 'none',
    sort_order: 6,
  },
]

function normalizeDelayDays(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.floor(value))
}

function closeOutcomeLabelKey(label: string | null | undefined): string {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function fallbackCloseAction(row: Pick<CloseOutcomeConfigRow, 'id' | 'label'>): CloseOutcomeAction {
  const id = normalizeInspectionOutcomeId(row.id)
  const label = closeOutcomeLabelKey(row.label)
  if (id === 'sold' || label === 'sold') return 'won'
  if (id === 'said_no' || id === 'lost' || label === 'said no' || label === 'lost') return 'lost'
  return 'none'
}

export function normalizeCloseOutcomeRow(
  row: CloseOutcomeConfigRow,
  index = 0
): CloseOutcomeConfigRow {
  const fallbackById = DEFAULT_CLOSE_OUTCOMES.find(
    (candidate) => normalizeInspectionOutcomeId(candidate.id) === normalizeInspectionOutcomeId(row.id)
  )
  const fallbackByLabel =
    !fallbackById && row.label
      ? DEFAULT_CLOSE_OUTCOMES.find(
          (candidate) => closeOutcomeLabelKey(candidate.label) === closeOutcomeLabelKey(row.label)
        )
      : undefined
  const fallback = fallbackById ?? fallbackByLabel
  const closeAction =
    row.close_action === 'won' || row.close_action === 'lost' || row.close_action === 'none'
      ? row.close_action
      : fallback?.close_action ?? fallbackCloseAction(row)
  const handoffEnabled =
    closeAction === 'none' &&
    row.inside_sales_handoff_enabled !== false &&
    (row.inside_sales_handoff_enabled === true ||
      row.inside_sales_handoff_enabled === undefined ||
      fallback?.inside_sales_handoff_enabled === true)
  const fallbackDelay =
    normalizeDelayDays(fallback?.inside_sales_handoff_delay_days) ??
    DEFAULT_INSIDE_SALES_HANDOFF_DELAY_DAYS
  const explicitDelay = normalizeDelayDays(row.inside_sales_handoff_delay_days)

  return {
    ...row,
    close_action: closeAction,
    inside_sales_handoff_enabled: handoffEnabled,
    inside_sales_handoff_delay_days: handoffEnabled ? explicitDelay ?? fallbackDelay : null,
    sort_order: typeof row.sort_order === 'number' ? row.sort_order : fallback?.sort_order ?? index,
  }
}

export function normalizeCloseOutcomeRows(
  rows: CloseOutcomeConfigRow[] | null | undefined
): CloseOutcomeConfigRow[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    return DEFAULT_CLOSE_OUTCOMES.map((row, index) => normalizeCloseOutcomeRow(row, index))
  }
  return rows.map((row, index) => normalizeCloseOutcomeRow(row, index))
}

export function getCloseOutcomeConfig(
  rows: CloseOutcomeConfigRow[] | null | undefined,
  outcomeId: string | null | undefined
): CloseOutcomeConfigRow | null {
  const normalizedOutcomeId = normalizeInspectionOutcomeId(outcomeId)
  if (!normalizedOutcomeId) return null
  const normalizedRows = normalizeCloseOutcomeRows(rows)
  return (
    normalizedRows.find((row) => normalizeInspectionOutcomeId(row.id) === normalizedOutcomeId) ??
    DEFAULT_CLOSE_OUTCOMES.map((row, index) => normalizeCloseOutcomeRow(row, index)).find(
      (row) => normalizeInspectionOutcomeId(row.id) === normalizedOutcomeId
    ) ??
    null
  )
}

export function getCloseOutcomeAction(
  rows: CloseOutcomeConfigRow[] | null | undefined,
  outcomeId: string | null | undefined
): CloseOutcomeAction {
  const config = getCloseOutcomeConfig(rows, outcomeId)
  if (config?.close_action) return config.close_action
  return fallbackCloseAction({ id: outcomeId || '', label: outcomeId || '' })
}

export function getCloseOutcomeInsideSalesHandoff(
  rows: CloseOutcomeConfigRow[] | null | undefined,
  outcomeId: string | null | undefined
): { enabled: boolean; delayDays: number | null } {
  const config = getCloseOutcomeConfig(rows, outcomeId)
  if (!config?.inside_sales_handoff_enabled) return { enabled: false, delayDays: null }
  return {
    enabled: true,
    delayDays:
      normalizeDelayDays(config.inside_sales_handoff_delay_days) ??
      DEFAULT_INSIDE_SALES_HANDOFF_DELAY_DAYS,
  }
}

export function sortCloseOutcomes(
  rows: CloseOutcomeConfigRow[],
  options?: { includeInactive?: boolean }
): CloseOutcomeConfigRow[] {
  return sortInspectionOutcomes(normalizeCloseOutcomeRows(rows), options)
}

export function resolveCloseOutcomeLabel(
  outcome: string | null | undefined,
  configured: CloseOutcomeConfigRow[] | undefined | null
): string {
  if (!outcome) return 'Recorded'
  const rows =
    Array.isArray(configured) && configured.length > 0
      ? normalizeCloseOutcomeRows(configured)
      : normalizeCloseOutcomeRows(DEFAULT_CLOSE_OUTCOMES)
  const found = rows.find((r) => r.id.toLowerCase() === outcome.toLowerCase())
  if (found?.label) return found.label
  return outcome.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getValidCloseOutcomeIdsFromSettings(
  configured: Array<{ id: string }> | undefined | null
): string[] {
  const rows =
    Array.isArray(configured) && configured.length > 0
      ? normalizeCloseOutcomeRows(configured as CloseOutcomeConfigRow[])
      : normalizeCloseOutcomeRows(DEFAULT_CLOSE_OUTCOMES)
  return rows.map((r) => r.id).filter(Boolean)
}
