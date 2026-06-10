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
  // goal fields — present when goals have been set for this rep
  doors_goal: number | null
  inspections_goal: number | null
  sales_goal: number | null
  doors_pct: number | null
  inspections_pct: number | null
  program_444_pct: number | null
  on_pace_doors: boolean | null
  on_pace_inspections: boolean | null
}

type TeamSummary = {
  total_reps: number
  on_pace_doors: number
  on_pace_inspections: number
  reps_with_door_goal: number
  reps_with_insp_goal: number
  enrolled_444: number
  completed_444: number
  needs_attention: number
  close_to_goal: number
}

type SortKey = 'full_name' | 'role' | 'doors_knocked' | 'inspections_set' | 'is_enrolled_444' | 'doors_pct' | 'inspections_pct'
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
    // goal fields are optional — don't require them in the validator
  )
}

function isTeamSummary(value: unknown): value is TeamSummary {
  return (
    isRecord(value) &&
    typeof value.total_reps === 'number' &&
    typeof value.needs_attention === 'number' &&
    typeof value.close_to_goal === 'number'
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
  if (key === 'doors_knocked' || key === 'inspections_set') return a[key] - b[key]
  if (key === 'doors_pct') return (a.doors_pct ?? -1) - (b.doors_pct ?? -1)
  if (key === 'inspections_pct') return (a.inspections_pct ?? -1) - (b.inspections_pct ?? -1)
  if (key === 'is_enrolled_444') return Number(a.is_enrolled_444) - Number(b.is_enrolled_444)
  const left = key === 'role' ? displayRole(a.role) : a.full_name ?? ''
  const right = key === 'role' ? displayRole(b.role) : b.full_name ?? ''
  return left.localeCompare(right)
}

function isCloseToGoalRow(row: AccountabilityRow): boolean {
  return (
    (row.doors_pct !== null && row.doors_pct >= 80 && row.doors_pct < 100) ||
    (row.inspections_pct !== null && row.inspections_pct >= 80 && row.inspections_pct < 100)
  )
}

function isNeedsAttentionRow(row: AccountabilityRow): boolean {
  return row.on_pace_doors === false || row.on_pace_inspections === false
}

function closeToGoalLines(row: AccountabilityRow): string[] {
  const lines: string[] = []
  if (
    row.doors_pct !== null &&
    row.doors_pct >= 80 &&
    row.doors_pct < 100 &&
    row.doors_goal != null
  ) {
    const remaining = Math.max(0, row.doors_goal - row.doors_knocked)
    lines.push(`${remaining} more door${remaining === 1 ? '' : 's'}`)
  }
  if (
    row.inspections_pct !== null &&
    row.inspections_pct >= 80 &&
    row.inspections_pct < 100 &&
    row.inspections_goal != null
  ) {
    const remaining = Math.max(0, row.inspections_goal - row.inspections_set)
    lines.push(`${remaining} more inspection${remaining === 1 ? '' : 's'}`)
  }
  return lines
}

function behindPaceLines(row: AccountabilityRow): string[] {
  const lines: string[] = []
  if (row.on_pace_doors === false) {
    if (row.doors_goal != null && row.doors_pct != null) {
      lines.push(`Doors ${row.doors_knocked}/${row.doors_goal} (${row.doors_pct}%)`)
    } else {
      lines.push(`Doors ${row.doors_knocked}`)
    }
  }
  if (row.on_pace_inspections === false) {
    if (row.inspections_goal != null && row.inspections_pct != null) {
      lines.push(`Insp ${row.inspections_set}/${row.inspections_goal} (${row.inspections_pct}%)`)
    } else {
      lines.push(`Insp ${row.inspections_set}`)
    }
  }
  return lines
}

function CoachingCalloutCard({
  name,
  lines,
  accent,
}: {
  name: string
  lines: string[]
  accent: 'amber' | 'red'
}) {
  const borderClass = accent === 'amber' ? 'border-amber-500/40' : 'border-red-500/40'
  const metricClass = accent === 'amber' ? 'text-amber-300' : 'text-red-300'

  return (
    <div
      className={`inline-flex shrink-0 flex-col rounded-xl border bg-slate-900 px-3 py-2 ${borderClass}`}
    >
      <p className="whitespace-nowrap text-sm font-semibold text-white">{name}</p>
      {lines.map((line) => (
        <p key={line} className={`whitespace-nowrap text-xs font-medium ${metricClass}`}>
          {line}
        </p>
      ))}
    </div>
  )
}

function AtRiskCallouts({ rows }: { rows: AccountabilityRow[] }) {
  const pushThemRows = rows.filter(isCloseToGoalRow)
  const needsAttentionRows = rows.filter(isNeedsAttentionRow)

  if (pushThemRows.length === 0 && needsAttentionRows.length === 0) return null

  return (
    <div className="space-y-4">
      {pushThemRows.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-400">
            Push them over — one message closes this
          </p>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {pushThemRows.map((row) => (
              <CoachingCalloutCard
                key={row.user_id}
                name={row.full_name ?? 'Unnamed rep'}
                lines={closeToGoalLines(row)}
                accent="amber"
              />
            ))}
          </div>
        </div>
      )}

      {needsAttentionRows.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-400">
            Behind pace mid-week
          </p>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {needsAttentionRows.map((row) => (
              <CoachingCalloutCard
                key={row.user_id}
                name={row.full_name ?? 'Unnamed rep'}
                lines={behindPaceLines(row)}
                accent="red"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function GoalCell({
  userId,
  field,
  value,
  onSaved,
}: {
  userId: string
  field: 'doors' | 'inspections'
  value: number | null
  onSaved: (userId: string, field: 'doors' | 'inspections', newValue: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value != null ? String(value) : '')
  const [saving, setSaving] = useState(false)

  async function save() {
    const parsed = draft.trim() === '' ? null : parseInt(draft, 10)
    if (parsed !== null && isNaN(parsed)) { setEditing(false); return }
    setSaving(true)
    const res = await fetch('/api/admin/sisu/goals', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        [`weekly_${field}_target`]: parsed,
      }),
    })
    setSaving(false)
    setEditing(false)
    if (!res.ok) {
      console.error('[GoalCell] Failed to save goal:', res.status)
      return
    }
    onSaved(userId, field, parsed)
  }

  if (editing) {
    return (
      <input
        type="number"
        min={0}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setEditing(false) }}
        disabled={saving}
        className="w-20 rounded border border-indigo-500 bg-slate-900 px-2 py-1 text-xs text-white focus:outline-none"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => { setDraft(value != null ? String(value) : ''); setEditing(true) }}
      className="group flex items-center gap-1 text-xs text-slate-300 hover:text-white"
      title="Click to set goal"
    >
      <span className={value != null ? 'font-semibold' : 'text-slate-500 italic'}>
        {value != null ? value : 'Set goal'}
      </span>
      <svg className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      </svg>
    </button>
  )
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
  const [summary, setSummary] = useState<TeamSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('inspections_set')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [syncing, setSyncing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)

  const sync444 = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/sisu/sync-444', { method: 'POST' })
      if (!res.ok) {
        console.error('[accountability] sync-444 returned', res.status)
      }
      setLastSyncedAt(new Date())
    } catch (err) {
      // Non-fatal — accountability data still loads; log so it's visible in DevTools
      console.error('[accountability] sync-444 fetch failed:', err)
    }
  }, [])

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
      if (isTeamSummary(payload.summary)) setSummary(payload.summary)
    } catch {
      setError('Accountability data unavailable')
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Render immediately (loading skeleton), then sync + load in background
    void sync444().then(() => loadRows(true))

    const intervalId = window.setInterval(() => {
      void sync444().then(() => loadRows(false))
    }, 5 * 60 * 1000)

    return () => window.clearInterval(intervalId)
  }, [sync444, loadRows])

  async function handleSyncNow() {
    setSyncing(true)
    await sync444()
    await loadRows(false)
    setSyncing(false)
  }

  function formatLastSynced(date: Date): string {
    const diffMs = Date.now() - date.getTime()
    const diffMins = Math.floor(diffMs / 60_000)
    if (diffMins < 1) return 'just now'
    if (diffMins === 1) return '1 minute ago'
    return `${diffMins} minutes ago`
  }

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const result = compareRows(a, b, sortKey)
      return sortDirection === 'asc' ? result : -result
    })
  }, [rows, sortDirection, sortKey])

  function handleGoalSaved(userId: string, field: 'doors' | 'inspections', newValue: number | null) {
    setRows((prev) =>
      prev.map((r) =>
        r.user_id === userId
          ? { ...r, [`${field}_goal`]: newValue }
          : r
      )
    )
  }

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
          <h1 className="text-3xl font-black tracking-tight text-white">Manager Accountability</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Current-week setter activity, door gates, inspection gates, and 444 enrollment status.
          </p>
          {lastSyncedAt && (
            <p className="mt-1 text-xs text-slate-500">
              Last synced: {formatLastSynced(lastSyncedAt)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => { void handleSyncNow() }}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncing ? (
              <>
                <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Syncing…
              </>
            ) : (
              'Sync Now'
            )}
          </button>
          <Link
            href="/admin/sisu/444"
            className="inline-flex items-center justify-center rounded-lg border border-indigo-400/40 px-4 py-2 text-sm font-semibold text-indigo-100 transition hover:border-indigo-300 hover:bg-indigo-500/10"
          >
            Manage 444
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className={`rounded-xl border px-4 py-3 ${summary.needs_attention > 0 ? 'border-red-500/40 bg-red-500/10' : 'border-slate-800 bg-slate-900/70'}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Needs Attention</p>
            <p className={`mt-1 text-2xl font-black ${summary.needs_attention > 0 ? 'text-red-300' : 'text-slate-300'}`}>{summary.needs_attention}</p>
            <p className="text-xs text-slate-500">behind pace</p>
          </div>
          <div className={`rounded-xl border px-4 py-3 ${summary.close_to_goal > 0 ? 'border-amber-500/40 bg-amber-500/10' : 'border-slate-800 bg-slate-900/70'}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Close to Goal</p>
            <p className={`mt-1 text-2xl font-black ${summary.close_to_goal > 0 ? 'text-amber-300' : 'text-slate-300'}`}>{summary.close_to_goal}</p>
            <p className="text-xs text-slate-500">80–99% there — push them</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">On Pace (Doors)</p>
            <p className="mt-1 text-2xl font-black text-emerald-300">{summary.on_pace_doors}<span className="text-sm font-normal text-slate-500">/{summary.reps_with_door_goal}</span></p>
            <p className="text-xs text-slate-500">reps with goal set</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">444 Enrolled</p>
            <p className="mt-1 text-2xl font-black text-indigo-300">{summary.enrolled_444}<span className="text-sm font-normal text-slate-500">/{summary.total_reps}</span></p>
            <p className="text-xs text-slate-500">{summary.completed_444} completed</p>
          </div>
        </div>
      )}

      {!loading && !error && <AtRiskCallouts rows={sortedRows} />}

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
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Door Goal</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <SortHeader label="Door %" sortKey="doors_pct" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Insp Goal</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <SortHeader label="Insp %" sortKey="inspections_pct" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
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
                    <td colSpan={10} className="px-4 py-4">
                      <div className="h-12 animate-pulse rounded-lg bg-slate-800/70" />
                    </td>
                  </tr>
                ))
              ) : sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-400">
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
                        <GoalCell userId={row.user_id} field="doors" value={row.doors_goal} onSaved={handleGoalSaved} />
                      </td>
                      <td className="px-4 py-4">
                        <GateBar value={row.doors_knocked} target={row.doors_goal ?? 400} tone={doorTone} />
                      </td>
                      <td className="px-4 py-4">
                        <GoalCell userId={row.user_id} field="inspections" value={row.inspections_goal} onSaved={handleGoalSaved} />
                      </td>
                      <td className="px-4 py-4">
                        <GateBar value={row.inspections_set} target={row.inspections_goal ?? 4} tone={inspectionTone} />
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
