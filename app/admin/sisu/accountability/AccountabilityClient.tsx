'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

type AccountabilityRow = {
  user_id: string
  full_name: string | null
  role: string | null
  doors_knocked: number
  inspections_set: number
  is_enrolled_444: boolean
  week_in_444: 1 | 2 | null
  week1_qualified: boolean
  week2_qualified: boolean
}

type SortKey = 'full_name' | 'role' | 'doors_knocked' | 'inspections_set' | 'is_enrolled_444'
type SortDirection = 'asc' | 'desc'

type GateTone = {
  label: string
  className: string
  barClassName: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAccountabilityRow(value: unknown): value is AccountabilityRow {
  return (
    isRecord(value) &&
    typeof value.user_id === 'string' &&
    (typeof value.full_name === 'string' || value.full_name === null) &&
    (typeof value.role === 'string' || value.role === null) &&
    typeof value.doors_knocked === 'number' &&
    typeof value.inspections_set === 'number' &&
    typeof value.is_enrolled_444 === 'boolean' &&
    (value.week_in_444 === 1 || value.week_in_444 === 2 || value.week_in_444 === null) &&
    typeof value.week1_qualified === 'boolean' &&
    typeof value.week2_qualified === 'boolean'
  )
}

function displayRole(role: string | null): string {
  if (!role) return 'Unassigned'
  return role.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function getDoorTone(value: number): GateTone {
  if (value >= 400) {
    return {
      label: 'On track',
      className: 'text-emerald-200',
      barClassName: 'bg-emerald-400',
    }
  }

  if (value >= 200) {
    return {
      label: 'Building',
      className: 'text-amber-200',
      barClassName: 'bg-amber-400',
    }
  }

  return {
    label: 'Behind',
    className: 'text-red-200',
    barClassName: 'bg-red-400',
  }
}

function getInspectionTone(value: number): GateTone {
  if (value >= 4) {
    return {
      label: 'Hit',
      className: 'text-emerald-200',
      barClassName: 'bg-emerald-400',
    }
  }

  if (value >= 2) {
    return {
      label: 'Close',
      className: 'text-amber-200',
      barClassName: 'bg-amber-400',
    }
  }

  return {
    label: 'Behind',
    className: 'text-red-200',
    barClassName: 'bg-red-400',
  }
}

function getProgramStatus(row: AccountabilityRow): string {
  if (!row.is_enrolled_444) return 'Not enrolled'
  if (row.week1_qualified && row.week2_qualified) return 'Complete'
  if (row.week_in_444 === 1) return row.week1_qualified ? 'Week 1 ✓' : 'Week 1 In Progress'
  if (row.week_in_444 === 2) return row.week2_qualified ? 'Week 2 ✓' : 'Week 2 In Progress'
  return row.week1_qualified || row.week2_qualified ? 'Complete' : 'Not enrolled'
}

function compareRows(a: AccountabilityRow, b: AccountabilityRow, key: SortKey): number {
  if (key === 'doors_knocked' || key === 'inspections_set') {
    return a[key] - b[key]
  }

  if (key === 'is_enrolled_444') {
    return Number(a.is_enrolled_444) - Number(b.is_enrolled_444)
  }

  const left = key === 'role' ? displayRole(a.role) : a.full_name ?? ''
  const right = key === 'role' ? displayRole(b.role) : b.full_name ?? ''
  return left.localeCompare(right)
}

function GateBar({
  value,
  target,
  tone,
}: {
  value: number
  target: number
  tone: GateTone
}) {
  const width = Math.min(100, Math.round((value / target) * 100))

  return (
    <div className="min-w-[150px]">
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className={`font-semibold ${tone.className}`}>{value}/{target}</span>
        <span className={tone.className}>{tone.label}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full transition-all ${tone.barClassName}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  label: string
  sortKey: SortKey
  activeKey: SortKey
  direction: SortDirection
  onSort: (key: SortKey) => void
}) {
  const active = activeKey === sortKey

  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className="inline-flex items-center gap-1 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 transition hover:text-slate-100"
    >
      <span>{label}</span>
      {active && <span className="text-indigo-300">{direction === 'asc' ? '↑' : '↓'}</span>}
    </button>
  )
}

export default function AccountabilityClient() {
  const [rows, setRows] = useState<AccountabilityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('inspections_set')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const loadRows = useCallback(async (showLoading: boolean) => {
    if (showLoading) setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/sisu/accountability')
      if (!response.ok) throw new Error('Unable to load accountability data')
      const payload: unknown = await response.json()

      if (!isRecord(payload) || !Array.isArray(payload.accountability)) {
        throw new Error('Unexpected accountability response')
      }

      setRows(payload.accountability.filter(isAccountabilityRow))
    } catch {
      setError('Accountability data unavailable')
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRows(true)
    const intervalId = window.setInterval(() => {
      void loadRows(false)
    }, 5 * 60 * 1000)

    return () => window.clearInterval(intervalId)
  }, [loadRows])

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const result = compareRows(a, b, sortKey)
      return sortDirection === 'asc' ? result : -result
    })
  }, [rows, sortDirection, sortKey])

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }

    setSortKey(key)
    setSortDirection(key === 'full_name' || key === 'role' ? 'asc' : 'desc')
  }

  return (
    <div className="space-y-6 text-slate-100">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-indigo-300">Sisu Admin</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">Manager Accountability</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Current-week setter activity, door gates, inspection gates, and 444 enrollment status.
          </p>
        </div>
        <Link
          href="/admin/sisu/444"
          className="inline-flex items-center justify-center rounded-lg border border-indigo-400/40 px-4 py-2 text-sm font-semibold text-indigo-100 transition hover:border-indigo-300 hover:bg-indigo-500/10"
        >
          Manage 444
        </Link>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70 shadow-2xl shadow-black/20">
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full divide-y divide-slate-800">
            <thead className="bg-slate-950/70">
              <tr>
                <th className="px-4 py-3 text-left">
                  <SortHeader label="Rep" sortKey="full_name" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 text-left">
                  <SortHeader label="Role" sortKey="role" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 text-left">
                  <SortHeader label="Doors This Week" sortKey="doors_knocked" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 text-left">
                  <SortHeader label="Inspections Set" sortKey="inspections_set" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Door Gate</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Insp Gate</th>
                <th className="px-4 py-3 text-left">
                  <SortHeader label="444 Status" sortKey="is_enrolled_444" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? (
                [0, 1, 2, 3].map((item) => (
                  <tr key={item}>
                    <td colSpan={8} className="px-4 py-4">
                      <div className="h-12 animate-pulse rounded-lg bg-slate-800/70" />
                    </td>
                  </tr>
                ))
              ) : sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">
                    No setter activity to show yet.
                  </td>
                </tr>
              ) : (
                sortedRows.map((row) => {
                  const doorTone = getDoorTone(row.doors_knocked)
                  const inspectionTone = getInspectionTone(row.inspections_set)
                  const status = getProgramStatus(row)

                  return (
                    <tr key={row.user_id} className="align-middle transition hover:bg-slate-800/35">
                      <td className="px-4 py-4 text-sm font-semibold text-white">
                        {row.full_name ?? 'Unnamed rep'}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-300">{displayRole(row.role)}</td>
                      <td className="px-4 py-4 text-sm font-semibold text-white">{row.doors_knocked}</td>
                      <td className="px-4 py-4 text-sm font-semibold text-white">{row.inspections_set}</td>
                      <td className="px-4 py-4">
                        <GateBar value={row.doors_knocked} target={400} tone={doorTone} />
                      </td>
                      <td className="px-4 py-4">
                        <GateBar value={row.inspections_set} target={4} tone={inspectionTone} />
                      </td>
                      <td className="px-4 py-4">
                        <span className="inline-flex rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs font-semibold text-slate-200">
                          {status}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <Link
                          href="/admin/sisu/444"
                          className="inline-flex rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-indigo-400/60 hover:text-indigo-100"
                        >
                          Enroll in 444
                        </Link>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
