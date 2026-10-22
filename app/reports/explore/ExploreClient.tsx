'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import type { DatasetColumn } from '@/lib/reporting/catalog'
import type { ReportResult } from '@/lib/reporting/run'
import type { ReportSpec } from '@/lib/reporting/report-spec'
import type { ReportTemplate } from '@/lib/reporting/templates'

type DatasetInfo = { key: string; label: string; description: string; columns: DatasetColumn[] }
type Saved = { id: string; name: string; spec: ReportSpec; schedule: string | null; created_by: string }

const INK = '#2c2c2a'
const card: React.CSSProperties = { background: '#fff', color: INK, border: '1px solid #d3d1c7', borderRadius: 8, padding: 12 }

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

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 16, color: INK }}>
      <h1 style={{ marginTop: 0 }}>Reports</h1>
      {error && <p style={{ color: '#a32d2d' }}>{error}</p>}
      {!meta && !error && <p>Loading…</p>}
      {meta && (
        <>
          {saved.length > 0 && (
            <div style={{ ...card, marginBottom: 12 }}>
              <strong>Saved</strong>{' '}
              {saved.map((s) => (
                <button key={s.id} type="button" onClick={() => pick({ title: s.name, spec: s.spec })} style={{ marginRight: 6 }}>
                  {s.name}{s.schedule ? ' ✉' : ''}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {groups.map((g) => (
              <div key={g} style={card}>
                <strong>{g}</strong>
                {meta.templates.filter((t) => t.group === g).map((t) => (
                  <button key={t.key} type="button" onClick={() => pick(t)} title={t.blurb}
                    style={{ display: 'block', width: '100%', textAlign: 'left', margin: '4px 0', padding: '6px 8px', color: INK, background: title === t.title ? '#e6e4dc' : '#f4f3ee', border: '1px solid #d3d1c7', borderRadius: 6 }}>
                    {t.title}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {spec && ds && (
            <section style={{ ...card, marginTop: 16 }}>
              <h2 style={{ margin: '0 0 8px' }}>{title}</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
                <label>Dates{' '}
                  <select value={spec.date.preset} onChange={(e) => update({ date: { preset: e.target.value as ReportSpec['date']['preset'] } })}>
                    <option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option>
                    <option value="ytd">This year</option><option value="all">All time</option>
                  </select>
                </label>
                <label>Group by{' '}
                  <select value={spec.groupBy ?? ''} onChange={(e) => update({ groupBy: e.target.value || null, mode: 'summary' })}>
                    <option value="">Nothing (total)</option>
                    <option value="@month">Month</option><option value="@week">Week</option>
                    {ds.columns.filter((c) => c.type === 'text' || c.type === 'bool').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </label>
                <label>Show{' '}
                  <select value={spec.mode === 'rows' ? 'rows' : spec.metric.kind === 'count' ? 'count' : `${spec.metric.kind}:${'column' in spec.metric ? spec.metric.column : ''}`}
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
                {isSummary && <button type="button" onClick={() => setChart(!chart)}>{chart ? 'Show table' : 'Show chart'}</button>}
                {meta.canExport && <button type="button" onClick={download}>Download CSV</button>}
                <button type="button" onClick={save}>Save / email…</button>
              </div>
              {drill && <p>Showing rows for <strong>{drill}</strong> <button type="button" onClick={() => update({})}>Back</button></p>}
              {loading && <p>Loading…</p>}
              {result && !loading && (
                <>
                  {result.summary && <p><strong>{result.summary.label}: {fmt(result.summary.value, result.columns[1]?.type ?? 'number')}</strong></p>}
                  {result.truncated && <p style={{ color: '#7a4b00' }}>Showing the first rows only — narrow the dates or filters to see everything.</p>}
                  {isSummary && chart && !drill ? (
                    <div>
                      {result.rows.map((r) => (
                        <button key={String(r.group)} type="button" onClick={() => drillInto(String(r.group))}
                          style={{ display: 'grid', gridTemplateColumns: '180px 1fr 110px', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 0, textAlign: 'left', color: INK, padding: '2px 0' }}>
                          <span>{String(r.group)}</span>
                          <span style={{ background: '#e6e4dc', height: 14, borderRadius: 3 }}>
                            <span style={{ display: 'block', height: 14, borderRadius: 3, background: '#5f5e5a', width: `${Math.max(1, ((Number(r.value) || 0) / max) * 100)}%` }} />
                          </span>
                          <span>{fmt(r.value, result.columns[1].type)}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                        <thead><tr>{result.columns.map((c) => <th key={c.key} style={{ textAlign: 'left', borderBottom: '2px solid #5f5e5a', padding: 4 }}>{c.label}</th>)}</tr></thead>
                        <tbody>
                          {result.rows.map((r, i) => (
                            <tr key={i} onClick={isSummary && !drill ? () => drillInto(String(r.group)) : undefined} style={{ cursor: isSummary && !drill ? 'pointer' : 'default' }}>
                              {result.columns.map((c) => <td key={c.key} style={{ borderBottom: '1px solid #e6e4dc', padding: 4 }}>{fmt(r[c.key], c.type)}</td>)}
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
    </main>
  )
}
