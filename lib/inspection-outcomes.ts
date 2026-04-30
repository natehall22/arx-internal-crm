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
  /** When true, unresolved opportunities age into the inside-sales queue after the configured delay. */
  inside_sales_handoff_enabled?: boolean
  /** Delay, in days, before an unresolved opportunity is auto-sent to inside sales. */
  inside_sales_handoff_delay_days?: number | null
  sort_order: number
}

export const DEFAULT_INSIDE_SALES_HANDOFF_DELAY_DAYS = 7

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
    counts_as_sit: true,
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
    converts_to_opportunity: true,
    counts_as_sit: true,
    inside_sales_handoff_enabled: true,
    inside_sales_handoff_delay_days: DEFAULT_INSIDE_SALES_HANDOFF_DELAY_DAYS,
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
    counts_as_sit: true,
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
    counts_as_sit: true,
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
    counts_as_sit: true,
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

function normalizeDelayDays(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const normalized = Math.max(0, Math.floor(value))
  return normalized
}

/** Match admin rows that reused a default label but got a custom id (handoff flags inherit from defaults). */
function inspectionOutcomeLabelKey(label: string | null | undefined): string {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function normalizeInspectionOutcomeRow(
  row: InspectionOutcomeConfigRow,
  index = 0
): InspectionOutcomeConfigRow {
  const fallbackById = DEFAULT_INSPECTION_OUTCOMES.find(
    (candidate) => normalizeInspectionOutcomeId(candidate.id) === normalizeInspectionOutcomeId(row.id)
  )
  const fallbackByLabel =
    !fallbackById && row.label
      ? DEFAULT_INSPECTION_OUTCOMES.find(
          (candidate) =>
            inspectionOutcomeLabelKey(candidate.label) === inspectionOutcomeLabelKey(row.label)
        )
      : undefined
  const fallback = fallbackById ?? fallbackByLabel
  const handoffEnabled =
    row.inside_sales_handoff_enabled === true ||
    (row.inside_sales_handoff_enabled === undefined && fallback?.inside_sales_handoff_enabled === true)
  const fallbackDelay =
    normalizeDelayDays(fallback?.inside_sales_handoff_delay_days) ??
    DEFAULT_INSIDE_SALES_HANDOFF_DELAY_DAYS
  const explicitDelay = normalizeDelayDays(row.inside_sales_handoff_delay_days)

  return {
    ...row,
    converts_to_opportunity: handoffEnabled ? true : row.converts_to_opportunity,
    counts_as_sit: row.counts_as_sit ?? fallback?.counts_as_sit ?? false,
    inside_sales_handoff_enabled: handoffEnabled,
    inside_sales_handoff_delay_days: handoffEnabled
      ? explicitDelay ?? fallbackDelay
      : null,
    sort_order: typeof row.sort_order === 'number' ? row.sort_order : fallback?.sort_order ?? index,
  }
}

export function normalizeInspectionOutcomeRows(
  rows: InspectionOutcomeConfigRow[] | null | undefined
): InspectionOutcomeConfigRow[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    return DEFAULT_INSPECTION_OUTCOMES.map((row, index) => normalizeInspectionOutcomeRow(row, index))
  }
  return rows.map((row, index) => normalizeInspectionOutcomeRow(row, index))
}

export function getInspectionOutcomeConfig(
  orgRows: InspectionOutcomeConfigRow[] | null | undefined,
  outcomeId: string | null | undefined
): InspectionOutcomeConfigRow | null {
  const normalizedOutcomeId = normalizeInspectionOutcomeId(outcomeId)
  if (!normalizedOutcomeId) return null
  const rows = normalizeInspectionOutcomeRows(orgRows)
  return (
    rows.find((row) => normalizeInspectionOutcomeId(row.id) === normalizedOutcomeId) ?? null
  )
}

export function getInspectionOutcomeInsideSalesHandoff(
  orgRows: InspectionOutcomeConfigRow[] | null | undefined,
  outcomeId: string | null | undefined
): { enabled: boolean; delayDays: number | null } {
  const config = getInspectionOutcomeConfig(orgRows, outcomeId)
  if (!config?.inside_sales_handoff_enabled) {
    return { enabled: false, delayDays: null }
  }
  return {
    enabled: true,
    delayDays:
      normalizeDelayDays(config.inside_sales_handoff_delay_days) ??
      DEFAULT_INSIDE_SALES_HANDOFF_DELAY_DAYS,
  }
}

/**
 * True when recording this outcome should mark the scheduled appointment as no-show (customer not present).
 * Not used for inside-sales queue routing — that follows `inside_sales_handoff_*` on the outcome row.
 * Matches default id `not_home` and admin rows that keep the default “Not Home” label but use a custom id.
 */
export function inspectionOutcomeRoutesToInsideSalesDidntSit(
  orgRows: InspectionOutcomeConfigRow[] | null | undefined,
  outcomeId: string | null | undefined
): boolean {
  const idNorm = normalizeInspectionOutcomeId(outcomeId)
  if (!idNorm) return false
  if (idNorm === 'not_home') return true
  const cfg = getInspectionOutcomeConfig(orgRows, outcomeId)
  if (!cfg || cfg.active === false) return false
  const defaultNotHome = DEFAULT_INSPECTION_OUTCOMES.find(
    (o) => normalizeInspectionOutcomeId(o.id) === 'not_home'
  )
  if (!defaultNotHome) return false
  const a = (cfg.label || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const b = (defaultNotHome.label || '').trim().toLowerCase().replace(/\s+/g, ' ')
  return a === b && a.length > 0
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
