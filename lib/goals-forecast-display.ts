import type { ForecastMetricKey, ForecastMetricOutput } from '@/lib/goals-forecast'
import { GOALS_TIMEZONE } from '@/lib/goals-period'

const MS_DAY = 86_400_000

const CURRENCY_METRICS = new Set<ForecastMetricKey>(['revenueSigned', 'revenueCollected'])

export function isCurrencyMetric(key: ForecastMetricKey | string): boolean {
  return CURRENCY_METRICS.has(key as ForecastMetricKey)
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

export function metricProjectedTotal(metric: ForecastMetricOutput): number {
  return metric.actual + metric.knownBooked + metric.projected
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
