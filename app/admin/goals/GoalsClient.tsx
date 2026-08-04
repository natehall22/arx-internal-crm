'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { OrgMonthlyGoal, ScorecardPayload } from '@/lib/goals-scorecard'
import type { ForecastMetricKey, ForecastResult } from '@/lib/goals-forecast'
import {
  deltaTextClass,
  describeGoalCoverage,
  formatAssumptionBasis,
  formatAssumptionValue,
  formatCurrency,
  formatDeltaPct,
  formatForecastRangeLabel,
  formatGapToGoal,
  formatInteger,
  formatMetricValue,
  formatPct,
  formatSignedDelta,
  FORECAST_METRIC_LABELS,
  FORECAST_METRIC_ORDER,
} from '@/lib/goals-forecast-display'
import { getCurrentMonthIso, getPreviousMonthIso, isPastGoalMonth } from '@/lib/goals-period'
import { formatNumericDraft, parseDraftFloat } from '@/lib/numeric-input-draft'

type TabId = 'scorecard' | 'goals' | 'forecast'

/** Response shape of GET /api/admin/goals/forecast. */
type ForecastPayload = {
  forecast: ForecastResult
  compare?: ForecastResult | null
  deltas?: Record<ForecastMetricKey, number | null> | null
}

function attainmentTint(pct: number | null): string {
  if (pct == null) return 'bg-white'
  if (pct >= 100) return 'bg-emerald-50 ring-1 ring-emerald-200'
  if (pct >= 70) return 'bg-amber-50 ring-1 ring-amber-200'
  return 'bg-rose-50 ring-1 ring-rose-200'
}

function KpiTile({
  label,
  value,
  goal,
  attainmentPct,
  format,
}: {
  label: string
  value: number
  goal: number | null
  attainmentPct: number | null
  format: 'integer' | 'currency'
}) {
  const display = format === 'currency' ? formatCurrency(value) : formatInteger(value)
  return (
    <div className={`rounded-xl p-4 ${attainmentTint(attainmentPct)}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">{label}</p>
      <p className="mt-1 text-2xl font-bold" style={{ color: '#2c2c2a' }}>
        {display}
      </p>
      {goal != null ? (
        <p className="mt-1 text-sm" style={{ color: '#2c2c2a' }}>
          goal {format === 'currency' ? formatCurrency(goal) : formatInteger(goal)}
          {attainmentPct != null ? ` · ${attainmentPct}%` : ''}
        </p>
      ) : (
        <p className="mt-1 text-sm text-gray-600">No goal set</p>
      )}
    </div>
  )
}

function WeeklyTrendChart({ points }: { points: ForecastResult['weeklyTrend'] }) {
  if (points.length === 0) {
    return <p className="text-sm text-gray-600">No trend data for this range.</p>
  }

  const maxVal = Math.max(...points.flatMap((p) => [p.sets, p.sits, p.sales]), 1)
  const width = 640
  const height = 180
  const pad = 24
  const innerW = width - pad * 2
  const innerH = height - pad * 2

  const xFor = (index: number) => pad + (index / Math.max(points.length - 1, 1)) * innerW
  const yFor = (value: number) => pad + innerH - (value / maxVal) * innerH

  const line = (key: 'sets' | 'sits' | 'sales', color: string) => {
    const d = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(p[key])}`)
      .join(' ')
    return <path key={key} d={d} fill="none" stroke={color} strokeWidth={2} />
  }

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-3xl" role="img" aria-label="Weekly trend">
        {[0, 0.5, 1].map((t) => {
          const y = pad + innerH * (1 - t)
          return (
            <line key={t} x1={pad} x2={width - pad} y1={y} y2={y} stroke="#e5e7eb" strokeWidth={1} />
          )
        })}
        {line('sets', '#0ea5e9')}
        {line('sits', '#8b5cf6')}
        {line('sales', '#059669')}
        {points.map((p, i) => (
          <text
            key={p.weekStart}
            x={xFor(i)}
            y={height - 4}
            textAnchor="middle"
            fontSize={10}
            fill="#2c2c2a"
          >
            {p.weekStart.slice(5)}
          </text>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs" style={{ color: '#2c2c2a' }}>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500" /> Sets</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-violet-500" /> Sits</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-600" /> Sales</span>
      </div>
    </div>
  )
}

function ScorecardTab({
  month,
  onMonthChange,
}: {
  month: string
  onMonthChange: (month: string) => void
}) {
  const [data, setData] = useState<ScorecardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/admin/goals/scorecard?month=${encodeURIComponent(month)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `Failed (${res.status})`)
        }
        return res.json()
      })
      .then((json) => {
        if (!cancelled) setData(json)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [month])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Month</span>
          <input
            type="month"
            value={month}
            onChange={(e) => onMonthChange(e.target.value)}
            className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 text-sm"
            style={{ color: '#2c2c2a' }}
          />
        </label>
      </div>

      {loading ? <p className="text-sm text-gray-600">Loading scorecard…</p> : null}
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {data.kpis.map((kpi) => (
              <KpiTile key={kpi.key} label={kpi.label} value={kpi.value} goal={kpi.goal} attainmentPct={kpi.attainmentPct} format={kpi.format} />
            ))}
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-600">Funnel</h3>
            <div className="grid gap-3 sm:grid-cols-4">
              {data.funnel.map((stage, index) => (
                <div key={stage.key} className="rounded-lg bg-gray-50 p-3">
                  <p className="text-xs font-medium text-gray-600">{stage.label}</p>
                  <p className="text-xl font-bold" style={{ color: '#2c2c2a' }}>
                    {formatInteger(stage.value)}
                  </p>
                  {index > 0 ? (
                    <p className="text-xs" style={{ color: '#2c2c2a' }}>
                      {formatPct(stage.conversionFromPrevious)} from {data.funnel[index - 1].label.toLowerCase()}
                    </p>
                  ) : null}
                  {stage.trailing90Conversion != null ? (
                    <p className="text-xs text-gray-600">
                      90d avg {formatPct(stage.trailing90Conversion)}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-600">By channel</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-600">
                    <th className="py-2 pr-4">Channel</th>
                    <th className="py-2 pr-4">Sets</th>
                    <th className="py-2 pr-4">Sales</th>
                    <th className="py-2">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.channels.map((row) => (
                    <tr key={row.channel} className="border-b border-gray-100">
                      <td className="py-2 pr-4 font-medium" style={{ color: '#2c2c2a' }}>{row.label}</td>
                      <td className="py-2 pr-4" style={{ color: '#2c2c2a' }}>{row.sets}</td>
                      <td className="py-2 pr-4" style={{ color: '#2c2c2a' }}>{row.sales}</td>
                      <td className="py-2" style={{ color: '#2c2c2a' }}>{formatCurrency(row.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-gray-600">{data.channelFootnote}</p>
          </div>

          <p className="text-sm" style={{ color: '#2c2c2a' }}>
            Data quality: {data.dataQuality.jobsMissingCostData} of {data.dataQuality.jobsInMonth} jobs this month missing cost data.
          </p>
        </>
      ) : null}
    </div>
  )
}

function priorGoalHasTargets(goal: OrgMonthlyGoal): boolean {
  return (
    goal.doors_target != null ||
    goal.sets_target != null ||
    goal.sits_target != null ||
    goal.sales_target != null ||
    goal.revenue_target != null ||
    Boolean(goal.notes?.trim())
  )
}

function GoalsTab({
  month,
  onMonthChange,
}: {
  month: string
  onMonthChange: (month: string) => void
}) {
  const readOnly = isPastGoalMonth(month)
  const [form, setForm] = useState({
    doors_target: '',
    sets_target: '',
    sits_target: '',
    sales_target: '',
    revenue_target: '',
    notes: '',
  })
  const [meta, setMeta] = useState<OrgMonthlyGoal | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [copying, setCopying] = useState(false)
  const [saving, setSaving] = useState(false)
  const monthRef = useRef(month)
  useEffect(() => {
    monthRef.current = month
  }, [month])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function loadGoal(targetMonth: string) {
      setLoading(true)
      setStatus(null)
      try {
        const res = await fetch(`/api/admin/goals?month=${encodeURIComponent(targetMonth)}`, {
          signal: controller.signal,
        })
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setStatus(json.error || 'Failed to load goal')
          setLoading(false)
          return
        }
        const goal = json.goal as OrgMonthlyGoal | null
        setMeta(goal)
        setForm({
          doors_target: formatNumericDraft(goal?.doors_target),
          sets_target: formatNumericDraft(goal?.sets_target),
          sits_target: formatNumericDraft(goal?.sits_target),
          sales_target: formatNumericDraft(goal?.sales_target),
          revenue_target: formatNumericDraft(goal?.revenue_target),
          notes: goal?.notes ?? '',
        })
        setLoading(false)
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return
        setStatus('Failed to load goal')
        setLoading(false)
      }
    }

    void loadGoal(month)
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [month])

  const save = async () => {
    const targetMonth = month
    setSaving(true)
    setStatus('Saving…')
    try {
      const res = await fetch('/api/admin/goals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: targetMonth,
          doors_target: parseDraftFloat(form.doors_target),
          sets_target: parseDraftFloat(form.sets_target),
          sits_target: parseDraftFloat(form.sits_target),
          sales_target: parseDraftFloat(form.sales_target),
          revenue_target: parseDraftFloat(form.revenue_target),
          notes: form.notes.trim() ? form.notes : null,
        }),
      })
      const json = await res.json()
      // Bail if the month picker moved on while this save was in flight — applying a stale
      // response would silently overwrite the now-visible month's data with the old month's.
      if (monthRef.current !== targetMonth) return
      if (!res.ok) {
        setStatus(json.error || 'Save failed')
        return
      }
      setMeta(json.goal)
      setStatus('Saved')
    } finally {
      setSaving(false)
    }
  }

  const copyPrevious = async () => {
    const targetMonth = month
    setCopying(true)
    setStatus(null)
    try {
      const prev = getPreviousMonthIso(targetMonth)
      const res = await fetch(`/api/admin/goals?month=${encodeURIComponent(prev)}`)
      const json = await res.json()
      if (monthRef.current !== targetMonth) return
      if (!res.ok) {
        setStatus(json.error || 'Failed to load previous month')
        return
      }
      if (!json.goal) {
        setStatus('No previous month goal to copy')
        return
      }
      const goal = json.goal as OrgMonthlyGoal
      if (!priorGoalHasTargets(goal)) {
        setStatus('Previous month has no targets set')
        return
      }
      setForm({
        doors_target: formatNumericDraft(goal.doors_target),
        sets_target: formatNumericDraft(goal.sets_target),
        sits_target: formatNumericDraft(goal.sits_target),
        sales_target: formatNumericDraft(goal.sales_target),
        revenue_target: formatNumericDraft(goal.revenue_target),
        notes: goal.notes ?? '',
      })
      setStatus(`Copied from ${prev} — click Save goals to keep`)
    } finally {
      setCopying(false)
    }
  }

  const actionsDisabled = readOnly || loading || copying || saving

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Month</span>
          <input
            type="month"
            value={month}
            onChange={(e) => onMonthChange(e.target.value)}
            disabled={copying || saving}
            className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
            style={{ color: '#2c2c2a' }}
          />
        </label>
        {!readOnly ? (
          <button
            type="button"
            onClick={() => void copyPrevious()}
            disabled={actionsDisabled}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copying ? 'Copying…' : 'Copy from previous month'}
          </button>
        ) : null}
      </div>

      {readOnly ? (
        <p className="text-sm text-amber-800 bg-amber-50 ring-1 ring-amber-200 rounded-lg px-3 py-2">
          Past months are read-only. Targets display for reference only.
        </p>
      ) : null}

      {loading ? <p className="text-sm text-gray-600">Loading…</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {([
          ['doors_target', 'Doors target'],
          ['sets_target', 'Sets target'],
          ['sits_target', 'Sits target'],
          ['sales_target', 'Sales target'],
          ['revenue_target', 'Revenue target ($)'],
        ] as const).map(([key, label]) => (
          <label key={key} className="block">
            <span className="text-sm font-medium text-gray-700">{label}</span>
            <input
              type="number"
              min={0}
              value={form[key]}
              disabled={readOnly || loading}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
              style={{ color: '#2c2c2a' }}
            />
          </label>
        ))}
      </div>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">Notes</span>
        <textarea
          rows={3}
          value={form.notes}
          disabled={readOnly || loading}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          style={{ color: '#2c2c2a' }}
        />
      </label>

      {!readOnly ? (
        <button
          type="button"
          onClick={() => void save()}
          disabled={actionsDisabled}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save goals'}
        </button>
      ) : null}

      {meta?.updated_at ? (
        <p className="text-xs text-gray-600">
          Last updated {new Date(meta.updated_at).toLocaleString('en-US', { timeZone: 'America/New_York' })}
          {meta.updater?.full_name || meta.updater?.email ? ` by ${meta.updater.full_name || meta.updater.email}` : ''}
        </p>
      ) : null}
      {status ? <p className="text-sm" style={{ color: '#2c2c2a' }}>{status}</p> : null}
    </div>
  )
}

function ForecastTab() {
  const [preset, setPreset] = useState<'mtd' | 'this_quarter' | 'last_vs_this_quarter' | 'custom'>('mtd')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [payload, setPayload] = useState<ForecastPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const query = useMemo(() => {
    if (preset === 'custom') {
      if (!start || !end) return null
      return `start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
    }
    return `preset=${preset}`
  }, [preset, start, end])

  useEffect(() => {
    if (!query) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setPayload(null)
    fetch(`/api/admin/goals/forecast?${query}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `Failed (${res.status})`)
        }
        return res.json()
      })
      .then((json: ForecastPayload) => {
        if (!cancelled) setPayload(json)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query])

  const forecast = payload?.forecast ?? null
  const compare = payload?.compare ?? null
  const deltas = payload?.deltas ?? null
  const goalNote = forecast ? describeGoalCoverage(forecast.goalCoverage) : null

  const rangeHeading = forecast
    ? compare
      ? `${formatForecastRangeLabel(forecast.rangeStart, forecast.rangeEnd)} vs ${formatForecastRangeLabel(compare.rangeStart, compare.rangeEnd)}`
      : formatForecastRangeLabel(forecast.rangeStart, forecast.rangeEnd)
    : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {([
          ['mtd', 'This month (MTD → EOM)'],
          ['this_quarter', 'This quarter'],
          ['last_vs_this_quarter', 'Last quarter vs this quarter'],
          ['custom', 'Custom range'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPreset(id)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              preset === id ? 'bg-gray-900 text-white' : 'bg-white text-gray-800 ring-1 ring-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {preset === 'custom' ? (
        <div className="flex flex-wrap gap-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Start</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">End</span>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </label>
        </div>
      ) : null}

      {loading ? <p className="text-sm text-gray-600">Loading forecast…</p> : null}
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      {forecast ? (
        <>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-600">Weekly trend</h3>
            <WeeklyTrendChart points={forecast.weeklyTrend} />
          </div>

          {rangeHeading ? (
            <p className="text-sm font-medium" style={{ color: '#2c2c2a' }}>
              {rangeHeading}
            </p>
          ) : null}

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-600">
                  <th className="px-4 py-2">Metric</th>
                  <th className="px-4 py-2">Actual so far</th>
                  <th className="px-4 py-2">Projected (end of range)</th>
                  <th className="px-4 py-2">Goal</th>
                  <th className="px-4 py-2">Gap</th>
                </tr>
              </thead>
              <tbody>
                {FORECAST_METRIC_ORDER.map((key) => {
                  const metric = forecast.metrics[key]
                  return (
                    <tr key={key} className="border-b border-gray-100">
                      <td className="px-4 py-2 font-medium" style={{ color: '#2c2c2a' }}>{FORECAST_METRIC_LABELS[key]}</td>
                      <td className="px-4 py-2" style={{ color: '#2c2c2a' }}>{formatMetricValue(key, metric.actual)}</td>
                      <td className="px-4 py-2" style={{ color: '#2c2c2a' }}>{formatMetricValue(key, metric.projectedTotal)}</td>
                      <td className="px-4 py-2" style={{ color: '#2c2c2a' }}>{metric.goal != null ? formatMetricValue(key, metric.goal) : '—'}</td>
                      <td className="px-4 py-2" style={{ color: '#2c2c2a' }}>{formatGapToGoal(key, metric.gapToGoal)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {goalNote ? (
            <p className="text-xs text-amber-800 bg-amber-50 ring-1 ring-amber-200 rounded-lg px-3 py-2">
              Goal note: {goalNote}.
            </p>
          ) : null}

          {compare && deltas ? (
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-600">
                    <th className="px-4 py-2">Metric</th>
                    <th className="px-4 py-2">This range</th>
                    <th className="px-4 py-2">Compare range</th>
                    <th className="px-4 py-2">Delta</th>
                    <th className="px-4 py-2">Delta %</th>
                  </tr>
                </thead>
                <tbody>
                  {FORECAST_METRIC_ORDER.map((key) => {
                    const compareTotal = compare.metrics[key].projectedTotal
                    const delta = deltas[key]
                    return (
                      <tr key={key} className="border-b border-gray-100">
                        <td className="px-4 py-2 font-medium" style={{ color: '#2c2c2a' }}>{FORECAST_METRIC_LABELS[key]}</td>
                        <td className="px-4 py-2" style={{ color: '#2c2c2a' }}>{formatMetricValue(key, forecast.metrics[key].projectedTotal)}</td>
                        <td className="px-4 py-2" style={{ color: '#2c2c2a' }}>{formatMetricValue(key, compareTotal)}</td>
                        <td className={`px-4 py-2 font-medium ${deltaTextClass(delta)}`}>
                          {formatSignedDelta(key, delta)}
                        </td>
                        <td className={`px-4 py-2 ${deltaTextClass(delta)}`}>
                          {formatDeltaPct(delta, compareTotal)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-600">
              Conversion rates
            </h3>
            <p className="mb-3 text-xs text-gray-600">
              Measured from closed history, each stage matched to the same opportunity rather than
              just the same day. Set→sit and sit→sale drive the projection above; door→set is shown
              for reference.
            </p>
            <ul className="space-y-1.5 text-xs" style={{ color: '#2c2c2a' }}>
              {forecast.assumptions.map((a) => (
                <li key={a.key}>
                  <span className="font-medium">{a.label}:</span> {formatAssumptionValue(a)}
                  <span className="text-gray-600">{formatAssumptionBasis(a)}</span>
                  {a.note ? <span className="text-gray-600"> — {a.note}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  )
}

export default function GoalsClient() {
  const [tab, setTab] = useState<TabId>('scorecard')
  const [scorecardMonth, setScorecardMonth] = useState(getPreviousMonthIso())
  const [goalsMonth, setGoalsMonth] = useState(getCurrentMonthIso())

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-2 border-b border-gray-200 pb-4">
        {([
          ['scorecard', 'Scorecard'],
          ['goals', 'Goals'],
          ['forecast', 'Forecast'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
              tab === id ? 'bg-gray-900 text-white' : 'bg-white text-gray-800 ring-1 ring-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'scorecard' ? (
        <ScorecardTab month={scorecardMonth} onMonthChange={setScorecardMonth} />
      ) : null}
      {tab === 'goals' ? <GoalsTab month={goalsMonth} onMonthChange={setGoalsMonth} /> : null}
      {tab === 'forecast' ? <ForecastTab /> : null}
    </div>
  )
}
