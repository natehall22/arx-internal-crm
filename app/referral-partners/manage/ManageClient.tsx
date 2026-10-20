'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { csvToPartnerRows } from '@/lib/referral-partners-csv'

type Rep = { id: string; full_name: string | null }
type Report = 'partner' | 'rep' | 'cooling'
type ReportRow = Record<string, string | number | null>
type PartnerType = { id: string; name: string; is_active: boolean; inactivity_days: number }

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

const REPORTS: Array<{ id: Report; label: string }> = [
  { id: 'partner', label: 'By partner' },
  { id: 'rep', label: 'By rep' },
  { id: 'cooling', label: 'Going cold' },
]

export default function ManageClient({ reps }: { reps: Rep[] }) {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-3 py-4 sm:px-6">
      <div>
        <Link href="/referral-partners" className="text-sm font-semibold text-indigo-700">
          ← Referral Partners
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-[#2c2c2a]">Manage Referral Partners</h1>
      </div>
      <Reports />
      <ImportCsv reps={reps} />
      <Types />
    </div>
  )
}

function Reports() {
  const [kind, setKind] = useState<Report>('partner')
  const [rows, setRows] = useState<ReportRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setRows(null)
    setError(null)
    const controller = new AbortController()
    fetch(`/api/referral-partners/reports?kind=${kind}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error()
        setRows((await res.json()).rows)
      })
      .catch((e) => {
        if (e?.name !== 'AbortError') setError('Could not load this report.')
      })
    return () => controller.abort()
  }, [kind])

  const columns: Record<Report, Array<[string, string]>> = {
    partner: [['name', 'Partner'], ['assigned_to', 'Assigned To'], ['referred', 'Referred'], ['jobs_sold', 'Jobs sold'], ['revenue', 'Revenue']],
    rep: [['rep', 'Rep'], ['jobs_sold', 'Jobs sold'], ['revenue', 'Revenue']],
    cooling: [['name', 'Partner'], ['assigned_to', 'Assigned To'], ['days_until_open', 'Days until it opens']],
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-base font-semibold text-[#2c2c2a]">Reports</h2>
        {REPORTS.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setKind(r.id)}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${kind === r.id ? 'bg-gray-800 text-white' : 'border border-gray-300 text-[#2c2c2a]'}`}
          >
            {r.label}
          </button>
        ))}
      </div>
      {kind === 'rep' && (
        <p className="mb-2 text-xs text-gray-700">
          Counted from the partner owner recorded on each sold job, so a later reassignment never moves past jobs.
        </p>
      )}
      {error ? (
        <p className="text-sm font-medium text-red-800">{error}</p>
      ) : !rows ? (
        <div className="h-16 animate-pulse rounded-lg bg-gray-100" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-700">Nothing to show yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-[#2c2c2a]">
            <thead>
              <tr className="border-b border-gray-200">
                {columns[kind].map(([, label]) => (
                  <th key={label} className="py-2 pr-3 font-semibold">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-gray-100">
                  {columns[kind].map(([key]) => (
                    <td key={key} className="py-2 pr-3">
                      {key === 'revenue' ? money.format(Number(row[key] ?? 0)) : (row[key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ImportCsv({ reps }: { reps: Rep[] }) {
  const [userId, setUserId] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ created: number; skipped: Array<{ row: number; name: string; reason: string }> } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rows = text.trim() ? csvToPartnerRows(text) : []

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold text-[#2c2c2a]">Import contacts</h2>
      <p className="mb-2 text-sm text-gray-700">
        CSV with columns name, phone, company, email, type, notes. Every row is Assigned To the rep you pick.
      </p>
      <select value={userId} onChange={(e) => setUserId(e.target.value)} className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-[#2c2c2a]">
        <option value="">Assigned To…</option>
        {reps.map((r) => (
          <option key={r.id} value={r.id}>{r.full_name ?? r.id}</option>
        ))}
      </select>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (file) setText(await file.text())
        }}
        className="mb-2 block w-full text-sm text-[#2c2c2a]"
      />
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="…or paste CSV here" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-[#2c2c2a]" />
      <button
        type="button"
        disabled={busy || !userId || rows.length === 0}
        onClick={async () => {
          setBusy(true)
          setError(null)
          setResult(null)
          try {
            const res = await fetch('/api/referral-partners/import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ user_id: userId, rows }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || 'Import failed')
            setResult(json)
            setText('')
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Import failed')
          } finally {
            setBusy(false)
          }
        }}
        className="mt-2 rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? 'Importing…' : `Import ${rows.length || ''} rows`}
      </button>
      {error && <p className="mt-2 text-sm font-medium text-red-800">{error}</p>}
      {result && (
        <div className="mt-2 text-sm text-[#2c2c2a]">
          <p className="font-semibold">Imported {result.created}.</p>
          {result.skipped.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {result.skipped.map((s) => (
                <li key={s.row}>Row {s.row}{s.name ? ` (${s.name})` : ''}: {s.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

function Types() {
  const [types, setTypes] = useState<PartnerType[]>([])
  const [name, setName] = useState('')
  const [days, setDays] = useState('30')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/referral-partner-types')
    if (res.ok) setTypes((await res.json()).types)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  async function save(body: Record<string, unknown>) {
    setError(null)
    const res = await fetch('/api/referral-partner-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return setError(json.error || 'Could not save')
    await load()
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="mb-2 text-base font-semibold text-[#2c2c2a]">Partner types</h2>
      <ul className="divide-y divide-gray-100">
        {types.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm text-[#2c2c2a]">
            <span className={t.is_active ? 'font-medium' : 'text-gray-500 line-through'}>{t.name}</span>
            <span className="flex items-center gap-2">
              <label className="text-xs text-gray-700">Opens after</label>
              <input
                defaultValue={t.inactivity_days}
                type="number"
                min={8}
                onBlur={(e) => {
                  const next = Number(e.target.value)
                  if (next !== t.inactivity_days) void save({ id: t.id, name: t.name, inactivity_days: next })
                }}
                className="w-16 rounded border border-gray-300 px-1 py-1 text-[#2c2c2a]"
              />
              <span className="text-xs text-gray-700">days</span>
              <button
                type="button"
                onClick={() => save({ id: t.id, name: t.name, inactivity_days: t.inactivity_days, is_active: !t.is_active })}
                className="text-xs font-semibold text-indigo-700"
              >
                {t.is_active ? 'Hide' : 'Show'}
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New type" className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-[#2c2c2a]" />
        <input value={days} onChange={(e) => setDays(e.target.value)} type="number" min={8} className="w-20 rounded-lg border border-gray-300 px-2 py-2 text-[#2c2c2a]" />
        <button
          type="button"
          disabled={!name.trim()}
          onClick={async () => {
            await save({ name, inactivity_days: Number(days) })
            setName('')
          }}
          className="rounded-lg bg-gray-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {error && <p className="mt-2 text-sm font-medium text-red-800">{error}</p>}
    </section>
  )
}
