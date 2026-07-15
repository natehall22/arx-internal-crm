'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'

type EnrollmentStatus = 'active' | 'cancelled'

type EnrollmentUser = {
  full_name: string | null
  role: string | null
}

type WeeklyStatus = {
  id: string
  week_number: number
  week_starts_at: string
  week_ends_at: string
  doors_knocked: number
  appointments_set: number
  rolling_avg_appointments: number | null
  gate_passed: boolean
  gate_passed_at: string | null
  commission_total: number | null
  floor_amount: number | null
  payout_source: 'floor' | 'commission' | null
  payroll_period_id: string | null
  bonus_registered: boolean
}

type Enrollment = {
  id: string
  org_id: string
  user_id: string
  enrolled_by: string | null
  start_date: string
  status: EnrollmentStatus
  notes: string | null
  created_at: string
  updated_at: string
  users: EnrollmentUser | EnrollmentUser[] | null
  weekly_status: WeeklyStatus[]
}

type OrgUser = {
  id: string
  full_name: string | null
  role: string | null
}

const ELIGIBLE_ROLES = new Set(['setter', 'canvasser', 'field_marketer'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isOrgUser(value: unknown): value is OrgUser {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (typeof value.full_name === 'string' || value.full_name === null) &&
    (typeof value.role === 'string' || value.role === null)
  )
}

function getEnrollmentUser(enrollment: Enrollment): EnrollmentUser | null {
  if (Array.isArray(enrollment.users)) return enrollment.users[0] ?? null
  return enrollment.users
}

function displayRole(role: string | null): string {
  if (!role) return 'Unassigned'
  return role.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatDate(dateString: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(`${dateString}T12:00:00`)
  )
}

function formatDateTime(dateString: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(dateString))
}

function weekLabel(weekNumber: number): string {
  if (weekNumber === 1) return 'Week 1 · 200 doors'
  if (weekNumber === 2) return 'Week 2 · 400 doors + 4 appts'
  return `Week ${weekNumber} · rolling avg`
}

function gateChip(week: WeeklyStatus) {
  if (week.gate_passed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/50 bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-200">
        🏆 Gate passed
      </span>
    )
  }
  const now = Date.now()
  const ends = new Date(week.week_ends_at).getTime()
  if (now >= ends) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300">
        🔴 Missed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-200">
      🟡 In progress
    </span>
  )
}

function payoutChip(week: WeeklyStatus) {
  if (!week.payout_source) {
    return <span className="text-xs text-slate-500">Awaiting payroll lock</span>
  }
  if (week.payout_source === 'floor') {
    return (
      <div className="text-xs">
        <p className="font-semibold text-indigo-300">Floor paid — ${week.floor_amount}</p>
        <p className="text-slate-500">Commission was ${week.commission_total}</p>
      </div>
    )
  }
  return (
    <div className="text-xs">
      <p className="font-semibold text-emerald-300">Commission paid — ${week.commission_total}</p>
      <p className="text-slate-500">Beat the ${week.floor_amount} floor</p>
    </div>
  )
}

export default function SetterRampClient({
  weeklyFloorAmount,
  commissionRate,
  week3AvgTarget,
  avgWindowWeeks,
}: {
  weeklyFloorAmount: number
  commissionRate: number
  week3AvgTarget: number
  avgWindowWeeks: number
}) {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([])
  const [users, setUsers] = useState<OrgUser[]>([])
  const [loading, setLoading] = useState(true)
  const [usersLoading, setUsersLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [enrollError, setEnrollError] = useState<string | null>(null)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const activeEnrollmentUserIds = useMemo(
    () => new Set(enrollments.filter((e) => e.status === 'active').map((e) => e.user_id)),
    [enrollments]
  )

  const eligibleUsers = useMemo(
    () => users.filter((user) => user.role !== null && ELIGIBLE_ROLES.has(user.role) && !activeEnrollmentUserIds.has(user.id)),
    [users, activeEnrollmentUserIds]
  )

  const loadEnrollments = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/setter-ramp')
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null)
        const msg = isRecord(payload) && typeof payload.error === 'string' ? payload.error : 'Unable to load enrollments'
        throw new Error(msg)
      }
      const payload: unknown = await response.json()
      if (!isRecord(payload) || !Array.isArray(payload.enrollments)) {
        throw new Error('Unexpected enrollment response')
      }
      setEnrollments(payload.enrollments as Enrollment[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load setter ramp enrollments')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadUsers = useCallback(async () => {
    setUsersLoading(true)
    try {
      const response = await fetch('/api/admin/incentives')
      if (!response.ok) throw new Error('Unable to load users')
      const payload: unknown = await response.json()
      if (!isRecord(payload) || !Array.isArray(payload.users)) throw new Error('Unexpected users response')
      setUsers(payload.users.filter(isOrgUser))
    } catch {
      setUsers([])
    } finally {
      setUsersLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadEnrollments()
    void loadUsers()
  }, [loadEnrollments, loadUsers])

  async function handleEnroll() {
    if (!selectedUserId || !startDate) return
    setSaving(true)
    setEnrollError(null)
    try {
      const response = await fetch('/api/admin/setter-ramp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: selectedUserId, start_date: startDate }),
      })
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null)
        const msg = isRecord(payload) && typeof payload.error === 'string' ? payload.error : 'Unable to enroll rep'
        throw new Error(msg)
      }
      await loadEnrollments()
      setModalOpen(false)
      setSelectedUserId('')
      setStartDate('')
    } catch (err) {
      setEnrollError(err instanceof Error ? err.message : 'Unable to enroll rep')
    } finally {
      setSaving(false)
    }
  }

  async function handleCancel(id: string) {
    setActionId(id)
    setError(null)
    try {
      const response = await fetch('/api/admin/setter-ramp', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'cancelled' }),
      })
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null)
        const msg = isRecord(payload) && typeof payload.error === 'string' ? payload.error : 'Unable to cancel enrollment'
        throw new Error(msg)
      }
      await loadEnrollments()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to cancel enrollment')
    } finally {
      setActionId(null)
    }
  }

  return (
    <div className="space-y-6 text-slate-100">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white">
            Setter Ramp{' '}
            <span className="bg-gradient-to-r from-amber-300 to-amber-500 bg-clip-text text-transparent">
              ${weeklyFloorAmount}/wk or {commissionRate}%
            </span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Week 1: 200 doors. Week 2: 400 doors + 4 appointments. Week 3+: {week3AvgTarget}/week appointments on
            a trailing {avgWindowWeeks}-week average. Passing the current week&apos;s gate makes the ${weeklyFloorAmount}{' '}
            floor available that payroll week; missing it falls back to {commissionRate}% commission only.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setError(null)
            setEnrollError(null)
            setModalOpen(true)
          }}
          className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-950/40 transition hover:from-indigo-400 hover:to-violet-400 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={usersLoading}
        >
          + Enroll Rep
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-900/70 shadow-2xl shadow-black/20">
        <div className="overflow-x-auto rounded-xl">
          <table className="min-w-[900px] w-full divide-y divide-slate-800">
            <thead className="bg-slate-950/70">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Rep</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Role</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Start date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Weeks tracked</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Current gate</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                    Loading enrollments...
                  </td>
                </tr>
              ) : enrollments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                    No setter ramp enrollments yet.
                  </td>
                </tr>
              ) : (
                enrollments.map((enrollment) => {
                  const user = getEnrollmentUser(enrollment)
                  const weeks = [...enrollment.weekly_status].sort((a, b) => a.week_number - b.week_number)
                  const latestWeek = weeks[weeks.length - 1] ?? null
                  const isExpanded = expandedId === enrollment.id
                  const isCancelled = enrollment.status === 'cancelled'

                  return (
                    <Fragment key={enrollment.id}>
                      <tr
                        className={`cursor-pointer align-top transition hover:bg-slate-800/35 ${isCancelled ? 'opacity-60' : ''}`}
                        onClick={() => setExpandedId(isExpanded ? null : enrollment.id)}
                      >
                        <td className="px-4 py-4 text-sm font-semibold text-white">{user?.full_name ?? 'Unknown rep'}</td>
                        <td className="px-4 py-4 text-sm text-slate-300">{displayRole(user?.role ?? null)}</td>
                        <td className="px-4 py-4 text-sm text-slate-300">{formatDate(enrollment.start_date)}</td>
                        <td className="px-4 py-4 text-sm text-slate-300">{weeks.length}</td>
                        <td className="px-4 py-4">
                          {latestWeek ? (
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-slate-400">{weekLabel(latestWeek.week_number)}</p>
                              {gateChip(latestWeek)}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500">Not started</span>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${
                              enrollment.status === 'active'
                                ? 'border-indigo-400/30 bg-indigo-500/15 text-indigo-200'
                                : 'border-slate-600 bg-slate-700 text-slate-300'
                            }`}
                          >
                            {enrollment.status}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          {enrollment.status === 'active' ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                void handleCancel(enrollment.id)
                              }}
                              disabled={actionId === enrollment.id}
                              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-red-400/60 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {actionId === enrollment.id ? 'Cancelling...' : 'Cancel'}
                            </button>
                          ) : (
                            <span className="text-xs text-slate-500">No actions</span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={7} className="bg-slate-950/60 px-4 py-4">
                            {weeks.length === 0 ? (
                              <p className="text-sm text-slate-500">No weeks tracked yet.</p>
                            ) : (
                              <div className="space-y-2">
                                {weeks.map((week) => (
                                  <div
                                    key={week.id}
                                    className="grid grid-cols-1 gap-3 rounded-lg border border-slate-800 bg-slate-900/70 p-3 sm:grid-cols-5"
                                  >
                                    <div>
                                      <p className="text-xs font-semibold text-slate-300">{weekLabel(week.week_number)}</p>
                                      <p className="text-xs text-slate-500">
                                        {formatDateTime(week.week_starts_at)} –{' '}
                                        {formatDateTime(new Date(new Date(week.week_ends_at).getTime() - 1).toISOString())} ET
                                      </p>
                                    </div>
                                    <div className="text-xs text-slate-300">
                                      <p className="text-slate-500">Doors</p>
                                      <p className="font-bold text-white">{week.doors_knocked}</p>
                                    </div>
                                    <div className="text-xs text-slate-300">
                                      <p className="text-slate-500">Appointments</p>
                                      <p className="font-bold text-white">
                                        {week.appointments_set}
                                        {week.rolling_avg_appointments != null && (
                                          <span className="ml-1 font-medium text-slate-500">
                                            (avg {week.rolling_avg_appointments})
                                          </span>
                                        )}
                                      </p>
                                    </div>
                                    <div>{gateChip(week)}</div>
                                    <div>{payoutChip(week)}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl shadow-black/50">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white">Enroll Rep</h2>
                <p className="mt-1 text-sm text-slate-400">Choose a rep and their first day. Week 1 starts the following Sunday.</p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-slate-300 transition hover:bg-slate-800 hover:text-white"
              >
                Close
              </button>
            </div>

            {enrollError && (
              <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {enrollError}
              </div>
            )}

            <div className="mt-6 space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-slate-200">Rep</span>
                <select
                  value={selectedUserId}
                  onChange={(event) => setSelectedUserId(event.target.value)}
                  className={`mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm outline-none transition focus:border-indigo-400 [color-scheme:dark] ${
                    selectedUserId ? 'text-white' : 'text-slate-300'
                  }`}
                >
                  <option value="" disabled className="bg-slate-950 text-slate-300">
                    Select a rep
                  </option>
                  {eligibleUsers.map((user) => (
                    <option key={user.id} value={user.id} className="bg-slate-950 text-white">
                      {user.full_name ?? 'Unnamed rep'} - {displayRole(user.role)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-200">Start date</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className={`mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm outline-none transition focus:border-indigo-400 [color-scheme:dark] ${
                    startDate ? 'text-white' : 'text-slate-300'
                  }`}
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleEnroll()}
                disabled={saving || !selectedUserId || !startDate}
                className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? 'Enrolling...' : 'Enroll'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
