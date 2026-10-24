'use client'

import { useCallback, useEffect, useState } from 'react'
import Nav from '@/components/Nav'
import Link from 'next/link'
import type { ReportResult } from '@/lib/reporting/run'
import type { ReportSpec, DatePreset } from '@/lib/reporting/report-spec'
import type { ReportTemplate } from '@/lib/reporting/templates'

/**
 * Reports home. Every number comes from the reporting layer (/api/reports/run -> rpt_* views), which
 * applies the company fence and the viewer's scope on the server. The old Overview ran ~25 queries
 * from the browser, which has no database session here and so showed zeros.
 */
type Meta = { templates: ReportTemplate[]; canExport: boolean; finance: boolean; scope: string; role: string | null }

const INK = '#2c2c2a'
const card: React.CSSProperties = { background: '#fff', color: INK, border: '1px solid #d3d1c7', borderRadius: 12, padding: 16 }

const KPIS: { label: string; money?: boolean; spec: Omit<ReportSpec, 'date'> }[] = [
  { label: 'Sales signed ($)', money: true, spec: { dataset: 'sales', mode: 'summary', metric: { kind: 'sum', column: 'amount' }, filters: [] } },
  { label: 'Inspections set', spec: { dataset: 'inspection_sets', mode: 'summary', metric: { kind: 'count' }, filters: [] } },
  { label: 'Sits', spec: { dataset: 'sits', mode: 'summary', metric: { kind: 'count' }, filters: [] } },
  { label: 'Doors knocked', spec: { dataset: 'canvass_doors', mode: 'summary', metric: { kind: 'count' }, filters: [] } },
  { label: 'New leads', spec: { dataset: 'leads', mode: 'summary', metric: { kind: 'count' }, filters: [] } },
]
const TILES = ['sales-by-closer', 'sold-rate-by-closer', 'doors-by-rep', 'appointments-by-type', 'leads-by-source', 'sales-by-month']

async function run(spec: ReportSpec): Promise<ReportResult | null> {
  const r = await fetch('/api/reports/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spec }) })
  if (!r.ok) return null
  return (await r.json()).result
}

function Tile({ template, preset }: { template: ReportTemplate; preset: DatePreset }) {
  const [result, setResult] = useState<ReportResult | null | undefined>(undefined)
  useEffect(() => {
    setResult(undefined)
    void run({ ...template.spec, date: { preset } }).then(setResult)
  }, [template, preset])
  const rows = (result?.rows ?? []).slice(0, 6)
  const max = Math.max(1, ...rows.map((r) => Number(r.value) || 0))
  const money = result?.columns[1]?.type === 'money'
  return (
    <Link href="/reports/explore" style={{ ...card, display: 'block', textDecoration: 'none' }}>
      <strong>{template.title}</strong>
      {result === undefined && <p>Loading…</p>}
      {result === null && <p>Not available for your role.</p>}
      {result && rows.length === 0 && <p>No data for this period.</p>}
      {rows.map((r) => (
        <div key={String(r.group)} style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8, margin: '6px 0' }}>
          <div>
            <div style={{ fontSize: 13 }}>{String(r.group)}</div>
            <div style={{ background: '#e6e4dc', height: 8, borderRadius: 3 }}>
              <div style={{ background: '#5f5e5a', height: 8, borderRadius: 3, width: `${Math.max(2, ((Number(r.value) || 0) / max) * 100)}%` }} />
            </div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 13 }}>
            {money ? Number(r.value).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : Number(r.value).toLocaleString()}
            {template.spec.metric.kind === 'rate' ? '%' : ''}
          </div>
        </div>
      ))}
    </Link>
  )
}

function Kpi({ label, spec, preset }: { label: string; spec: Omit<ReportSpec, 'date'>; preset: DatePreset }) {
  const [value, setValue] = useState<number | null | undefined>(undefined)
  useEffect(() => {
    setValue(undefined)
    void run({ ...spec, date: { preset } }).then((r) => setValue(r ? r.summary?.value ?? r.rows.reduce((s, x) => s + (Number(x.value) || 0), 0) : null))
  }, [spec, preset])
  return (
    <div style={card}>
      <p style={{ margin: 0, fontSize: 13 }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: 28, fontWeight: 700 }}>
        {value === undefined ? '…' : value === null ? '—' : label.includes('$') ? value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : value.toLocaleString()}
      </p>
    </div>
  )
}

export default function ReportsPage() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'forecast'>('overview')
  const [preset, setPreset] = useState<DatePreset>('30d')

  const load = useCallback(async () => {
    const res = await fetch('/api/reports/run')
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return setError(json.error || 'Could not load reports')
    setMeta(json)
  }, [])
  useEffect(() => { void load() }, [load])

  const tiles = (meta?.templates ?? []).filter((t) => TILES.includes(t.key)).sort((a, b) => TILES.indexOf(a.key) - TILES.indexOf(b.key))
  const have = new Set((meta?.templates ?? []).map((t) => t.spec.dataset))

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" style={{ color: INK }}>
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold">Reports</h1>
            <p className="mt-1">Performance at a glance. Click any card for the full report, filters, CSV and email.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {activeTab === 'overview' && (
              <select value={preset} onChange={(e) => setPreset(e.target.value as DatePreset)} className="min-h-[44px] rounded-lg border border-[#8a877d] bg-white px-3 py-2 text-base">
                <option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option>
                <option value="ytd">This year</option><option value="all">All time</option>
              </select>
            )}
            <Link href="/reports/explore" className="inline-flex min-h-[44px] items-center rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white">All reports</Link>
          </div>
        </div>

        <div className="flex gap-1 mb-6 border-b overflow-x-auto">
          {(meta?.finance ? (['overview', 'forecast'] as const) : (['overview'] as const)).map((t) => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`min-h-[44px] px-4 py-3 font-medium text-sm border-b-2 -mb-px ${activeTab === t ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-700 hover:text-gray-900'}`}>
              {t === 'overview' ? 'Overview' : 'Forecast'}
            </button>
          ))}
          <Link href="/reports/coaching" className="inline-flex min-h-[44px] items-center px-4 py-3 font-medium text-sm border-b-2 border-transparent text-gray-700 hover:text-gray-900">
            Team Coaching
          </Link>
        </div>

        {error && <p style={{ color: '#a32d2d' }}>{error}</p>}
        {!meta && !error && <p>Loading…</p>}
        {meta?.finance && activeTab === 'forecast' && <ForecastTab currentUser={{ role: meta.role }} />}
        {meta && activeTab === 'overview' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
              {KPIS.filter((k) => have.has(k.spec.dataset) && (meta.finance || !k.money || meta.scope === 'own')).map((k) => <Kpi key={k.label} label={k.label} spec={k.spec} preset={preset} />)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
              {tiles.map((t) => <Tile key={t.key} template={t} preset={preset} />)}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

type ForecastPeriod = 'month' | 'quarter' | 'year'

type ForecastData = {
  period: string
  periodLabel: string
  periodGoal: number | null
  totalForecast: number
  totalLocked: number
  retailTotal: number
  insuranceTotal: number
  retailPipeline: { stage: string; count: number; expectedRevenue: number; probability: number; locked?: boolean }[]
  insurancePipeline: { stage: string; stageKey: string; count: number; expectedRevenue: number; lockedRevenue: number; probability: number }[]
  avgDealValue: number
  avgDealBasis: string
}

function ForecastTab({ currentUser }: { currentUser: any }) {
  const [period, setPeriod] = useState<ForecastPeriod>('quarter')
  const [data, setData] = useState<ForecastData | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingGoal, setEditingGoal] = useState(false)
  const [goalInput, setGoalInput] = useState('')
  const [savingGoal, setSavingGoal] = useState(false)

  const isAdmin = ['admin', 'sales_manager', 'regional_manager'].includes(currentUser?.role || '')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/reports/forecast?period=${period}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [period])

  async function saveGoal() {
    if (!goalInput) return
    setSavingGoal(true)
    try {
      const res = await fetch('/api/reports/forecast', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, goal: Number(goalInput) }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error('Forecast goal save failed:', payload?.error || res.status)
        return
      }
      setEditingGoal(false)
      setData(d => d ? { ...d, periodGoal: Number(goalInput) } : d)
    } finally {
      setSavingGoal(false)
    }
  }

  const goal = data?.periodGoal || null
  const forecast = data?.totalForecast || 0
  const pct = goal && goal > 0 ? Math.min(Math.round((forecast / goal) * 100), 100) : null
  const gap = goal ? goal - forecast : null

  return (
    <div>
      {/* Period + Goal header */}
      <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-lg font-semibold text-gray-900">
                {loading ? '…' : data?.periodLabel} Forecast
              </h2>
              <select
                value={period}
                onChange={e => setPeriod(e.target.value as ForecastPeriod)}
                className="px-2 py-1 border border-gray-300 rounded-lg text-sm bg-white"
              >
                <option value="month">This month</option>
                <option value="quarter">This quarter</option>
                <option value="year">This year</option>
              </select>
            </div>
            {data?.avgDealBasis && (
              <p className="text-xs text-gray-400">
                Avg deal: ${data.avgDealValue.toLocaleString()} · {data.avgDealBasis}
              </p>
            )}
          </div>

          {/* Goal */}
          <div className="flex items-center gap-2">
            {editingGoal ? (
              <>
                <span className="text-sm text-gray-500">Goal $</span>
                <input
                  type="number"
                  value={goalInput}
                  onChange={e => setGoalInput(e.target.value)}
                  className="w-32 px-2 py-1 border border-gray-300 rounded-lg text-sm"
                  placeholder="e.g. 400000"
                  autoFocus
                />
                <button onClick={saveGoal} disabled={savingGoal} className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-sm font-medium">
                  {savingGoal ? '…' : 'Save'}
                </button>
                <button onClick={() => setEditingGoal(false)} className="px-2 py-1 text-sm text-gray-500">Cancel</button>
              </>
            ) : (
              <>
                <span className="text-sm text-gray-600">
                  Goal: {goal ? `$${goal.toLocaleString()}` : <span className="text-gray-400">Not set</span>}
                </span>
                {isAdmin && (
                  <button
                    onClick={() => { setGoalInput(goal ? String(goal) : ''); setEditingGoal(true) }}
                    className="text-xs text-indigo-600 hover:text-indigo-800"
                  >
                    {goal ? 'Edit' : '+ Set goal'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Big number + progress */}
        {loading ? (
          <div className="h-20 animate-pulse bg-gray-100 rounded-lg" />
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-6 mb-4">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Total forecast</p>
                <p className="text-3xl font-bold text-gray-900">${forecast.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Locked (confirmed)</p>
                <p className="text-xl font-semibold text-green-600">${(data?.totalLocked || 0).toLocaleString()}</p>
              </div>
              {gap !== null && gap > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Gap to goal</p>
                  <p className="text-xl font-semibold text-red-500">${gap.toLocaleString()}</p>
                </div>
              )}
            </div>

            {pct !== null && (
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>{pct}% of goal</span>
                  <span>${forecast.toLocaleString()} of ${goal!.toLocaleString()}</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-3">
                  <div
                    className={`h-3 rounded-full transition-all ${pct >= 90 ? 'bg-green-500' : pct >= 60 ? 'bg-indigo-500' : 'bg-amber-400'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Two-column pipeline breakdown */}
      {!loading && data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Retail */}
          <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 text-sm">Retail Pipeline</h3>
              <span className="text-sm font-bold text-indigo-600">${data.retailTotal.toLocaleString()}</span>
            </div>
            <div className="space-y-2">
              {data.retailPipeline.map((row) => (
                <div key={row.stage} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    {row.locked && <span className="text-green-500 text-xs font-bold">✓</span>}
                    <span className="text-sm text-gray-700 truncate">{row.stage}</span>
                    <span className="text-xs text-gray-400 shrink-0">({row.count})</span>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-sm font-semibold text-gray-900">${Math.round(row.expectedRevenue).toLocaleString()}</p>
                    <p className="text-xs text-gray-400">{row.probability}%</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Insurance */}
          <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 text-sm">Insurance Pipeline</h3>
              <span className="text-sm font-bold text-amber-600">${data.insuranceTotal.toLocaleString()}</span>
            </div>
            {data.insurancePipeline.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No active insurance jobs.<br />Mark jobs as Insurance on the Ops board.</p>
            ) : (
              <div className="space-y-2">
                {data.insurancePipeline.map((row) => (
                  <div key={row.stageKey} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {row.lockedRevenue > 0 && <span className="text-green-500 text-xs font-bold">✓</span>}
                      <span className="text-sm text-gray-700 truncate">{row.stage}</span>
                      <span className="text-xs text-gray-400 shrink-0">({row.count})</span>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-sm font-semibold text-gray-900">${Math.round(row.expectedRevenue).toLocaleString()}</p>
                      <p className="text-xs text-gray-400">{row.probability}%</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
// ─────────────────────────────────────────────────────────────────────────────
