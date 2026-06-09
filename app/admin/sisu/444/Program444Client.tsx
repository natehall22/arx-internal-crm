'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type EnrollmentStatus = 'active' | 'completed' | 'cancelled'

type EnrollmentUser = {
  full_name: string | null
  role: string | null
}

type Program444Enrollment = {
  id: string
  org_id: string
  user_id: string
  enrolled_by: string | null
  start_date: string
  week1_starts_at: string
  week1_ends_at: string
  week2_starts_at: string
  week2_ends_at: string
  week1_doors: number
  week1_inspections: number
  week1_qualified: boolean
  week1_paid_at: string | null
  week1_payroll_period_id: string | null
  week2_doors: number
  week2_inspections: number
  week2_qualified: boolean
  week2_paid_at: string | null
  week2_payroll_period_id: string | null
  status: EnrollmentStatus
  notes: string | null
  created_at: string
  updated_at: string
  users: EnrollmentUser | EnrollmentUser[] | null
}

type OrgUser = {
  id: string
  full_name: string | null
  role: string | null
}

type WeekState = {
  icon: string
  label: string
  className: string
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

function isEnrollmentUser(value: unknown): value is EnrollmentUser {
  return (
    isRecord(value) &&
    (typeof value.full_name === 'string' || value.full_name === null) &&
    (typeof value.role === 'string' || value.role === null)
  )
}

function isEnrollmentStatus(value: unknown): value is EnrollmentStatus {
  return value === 'active' || value === 'completed' || value === 'cancelled'
}

function isProgram444Enrollment(value: unknown): value is Program444Enrollment {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.org_id === 'string' &&
    typeof value.user_id === 'string' &&
    (typeof value.enrolled_by === 'string' || value.enrolled_by === null) &&
    typeof value.start_date === 'string' &&
    typeof value.week1_starts_at === 'string' &&
    typeof value.week1_ends_at === 'string' &&
    typeof value.week2_starts_at === 'string' &&
    typeof value.week2_ends_at === 'string' &&
    typeof value.week1_doors === 'number' &&
    typeof value.week1_inspections === 'number' &&
    typeof value.week1_qualified === 'boolean' &&
    (typeof value.week1_paid_at === 'string' || value.week1_paid_at === null) &&
    (typeof value.week1_payroll_period_id === 'string' || value.week1_payroll_period_id === null) &&
    typeof value.week2_doors === 'number' &&
    typeof value.week2_inspections === 'number' &&
    typeof value.week2_qualified === 'boolean' &&
    (typeof value.week2_paid_at === 'string' || value.week2_paid_at === null) &&
    (typeof value.week2_payroll_period_id === 'string' || value.week2_payroll_period_id === null) &&
    isEnrollmentStatus(value.status) &&
    (typeof value.notes === 'string' || value.notes === null) &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string' &&
    (value.users === null ||
      isEnrollmentUser(value.users) ||
      (Array.isArray(value.users) && value.users.every(isEnrollmentUser)))
  )
}

function getEnrollmentUser(enrollment: Program444Enrollment): EnrollmentUser | null {
  if (Array.isArray(enrollment.users)) return enrollment.users[0] ?? null
  return enrollment.users
}

function displayRole(role: string | null): string {
  if (!role) return 'Unassigned'
  return role.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatDate(dateString: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${dateString}T12:00:00`))
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

function formatWindow(start: string, end: string): string {
  return `${formatDateTime(start)} - ${formatDateTime(end)} ET`
}

function getWeekState(qualified: boolean, startsAt: string, endsAt: string): WeekState {
  const now = Date.now()
  const starts = new Date(startsAt).getTime()
  const ends = new Date(endsAt).getTime()

  if (qualified) {
    return {
      icon: '🟢',
      label: 'Qualified',
      className: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
    }
  }

  if (now < starts) {
    return {
      icon: '⚫',
      label: 'Not started',
      className: 'text-slate-300 bg-slate-700/30 border-slate-600',
    }
  }

  if (now > ends) {
    return {
      icon: '🔴',
      label: 'Missed',
      className: 'text-red-300 bg-red-500/10 border-red-500/30',
    }
  }

  return {
    icon: '🟡',
    label: 'In progress',
    className: 'text-amber-200 bg-amber-500/10 border-amber-500/30',
  }
}

function statusChipClass(status: EnrollmentStatus): string {
  if (status === 'active') return 'bg-indigo-500/15 text-indigo-200 border-indigo-400/30'
  if (status === 'completed') return 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30'
  return 'bg-slate-700 text-slate-300 border-slate-600'
}

function WeekStatus({
  doors,
  inspections,
  qualified,
  startsAt,
  endsAt,
}: {
  doors: number
  inspections: number
  qualified: boolean
  startsAt: string
  endsAt: string
}) {
  const state = getWeekState(qualified, startsAt, endsAt)

  return (
    <div className="min-w-[170px] space-y-2">
      <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${state.className}`}>
        <span aria-hidden="true">{state.icon}</span>
        <span>{state.label}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
        <div className="rounded-lg bg-slate-900/70 px-2 py-1.5">
          <div className="text-slate-500">Doors</div>
          <div className="font-semibold text-white">{doors}/400</div>
        </div>
        <div className="rounded-lg bg-slate-900/70 px-2 py-1.5">
          <div className="text-slate-500">Inspections</div>
          <div className="font-semibold text-white">{inspections}/4</div>
        </div>
      </div>
      {qualified && (
        <div className="text-xs font-medium text-emerald-300">
          Qualified badge earned
        </div>
      )}
    </div>
  )
}

export default function Program444Client() {
  const [enrollments, setEnrollments] = useState<Program444Enrollment[]>([])
  const [users, setUsers] = useState<OrgUser[]>([])
  const [loading, setLoading] = useState(true)
  const [usersLoading, setUsersLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)

  const eligibleUsers = useMemo(
    () => users.filter((user) => user.role !== null && ELIGIBLE_ROLES.has(user.role)),
    [users]
  )

  const loadEnrollments = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/sisu/444')
      if (!response.ok) throw new Error('Unable to load enrollments')
      const payload: unknown = await response.json()

      if (!isRecord(payload) || !Array.isArray(payload.enrollments)) {
        throw new Error('Unexpected enrollment response')
      }

      setEnrollments(payload.enrollments.filter(isProgram444Enrollment))
    } catch {
      setError('Unable to load 444 enrollments')
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

      if (!isRecord(payload) || !Array.isArray(payload.users)) {
        throw new Error('Unexpected users response')
      }

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
    try {
      const response = await fetch('/api/admin/sisu/444', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: selectedUserId, start_date: startDate }),
      })

      if (!response.ok) throw new Error('Unable to enroll rep')
      const payload: unknown = await response.json()

      const createdEnrollment = isRecord(payload) ? payload.enrollment : null
      if (isProgram444Enrollment(createdEnrollment)) {
        setEnrollments((current) => [createdEnrollment, ...current])
      } else {
        await loadEnrollments()
      }

      setModalOpen(false)
      setSelectedUserId('')
      setStartDate('')
    } catch {
      setError('Unable to enroll rep')
    } finally {
      setSaving(false)
    }
  }

  async function handleCancel(id: string) {
    setActionId(id)
    try {
      const response = await fetch('/api/admin/sisu/444', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'cancelled' }),
      })

      if (!response.ok) throw new Error('Unable to cancel enrollment')
      const payload: unknown = await response.json()

      const updatedEnrollment = isRecord(payload) ? payload.enrollment : null
      if (isProgram444Enrollment(updatedEnrollment)) {
        setEnrollments((current) =>
          current.map((enrollment) =>
            enrollment.id === id ? updatedEnrollment : enrollment
          )
        )
      } else {
        await loadEnrollments()
      }
    } catch {
      setError('Unable to cancel enrollment')
    } finally {
      setActionId(null)
    }
  }

  return (
    <div className="space-y-6 text-slate-100">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-indigo-300">Sisu Admin</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">444 Program</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Enroll reps, track their two-week 400-door and 4-inspection windows, and manage enrollment status.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center justify-center rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-950/30 transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={usersLoading}
        >
          Enroll Rep
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70 shadow-2xl shadow-black/20">
        <div className="overflow-x-auto">
          <table className="min-w-[1120px] w-full divide-y divide-slate-800">
            <thead className="bg-slate-950/70">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Rep name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Role</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Start Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Week 1 window</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Week 1 status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Week 2 status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">
                    Loading enrollments...
                  </td>
                </tr>
              ) : enrollments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">
                    No 444 enrollments yet.
                  </td>
                </tr>
              ) : (
                enrollments.map((enrollment) => {
                  const user = getEnrollmentUser(enrollment)

                  return (
                    <tr key={enrollment.id} className="align-top transition hover:bg-slate-800/35">
                      <td className="px-4 py-4 text-sm font-semibold text-white">
                        {user?.full_name ?? 'Unknown rep'}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-300">{displayRole(user?.role ?? null)}</td>
                      <td className="px-4 py-4 text-sm text-slate-300">{formatDate(enrollment.start_date)}</td>
                      <td className="px-4 py-4 text-sm text-slate-300">
                        <div>{formatWindow(enrollment.week1_starts_at, enrollment.week1_ends_at)}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          Week 2: {formatWindow(enrollment.week2_starts_at, enrollment.week2_ends_at)}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <WeekStatus
                          doors={enrollment.week1_doors}
                          inspections={enrollment.week1_inspections}
                          qualified={enrollment.week1_qualified}
                          startsAt={enrollment.week1_starts_at}
                          endsAt={enrollment.week1_ends_at}
                        />
                      </td>
                      <td className="px-4 py-4">
                        <WeekStatus
                          doors={enrollment.week2_doors}
                          inspections={enrollment.week2_inspections}
                          qualified={enrollment.week2_qualified}
                          startsAt={enrollment.week2_starts_at}
                          endsAt={enrollment.week2_ends_at}
                        />
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${statusChipClass(enrollment.status)}`}>
                          {enrollment.status}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        {enrollment.status === 'active' ? (
                          <button
                            type="button"
                            onClick={() => void handleCancel(enrollment.id)}
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
                <p className="mt-1 text-sm text-slate-400">
                  Choose a rep and their first day. Week 1 starts the following Sunday.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-slate-300 transition hover:bg-slate-800 hover:text-white"
              >
                Close
              </button>
            </div>

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
                    startDate
                      ? 'text-white'
                      : 'text-slate-300 [&::-webkit-datetime-edit]:text-slate-300 [&::-webkit-datetime-edit-fields-wrapper]:text-slate-300'
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
