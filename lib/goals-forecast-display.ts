import type { GoalCoverage, RateAssumption, ForecastMetricKey } from '@/lib/goals-forecast'
import { GOALS_TIMEZONE } from '@/lib/goals-period'

const MS_DAY = 86_400_000

const CURRENCY_METRICS = new Set<ForecastMetricKey>(['revenueSigned', 'revenueCollected'])

/** Display order and labels for the forecast table — the source of truth for both. */
export const FORECAST_METRIC_LABELS: Record<ForecastMetricKey, string> = {
  doors: 'Doors',
  sets: 'Sets',
  sits: 'Sits',
  sales: 'Sales',
  revenueSigned: 'Revenue (signed)',
  revenueCollected: 'Revenue (collected)',
}

export const FORECAST_METRIC_ORDER = Object.keys(FORECAST_METRIC_LABELS) as ForecastMetricKey[]

export function isCurrencyMetric(key: ForecastMetricKey | string): boolean {
  return CURRENCY_METRICS.has(key as ForecastMetricKey)
}

export function formatPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(1)}%`
}

export function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value))
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatMetricValue(key: ForecastMetricKey | string, value: number): string {
  return isCurrencyMetric(key) ? formatCurrency(value) : formatInteger(value)
}

/**
 * Assumption values are either a 0–1 rate or a day count — formatting off the label
 * text would silently mangle a renamed assumption, so switch on the declared kind.
 */
export function formatAssumptionValue(assumption: RateAssumption): string {
  if (assumption.value == null || !Number.isFinite(assumption.value)) return '—'
  if (assumption.kind === 'days') {
    const days = Math.round(assumption.value)
    return `${days} ${days === 1 ? 'day' : 'days'}`
  }
  return formatPct(assumption.value)
}

/** "163 short" / "8 over" — a bare signed number reads ambiguously against a goal. */
export function formatGapToGoal(key: ForecastMetricKey | string, gap: number | null): string {
  if (gap == null || !Number.isFinite(gap)) return '—'
  return gap > 0
    ? `${formatMetricValue(key, gap)} short`
    : `${formatMetricValue(key, -gap)} over`
}

/** Sample-size / window suffix, e.g. " (90d, n=152)". */
export function formatAssumptionBasis(assumption: RateAssumption): string {
  return assumption.window
    ? ` (${assumption.window}, n=${assumption.sampleSize})`
    : ` (n=${assumption.sampleSize})`
}

/**
 * Plain-language caveat when the Goal column isn't a clean sum of whole-month
 * targets — either a month in the range has no goal saved, or the range covers only
 * part of a month and its target was prorated by day count.
 */
export function describeGoalCoverage(coverage: GoalCoverage): string | null {
  const notes: string[] = []
  if (coverage.monthsMissingGoal.length > 0) {
    notes.push(
      `no goal saved for ${coverage.monthsMissingGoal.join(', ')} — the target below covers only ${
        coverage.months.length - coverage.monthsMissingGoal.length
      } of ${coverage.months.length} months in this range`
    )
  }
  if (coverage.prorated) {
    notes.push('this range covers part of a month, so its monthly target is prorated by day count')
  }
  return notes.length > 0 ? notes.join('; ') : null
}

export function formatSignedDelta(key: ForecastMetricKey | string, delta: number | null): string {
  if (delta == null || !Number.isFinite(delta)) return '—'
  if (delta === 0) return formatMetricValue(key, 0)
  const formatted = formatMetricValue(key, Math.abs(delta))
  return delta > 0 ? `+${formatted}` : `-${formatted}`
}

export function formatDeltaPct(delta: number | null, compareTotal: number): string {
  if (delta == null || !Number.isFinite(delta)) return '—'
  if (compareTotal === 0) return '—'
  return `${((delta / compareTotal) * 100).toFixed(1)}%`
}

export function deltaTextClass(delta: number | null): string {
  if (delta == null || !Number.isFinite(delta) || delta === 0) return 'text-gray-600'
  return delta > 0 ? 'text-emerald-700' : 'text-rose-700'
}

export function formatForecastRangeLabel(rangeStartIso: string, rangeEndIso: string): string {
  const start = new Date(rangeStartIso)
  const endInclusive = new Date(new Date(rangeEndIso).getTime() - MS_DAY)
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', {
      timeZone: GOALS_TIMEZONE,
      month: 'short',
      day: 'numeric',
    })
  return `${fmt(start)} – ${fmt(endInclusive)}`
}
