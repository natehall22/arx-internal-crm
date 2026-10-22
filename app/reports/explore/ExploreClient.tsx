'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import type { DatasetColumn } from '@/lib/reporting/catalog'
import type { ReportResult } from '@/lib/reporting/run'
import type { ReportSpec } from '@/lib/reporting/report-spec'
import type { ReportTemplate } from '@/lib/reporting/templates'

type DatasetInfo = { key: string; label: string; description: string; columns: DatasetColumn[] }
type Saved = { id: string; name: string; spec: ReportSpec; schedule: string | null; created_by: string }


function fmt(v: unknown, type: string): string {
  if (v === null || v === undefined) return ''
  if (type === 'money') return Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  if (type === 'date') return String(v).slice(0, 10)
  if (type === 'bool') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return String(v)
}

export default function ExploreClient() {
  const [meta, setMeta] = useState<{ templates: ReportTemplate[]; datasets: DatasetInfo[]; canExport: boolean; finance: boolean } | null>(null)
  const [spec, setSpec] = useState<ReportSpec | null>(null)
  const [title, setTitle] = useState('')
  const [chart, setChart] = useState(true)
  const [result, setResult] = useState<ReportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState<Saved[]>([])
  const [drill, setDrill] = useState<string | null>(null)
  // Template groups collapse on phones once a report is open; on wider screens the picker stays open.
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)')
    const apply = () => setWide(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    void fetch('/api/reports/run').then(async (r) => {
      const j = await r.json().catch(() => ({}))
      if (!r.ok) return setError(j.error || 'Could not load reports')
      setMeta(j)
    })
    void fetch('/api/reports/saved').then(async (r) => r.ok && setSaved((await r.json()).reports))
  }, [])

  const run = useCallback(async (next: ReportSpec) => {
    setLoading(true)
    setError(null)
    const r = await fetch('/api/reports/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spec: next }) })
    const j = await r.json().catch(() => ({}))
    setLoading(false)
    if (!r.ok) return setError(j.error || 'Could not run the report')
    setResult(j.result)
  }, [])

  const pick = (t: ReportTemplate | { title: string; spec: ReportSpec }) => {
    setTitle(t.title)
    setSpec(t.spec)
    setDrill(null)
    void run(t.spec)
  }

  const update = (patch: Partial<ReportSpec>) => {
    if (!spec) return
    const next = { ...spec, ...patch }
    setSpec(next)
    setDrill(null)
    void run(next)
  }

  const ds = useMemo(() => meta?.datasets.find((d) => d.key === spec?.dataset), [meta, spec])

  const drillInto = (group: string) => {
    if (!spec || !spec.groupBy) return
    setDrill(group)
    const isTime = spec.groupBy.startsWith('@')
    const filters = isTime
      ? spec.filters
      : [...spec.filters, { column: spec.groupBy, op: 'eq' as const, value: group === '(none)' ? '' : group === 'Yes' ? 'true' : group === 'No' ? 'false' : group }]
    void run({ ...spec, mode: 'rows', filters, groupBy: null, sortBy: null, limit: 200 })
  }

  const download = async () => {
    if (!spec) return
    const r = await fetch('/api/reports/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spec, format: 'csv' }) })
    if (!r.ok) return setError((await r.json().catch(() => ({}))).error || 'Could not export')
    const url = URL.createObjectURL(await r.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = `${title || 'report'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const save = async () => {
    if (!spec) return
    const name = window.prompt('Name this report', title)
    if (!name) return
    const email = window.prompt('Email it every morning to (comma separated, leave empty for no email)', '')
    const recipients = (email || '').split(',').map((e) => e.trim()).filter(Boolean)
    const onDashboard = window.confirm('Also show this report as a tile on your dashboard?')
    const r = await fetch('/api/reports/saved', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, spec, schedule: recipients.length ? 'daily' : null, schedule_recipients: recipients, dashboard_widget: onDashboard }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return setError(j.error || 'Could not save')
    const l = await fetch('/api/reports/saved')
    if (l.ok) setSaved((await l.json()).reports)
  }

  const max = Math.max(1, ...(result?.rows ?? []).map((r) => Number(r.value) || 0))
  const isSummary = spec?.mode === 'summary'
  const groups = Array.from(new Set((meta?.templates ?? []).map((t) => t.group)))

  const ctl = 'block w-full min-h-[44px] rounded-lg border border-[#8a877d] bg-white px-3 py-2 text-base text-[#2c2c2a]'
  const btn = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#5f5e5a] bg-white px-4 py-2 text-sm font-semibold text-[#2c2c2a]'

  return (
    <main className="mx-auto max-w-[1000px] p-4 pb-28 sm:pb-4 text-[#2c2c2a]">
      <h1 className="mt-0 text-2xl font-bold">Reports</h1>
      {error && <p className="text-[#a32d2d]">{error}</p>}
      {!meta && !error && <p>Loading…</p>}
      {meta && (
        <>
          {saved.length > 0 && (
            <div className="mb-3 rounded-lg border border-[#d3d1c7] bg-white p-3">
              <strong className="text-sm">Saved</strong>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {saved.map((sv) => (
                  <button key={sv.id} type="button" className={btn} onClick={() => pick({ title: sv.name, spec: sv.spec })}>
                    {sv.name}{sv.schedule ? ' ✉' : ''}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => (
              <details key={g} className="rounded-lg border border-[#d3d1c7] bg-white p-3" open={wide || !spec}>
                <summary className="flex min-h-[44px] cursor-pointer items-center font-semibold">{g}</summary>
                <div className="mt-1 flex flex-col gap-2">
                  {meta.templates.filter((t) => t.group === g).map((t) => (
                    <button key={t.key} type="button" onClick={() => pick(t)} title={t.blurb}
                      className={`flex min-h-[44px] w-full items-center rounded-md border border-[#d3d1c7] px-3 py-2 text-left text-sm ${title === t.title ? 'bg-[#e6e4dc] font-semibold' : 'bg-[#f4f3ee]'}`}>
                      {t.title}
                    </button>
                  ))}
                </div>
              </details>
            ))}
          </div>

          {spec && ds && (
            <section className="mt-4 rounded-lg border border-[#d3d1c7] bg-white p-3 sm:p-4">
              <h2 className="mb-3 mt-0 text-lg font-bold">{title}</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="text-sm font-medium">Dates
                  <select className={ctl} value={spec.date.preset} onChange={(e) => update({ date: { preset: e.target.value as ReportSpec['date']['preset'] } })}>
                    <option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option>
                    <option value="ytd">This year</option><option value="all">All time</option>
                  </select>
                </label>
                <label className="text-sm font-medium">Group by
                  <select className={ctl} value={spec.groupBy ?? ''} onChange={(e) => update({ groupBy: e.target.value || null, mode: 'summary' })}>
                    <option value="">Nothing (total)</option>
                    <option value="@month">Month</option><option value="@week">Week</option>
                    {ds.columns.filter((c) => c.type === 'text' || c.type === 'bool').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </label>
                <label className="text-sm font-medium">Show
                  <select className={ctl} value={spec.mode === 'rows' ? 'rows' : spec.metric.kind === 'count' ? 'count' : `${spec.metric.kind}:${'column' in spec.metric ? spec.metric.column : ''}`}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v === 'rows') return update({ mode: 'rows', groupBy: null })
                      if (v === 'count') return update({ mode: 'summary', metric: { kind: 'count' } })
                      const [kind, column] = v.split(':')
                      update({ mode: 'summary', metric: { kind: kind as 'sum' | 'avg' | 'rate', column } as ReportSpec['metric'] })
                    }}>
                    <option value="count">How many</option>
                    {ds.columns.filter((c) => c.type === 'money' || c.type === 'number').map((c) => <option key={c.key} value={`sum:${c.key}`}>Total {c.label}</option>)}
                    {ds.columns.filter((c) => c.type === 'money' || c.type === 'number').map((c) => <option key={`a${c.key}`} value={`avg:${c.key}`}>Average {c.label}</option>)}
                    {ds.columns.filter((c) => c.type === 'bool').map((c) => <option key={`r${c.key}`} value={`rate:${c.key}`}>% {c.label}</option>)}
                    <option value="rows">The list itself</option>
                  </select>
                </label>
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {isSummary && <button type="button" className={btn} onClick={() => setChart(!chart)}>{chart ? 'Show table' : 'Show chart'}</button>}
                {meta.canExport && <button type="button" className={btn} onClick={download}>Download CSV</button>}
              </div>
              {drill && (
                <p className="mt-3 text-sm">Showing rows for <strong>{drill}</strong>{' '}
                  <button type="button" className={btn} onClick={() => update({})}>Back</button>
                </p>
              )}
              {loading && <p>Loading…</p>}
              {result && !loading && (
                <>
                  {result.summary && <p className="mt-3 font-semibold">{result.summary.label}: {fmt(result.summary.value, result.columns[1]?.type ?? 'number')}</p>}
                  {result.truncated && <p className="text-sm text-[#7a4b00]">Showing the first rows only — narrow the dates or filters to see everything.</p>}
                  {isSummary && chart && !drill ? (
                    <div className="mt-2">
                      {result.rows.map((r) => (
                        <button key={String(r.group)} type="button" onClick={() => drillInto(String(r.group))}
                          className="grid min-h-[44px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-0 bg-transparent py-1 text-left text-[#2c2c2a]">
                          <span className="truncate text-sm">{String(r.group)}</span>
                          <span className="text-sm font-semibold tabular-nums">{fmt(r.value, result.columns[1].type)}</span>
                          <span className="col-span-2 h-2.5 rounded bg-[#e6e4dc]">
                            <span className="block h-2.5 rounded bg-[#5f5e5a]" style={{ width: `${Math.max(1, ((Number(r.value) || 0) / max) * 100)}%` }} />
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 max-h-[70vh] overflow-auto rounded border border-[#e6e4dc]">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr>
                            {result.columns.map((c, i) => (
                              <th key={c.key} className={`sticky top-0 whitespace-nowrap border-b-2 border-[#5f5e5a] bg-white p-2 text-left ${i === 0 ? 'left-0 z-10' : ''}`}>{c.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {result.rows.map((r, i) => (
                            <tr key={i} onClick={isSummary && !drill ? () => drillInto(String(r.group)) : undefined} className={isSummary && !drill ? 'cursor-pointer' : ''}>
                              {result.columns.map((c, ci) => (
                                <td key={c.key} className={`border-b border-[#e6e4dc] p-2 ${ci === 0 ? 'sticky left-0 bg-white font-medium' : 'whitespace-nowrap'}`}>{fmt(r[c.key], c.type)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
      {spec && ds && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#d3d1c7] bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:mt-4 sm:border-0 sm:p-0">
          <button type="button" onClick={save} className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[#2b0a3d] px-4 py-2 text-sm font-semibold text-white sm:w-auto">
            Save / email…
          </button>
        </div>
      )}
    </main>
  )
}
