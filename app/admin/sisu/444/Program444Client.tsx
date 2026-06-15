'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type EnrollmentStatus = 'active' | 'completed' | 'cancelled'

type EnrollmentUser = {
  full_name: string | null
  role: string | null
}

type PayrollPeriodSummary = {
  scheduled_pay_date: string
  period_label: string | null
  status: string
}

// Live, recomputed-on-read counts attached by the GET handler for ACTIVE
// enrollments. Display only — qualified/bonus state stays driven by the
// persisted columns, which the hourly sync owns.
type LiveCounts = {
  week1_doors: number
  week1_inspections: number
  week2_doors: number
  week2_inspections: number
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
  week1_qualified_at: string | null
  week1_payroll_period_id: string | null
  week2_doors: number
  week2_inspections: number
  week2_qualified: boolean
  week2_qualified_at: string | null
  week2_payroll_period_id: string | null
  status: EnrollmentStatus
  notes: string | null
  created_at: string
  updated_at: string
  users: EnrollmentUser | EnrollmentUser[] | null
  week1_payroll_period?: PayrollPeriodSummary | PayrollPeriodSummary[] | null
  week2_payroll_period?: PayrollPeriodSummary | PayrollPeriodSummary[] | null
  live?: LiveCounts | null
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

function isLiveCounts(value: unknown): value is LiveCounts {
  return (
    isRecord(value) &&
    typeof value.week1_doors === 'number' &&
    typeof value.week1_inspections === 'number' &&
    typeof value.week2_doors === 'number' &&
    typeof value.week2_inspections === 'number'
  )
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
    (typeof value.week1_qualified_at === 'string' || value.week1_qualified_at === null) &&
    (typeof value.week1_payroll_period_id === 'string' || value.week1_payroll_period_id === null) &&
    typeof value.week2_doors === 'number' &&
    typeof value.week2_inspections === 'number' &&
    typeof value.week2_qualified === 'boolean' &&
    (typeof value.week2_qualified_at === 'string' || value.week2_qualified_at === null) &&
    (typeof value.week2_payroll_period_id === 'string' || value.week2_payroll_period_id === null) &&
    isEnrollmentStatus(value.status) &&
    (typeof value.notes === 'string' || value.notes === null) &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string' &&
    (value.users === null ||
      isEnrollmentUser(value.users) ||
      (Array.isArray(value.users) && value.users.every(isEnrollmentUser))) &&
    (value.live === undefined || value.live === null || isLiveCounts(value.live))
  )
}

function getEnrollmentUser(enrollment: Program444Enrollment): EnrollmentUser | null {
  if (Array.isArray(enrollment.users)) return enrollment.users[0] ?? null
  return enrollment.users
}

function getPayrollPeriod(
  value: PayrollPeriodSummary | PayrollPeriodSummary[] | null | undefined,
): PayrollPeriodSummary | null {
  if (!value) return null
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

function PayrollReconciliation({
  qualified,
  qualifiedAt,
  payrollPeriodId,
  payrollPeriod,
  weekBonusLabel,
}: {
  qualified: boolean
  qualifiedAt: string | null
  payrollPeriodId: string | null
  payrollPeriod: PayrollPeriodSummary | PayrollPeriodSummary[] | null | undefined
  weekBonusLabel: string
}) {
  if (!qualified) {
    return <span className="text-xs text-slate-500">Not qualified</span>
  }

  const period = getPayrollPeriod(payrollPeriod)

  return (
    <div className="min-w-[150px] space-y-1 text-xs">
      <p className="font-semibold text-emerald-300">{weekBonusLabel} bonus line</p>
      {period?.scheduled_pay_date ? (
        <p className="text-slate-200">
          Pay {formatDate(period.scheduled_pay_date)}
        </p>
      ) : payrollPeriodId ? (
        <p className="text-amber-300">Period linked — date TBD</p>
      ) : (
        <p className="text-amber-300">Awaiting open payroll period</p>
      )}
      {period?.period_label && (
        <p className="text-slate-400">{period.period_label}</p>
      )}
      {qualifiedAt && (
        <p className="text-slate-500">Qualified {formatDateTime(qualifiedAt)}</p>
      )}
    </div>
  )
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
  // Stored ends_at is exclusive (midnight at week boundary). Show the last inclusive moment.
  const inclusiveEnd = new Date(new Date(end).getTime() - 1)
  return `${formatDateTime(start)} – ${formatDateTime(inclusiveEnd.toISOString())} ET`
}

function getWeekState(
  qualified: boolean,
  doors: number,
  inspections: number,
  startsAt: string,
  endsAt: string,
): WeekState {
  // Persisted qualification is the only "paid/registered" state — owned by the sync.
  if (qualified) {
    return {
      icon: '🏆',
      label: 'Qualified',
      className:
        'text-emerald-200 bg-emerald-500/15 border-emerald-400/50 shadow-[0_0_14px_rgba(16,185,129,0.35)]',
    }
  }

  const now = Date.now()
  const starts = new Date(startsAt).getTime()
  const ends = new Date(endsAt).getTime()

  // Live counts have crossed 400/4 but the hourly sync hasn't registered the
  // bonus yet. Surface it as progress awaiting finalization — explicitly NOT
  // "Qualified" and NOT a payroll/paid state, so it can't be mistaken for paid.
  if (doors >= 400 && inspections >= 4) {
    return {
      icon: '⏳',
      label: 'Goal met · finalizing',
      className: 'text-amber-100 bg-amber-500/15 border-amber-400/50',
    }
  }

  if (now < starts) {
    return {
      icon: '⚫',
      label: 'Not started',
      className: 'text-slate-300 bg-slate-700/30 border-slate-600',
    }
  }

  if (now >= ends) {
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
  isLive,
}: {
  doors: number
  inspections: number
  qualified: boolean
  startsAt: string
  endsAt: string
  isLive: boolean
}) {
  const state = getWeekState(qualified, doors, inspections, startsAt, endsAt)

  return (
    <div className="min-w-[170px] space-y-2">
      <div className="flex items-center gap-2">
        <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${state.className}`}>
          <span aria-hidden="true">{state.icon}</span>
          <span>{state.label}</span>
        </div>
        {isLive && !qualified && (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400"
            title="Counts update on each page load. Bonus qualification is registered by the hourly sync."
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
            Live
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
        <div className="rounded-lg bg-slate-900/70 px-2 py-1.5">
          <div className="text-slate-500">Doors</div>
          <div className="font-bold text-white">{doors}<span className="font-medium text-slate-500">/400</span></div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full ${doors >= 400 ? 'bg-gradient-to-r from-emerald-500 to-emerald-300' : 'bg-gradient-to-r from-indigo-500 to-violet-400'}`}
              style={{ width: `${Math.min(100, (doors / 400) * 100)}%` }}
            />
          </div>
        </div>
        <div className="rounded-lg bg-slate-900/70 px-2 py-1.5">
          <div className="text-slate-500">Inspections</div>
          <div className="font-bold text-white">{inspections}<span className="font-medium text-slate-500">/4</span></div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full ${inspections >= 4 ? 'bg-gradient-to-r from-emerald-500 to-emerald-300' : 'bg-gradient-to-r from-indigo-500 to-violet-400'}`}
              style={{ width: `${Math.min(100, (inspections / 4) * 100)}%` }}
            />
          </div>
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

export default function Program444Client({ weekBonusLabel }: { weekBonusLabel: string }) {
  const [enrollments, setEnrollments] = useState<Program444Enrollment[]>([])
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

  const activeEnrollmentUserIds = useMemo(
    () => new Set(enrollments.filter((e) => e.status === 'active').map((e) => e.user_id)),
    [enrollments],
  )

  const eligibleUsers = useMemo(
    () =>
      users.filter(
        (user) =>
          user.role !== null &&
          ELIGIBLE_ROLES.has(user.role) &&
          !activeEnrollmentUserIds.has(user.id),
      ),
    [users, activeEnrollmentUserIds],
  )

  const loadEnrollments = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/sisu/444')
      if (!response.ok) {
        throw new Error(await readApiError(response, 'Unable to load enrollments'))
      }
      const payload: unknown = await response.json()

      if (!isRecord(payload) || !Array.isArray(payload.enrollments)) {
        throw new Error('Unexpected enrollment response')
      }

      setEnrollments(payload.enrollments.filter(isProgram444Enrollment))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load 444 enrollments')
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

  async function readApiError(response: Response, fallback: string) {
    const payload: unknown = await response.json().catch(() => null)
    if (isRecord(payload) && typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error
    }
    return fallback
  }

  async function handleEnroll() {
    if (!selectedUserId || !startDate) return

    setSaving(true)
    setEnrollError(null)
    try {
      const response = await fetch('/api/admin/sisu/444', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: selectedUserId, start_date: startDate }),
      })

      if (!response.ok) {
        throw new Error(await readApiError(response, 'Unable to enroll rep'))
      }
      const payload: unknown = await response.json()

      const createdEnrollment = isRecord(payload) ? payload.enrollment : null
      if (isProgram444Enrollment(createdEnrollment)) {
        setEnrollments((current) => {
          const existing = current.some((e) => e.id === createdEnrollment.id)
          if (existing) {
            return current.map((e) =>
              e.id === createdEnrollment.id ? createdEnrollment : e,
            )
          }
          return [createdEnrollment, ...current]
        })
      } else {
        await loadEnrollments()
      }

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
      const response = await fetch('/api/admin/sisu/444', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'cancelled' }),
      })

      if (!response.ok) {
        throw new Error(await readApiError(response, 'Unable to cancel enrollment'))
      }
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
            444 Program{' '}
            <span className="bg-gradient-to-r from-amber-300 to-amber-500 bg-clip-text text-transparent">
              {weekBonusLabel}/week
            </span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Enroll reps, track their two-week 400-door and 4-inspection windows, and manage enrollment status.
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
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <p className="text-xs text-slate-500">Scroll horizontally to see all columns on smaller screens.</p>

      <div className="rounded-xl border border-slate-800 bg-slate-900/70 shadow-2xl shadow-black/20">
        <div className="overflow-x-auto rounded-xl">
          <table className="min-w-[1180px] w-full divide-y divide-slate-800">
            <thead className="bg-slate-950/70">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Rep name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Role</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Start Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Week 1 window</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Week 1 status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Week 1 payroll</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Week 2 window</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Week 2 status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Week 2 payroll</th>
                <th className="sticky right-[8rem] z-10 bg-slate-950 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap shadow-[-8px_0_12px_rgba(2,6,23,0.8)]">
                  Status
                </th>
                <th className="sticky right-0 z-10 w-32 min-w-32 bg-slate-950 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap shadow-[-8px_0_12px_rgba(2,6,23,0.8)]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-sm text-slate-400">
                    Loading enrollments...
                  </td>
                </tr>
              ) : enrollments.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-sm text-slate-400">
                    No 444 enrollments yet.
                  </td>
                </tr>
              ) : (
                enrollments.map((enrollment) => {
                  const user = getEnrollmentUser(enrollment)

                  const isCancelled = enrollment.status === 'cancelled'
                  // Live counts are only attached for active enrollments; fall
                  // back to persisted columns for completed/cancelled rows.
                  const live = enrollment.live ?? null

                  return (
                    <tr
                      key={enrollment.id}
                      className={`align-top transition hover:bg-slate-800/35 ${isCancelled ? 'opacity-60' : ''}`}
                    >
                      <td className="px-4 py-4 text-sm font-semibold text-white">
                        {user?.full_name ?? 'Unknown rep'}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-300">{displayRole(user?.role ?? null)}</td>
                      <td className="px-4 py-4 text-sm text-slate-300">{formatDate(enrollment.start_date)}</td>
                      <td className="px-4 py-4 text-sm text-slate-300 whitespace-nowrap">
                        {formatWindow(enrollment.week1_starts_at, enrollment.week1_ends_at)}
                      </td>
                      <td className="px-4 py-4">
                        {isCancelled ? (
                          <span className="text-xs text-slate-500">Cancelled</span>
                        ) : (
                          <WeekStatus
                            doors={live ? live.week1_doors : enrollment.week1_doors}
                            inspections={live ? live.week1_inspections : enrollment.week1_inspections}
                            qualified={enrollment.week1_qualified}
                            startsAt={enrollment.week1_starts_at}
                            endsAt={enrollment.week1_ends_at}
                            isLive={Boolean(live)}
                          />
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {isCancelled ? (
                          <span className="text-xs text-slate-500">—</span>
                        ) : (
                          <PayrollReconciliation
                            qualified={enrollment.week1_qualified}
                            qualifiedAt={enrollment.week1_qualified_at}
                            payrollPeriodId={enrollment.week1_payroll_period_id}
                            payrollPeriod={enrollment.week1_payroll_period}
                            weekBonusLabel={weekBonusLabel}
                          />
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-300 whitespace-nowrap">
                        {formatWindow(enrollment.week2_starts_at, enrollment.week2_ends_at)}
                      </td>
                      <td className="px-4 py-4">
                        {isCancelled ? (
                          <span className="text-xs text-slate-500">—</span>
                        ) : (
                          <WeekStatus
                            doors={live ? live.week2_doors : enrollment.week2_doors}
                            inspections={live ? live.week2_inspections : enrollment.week2_inspections}
                            qualified={enrollment.week2_qualified}
                            startsAt={enrollment.week2_starts_at}
                            endsAt={enrollment.week2_ends_at}
                            isLive={Boolean(live)}
                          />
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {isCancelled ? (
                          <span className="text-xs text-slate-500">—</span>
                        ) : (
                          <PayrollReconciliation
                            qualified={enrollment.week2_qualified}
                            qualifiedAt={enrollment.week2_qualified_at}
                            payrollPeriodId={enrollment.week2_payroll_period_id}
                            payrollPeriod={enrollment.week2_payroll_period}
                            weekBonusLabel={weekBonusLabel}
                          />
                        )}
                      </td>
                      <td className="sticky right-[8rem] z-10 bg-slate-900/95 px-4 py-4 shadow-[-8px_0_12px_rgba(2,6,23,0.8)]">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${statusChipClass(enrollment.status)}`}>
                          {enrollment.status}
                        </span>
                      </td>
                      <td className="sticky right-0 z-10 w-32 min-w-32 bg-slate-900/95 px-4 py-4 shadow-[-8px_0_12px_rgba(2,6,23,0.8)]">
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
