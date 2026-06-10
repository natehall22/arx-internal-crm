'use client'

import { useCallback, useEffect, useState } from 'react'

type BonusUser = { id: string; full_name: string; role: string }
type BonusPeriod = {
  id: string
  period_label: string
  cutoff_at: string | null
  lock_at: string | null
  scheduled_pay_date: string | null
  status: string
}
type BonusReviewer = { id: string; full_name: string } | null

type BonusStatus = 'pending_approval' | 'approved' | 'rejected' | 'paid'

type BonusLine = {
  id: string
  org_id: string
  payroll_period_id: string
  user_id: string
  bonus_type: string
  amount: number
  description: string | null
  status: BonusStatus
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  created_at: string
  user: BonusUser
  period: BonusPeriod
  reviewer: BonusReviewer
}

type StatusFilter = 'pending_approval' | 'approved' | 'rejected' | 'paid' | 'all'

type CardActionState = 'idle' | 'confirming' | 'done' | 'error'

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'pending_approval', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'paid', label: 'Paid' },
  { key: 'all', label: 'All' },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isBonusStatus(value: unknown): value is BonusStatus {
  return (
    value === 'pending_approval' ||
    value === 'approved' ||
    value === 'rejected' ||
    value === 'paid'
  )
}

function isBonusUser(value: unknown): value is BonusUser {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.full_name === 'string' &&
    typeof value.role === 'string'
  )
}

function isBonusPeriod(value: unknown): value is BonusPeriod {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.period_label === 'string' &&
    (typeof value.cutoff_at === 'string' || value.cutoff_at === null) &&
    (typeof value.lock_at === 'string' || value.lock_at === null) &&
    (typeof value.scheduled_pay_date === 'string' || value.scheduled_pay_date === null) &&
    typeof value.status === 'string'
  )
}

function isBonusReviewer(value: unknown): value is BonusReviewer {
  if (value === null) return true
  return isRecord(value) && typeof value.id === 'string' && typeof value.full_name === 'string'
}

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

function isBonusLine(value: unknown): value is BonusLine {
  if (!isRecord(value)) return false

  const user = pickOne(value.user)
  const period = pickOne(value.period)
  const reviewer = pickOne(value.reviewer)

  return (
    typeof value.id === 'string' &&
    typeof value.org_id === 'string' &&
    typeof value.payroll_period_id === 'string' &&
    typeof value.user_id === 'string' &&
    typeof value.bonus_type === 'string' &&
    typeof value.amount === 'number' &&
    (typeof value.description === 'string' || value.description === null) &&
    isBonusStatus(value.status) &&
    (typeof value.reviewed_by === 'string' || value.reviewed_by === null) &&
    (typeof value.reviewed_at === 'string' || value.reviewed_at === null) &&
    (typeof value.review_note === 'string' || value.review_note === null) &&
    typeof value.created_at === 'string' &&
    user !== null &&
    isBonusUser(user) &&
    period !== null &&
    isBonusPeriod(period) &&
    isBonusReviewer(reviewer)
  )
}

function normalizeBonusLine(value: unknown): BonusLine | null {
  if (!isRecord(value) || !isBonusLine(value)) return null

  const user = pickOne(value.user)
  const period = pickOne(value.period)
  const reviewer = pickOne(value.reviewer)

  if (!user || !period) return null

  return {
    id: value.id as string,
    org_id: value.org_id as string,
    payroll_period_id: value.payroll_period_id as string,
    user_id: value.user_id as string,
    bonus_type: value.bonus_type as string,
    amount: value.amount as number,
    description: value.description as string | null,
    status: value.status as BonusStatus,
    reviewed_by: value.reviewed_by as string | null,
    reviewed_at: value.reviewed_at as string | null,
    review_note: value.review_note as string | null,
    created_at: value.created_at as string,
    user,
    period,
    reviewer: reviewer ?? null,
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    new Date(iso),
  )
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

function displayRole(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function statusChip(status: BonusStatus): { label: string; className: string } {
  if (status === 'pending_approval') {
    return {
      label: 'Pending Review',
      className: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    }
  }
  if (status === 'approved') {
    return {
      label: 'Approved',
      className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    }
  }
  if (status === 'paid') {
    return {
      label: 'Paid',
      className: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
    }
  }
  return {
    label: 'Rejected',
    className: 'bg-red-500/15 text-red-300 border-red-500/30',
  }
}

function BonusLineSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 animate-pulse">
      <div className="flex items-start justify-between gap-4">
        <div className="h-6 w-28 rounded-full bg-slate-800" />
        <div className="h-8 w-20 rounded bg-slate-800" />
      </div>
      <div className="mt-4 h-4 w-40 rounded bg-slate-800" />
      <div className="mt-2 h-3 w-56 rounded bg-slate-800/80" />
      <div className="mt-3 h-3 w-full rounded bg-slate-800/60" />
    </div>
  )
}

function BonusLineCard({
  line,
  actionState,
  justReviewed,
  isFullAdmin,
  onApprove,
  onReject,
  onMarkPaid,
}: {
  line: BonusLine
  actionState: CardActionState
  justReviewed: boolean
  isFullAdmin: boolean
  onApprove: (note: string) => void
  onReject: (note: string) => void
  onMarkPaid: () => void
}) {
  const [note, setNote] = useState('')

  const chip = statusChip(line.status)
  const isPending = line.status === 'pending_approval'
  const isApproved = line.status === 'approved'
  const showPendingActions = isPending && actionState !== 'done'
  const showMarkPaid = isFullAdmin && isApproved && actionState !== 'done'
  // Keep old variable name used below for the actions block visibility
  const showActions = showPendingActions

  return (
    <div className="relative rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-2xl shadow-black/20">
      {(actionState === 'confirming' || justReviewed) && (
        <div
          className={`absolute inset-0 z-10 flex items-center justify-center rounded-2xl ${
            justReviewed ? 'bg-emerald-950/40' : 'bg-slate-950/60'
          }`}
        >
          {actionState === 'confirming' ? (
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-500 border-t-indigo-300" />
              Confirming…
            </div>
          ) : (
            <span className="text-sm font-bold text-emerald-300">✓ Done</span>
          )}
        </div>
      )}

      {actionState === 'error' && (
        <p className="mb-3 text-sm font-semibold text-red-300">Failed — try again</p>
      )}

      <div className="flex items-start justify-between gap-4">
        <span
          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${chip.className}`}
        >
          {chip.label}
        </span>
        <p className="text-2xl font-black text-amber-400">{formatAmount(line.amount)}</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold text-slate-100">{line.user.full_name}</p>
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
          {displayRole(line.user.role)}
        </span>
      </div>

      <p className="mt-2 text-xs text-slate-400">
        {line.period.period_label}
        {line.period.scheduled_pay_date
          ? ` · pays ${formatDate(line.period.scheduled_pay_date)}`
          : ''}
      </p>

      {line.description && (
        <p className="mt-3 text-sm text-slate-300 line-clamp-2">{line.description}</p>
      )}

      {!isPending && line.reviewed_at && (
        <p className="mt-3 text-xs text-slate-500">
          {line.reviewer?.full_name ? `Reviewed by ${line.reviewer.full_name}` : 'Reviewed'}
          {' · '}
          {formatDate(line.reviewed_at)}
        </p>
      )}

      {showActions && (
        <div className="mt-5 border-t border-slate-800 pt-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onApprove(note)}
              disabled={actionState === 'confirming'}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => onReject(note)}
              disabled={actionState === 'confirming'}
              className="rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-2 text-sm font-bold text-red-300 transition hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Reject
            </button>
          </div>
          <input
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Add a note (optional)"
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-indigo-400"
          />
        </div>
      )}

      {showMarkPaid && (
        <div className="mt-5 border-t border-slate-800 pt-4">
          <button
            type="button"
            onClick={onMarkPaid}
            disabled={actionState === 'confirming'}
            className="rounded-xl border border-indigo-400/40 bg-indigo-950/40 px-4 py-2 text-sm font-bold text-indigo-300 transition hover:bg-indigo-900/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Mark Paid
          </button>
          <p className="mt-1 text-[11px] text-slate-500">Confirms payment was delivered to rep.</p>
        </div>
      )}
    </div>
  )
}

export default function BonusApprovalClient({ isFullAdmin }: { isFullAdmin: boolean }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending_approval')
  const [lines, setLines] = useState<BonusLine[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionStates, setActionStates] = useState<Record<string, CardActionState>>({})
  const [justReviewed, setJustReviewed] = useState<Set<string>>(() => new Set())

  const fetchPendingCount = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/payroll/bonus-lines?status=pending_approval')
      if (!response.ok) return
      const payload: unknown = await response.json()
      if (!isRecord(payload) || !Array.isArray(payload.bonus_lines)) return
      const count = payload.bonus_lines
        .map(normalizeBonusLine)
        .filter((line): line is BonusLine => line !== null).length
      setPendingCount(count)
    } catch {
      // Keep previous count on failure.
    }
  }, [])

  const loadLines = useCallback(async (filter: StatusFilter) => {
    setLoading(true)
    setLoadError(null)

    try {
      const query = filter === 'all' ? 'status=all' : `status=${filter}`
      const response = await fetch(`/api/admin/payroll/bonus-lines?${query}`)
      if (!response.ok) throw new Error('Unable to load bonus lines')

      const payload: unknown = await response.json()
      if (!isRecord(payload) || !Array.isArray(payload.bonus_lines)) {
        throw new Error('Unexpected bonus lines response')
      }

      const parsed = payload.bonus_lines
        .map(normalizeBonusLine)
        .filter((line): line is BonusLine => line !== null)

      setLines(parsed)
      if (filter === 'pending_approval') {
        setPendingCount(parsed.length)
      }
    } catch {
      setLoadError('Unable to load bonus lines')
      setLines([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadLines(statusFilter)
  }, [statusFilter, loadLines])

  useEffect(() => {
    if (statusFilter !== 'pending_approval') {
      void fetchPendingCount()
    }
  }, [statusFilter, fetchPendingCount])

  async function patchStatus(
    lineId: string,
    status: 'approved' | 'rejected' | 'paid',
    note: string,
  ) {
    setActionStates((prev) => ({ ...prev, [lineId]: 'confirming' }))

    try {
      const response = await fetch(`/api/admin/payroll/bonus-lines/${lineId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, note: note.trim() || null }),
      })

      if (!response.ok) throw new Error('Patch failed')

      const payload: unknown = await response.json()
      if (!isRecord(payload) || !isRecord(payload.bonus_line)) {
        throw new Error('Unexpected patch response')
      }

      const updatedLine = payload.bonus_line
      if (
        typeof updatedLine.id !== 'string' ||
        !isBonusStatus(updatedLine.status) ||
        typeof updatedLine.reviewed_at !== 'string'
      ) {
        throw new Error('Invalid patch response')
      }

      const newStatus = updatedLine.status
      const reviewedAt = updatedLine.reviewed_at
      // Use the server-confirmed review_note rather than the local note variable
      const serverReviewNote: string | null =
        typeof updatedLine.review_note === 'string' ? updatedLine.review_note : note.trim() || null

      setActionStates((prev) => ({ ...prev, [lineId]: 'done' }))
      setJustReviewed((prev) => new Set(prev).add(lineId))

      if (statusFilter === 'pending_approval') {
        // On the Pending view: decrement count and remove card after the ✓ Done flash.
        // Don't update status on the card — it's leaving the list anyway, and updating
        // before removal causes a visible "Approved" chip flicker under the overlay.
        setPendingCount((count) => Math.max(0, count - 1))
        window.setTimeout(() => {
          setJustReviewed((prev) => {
            const next = new Set(prev)
            next.delete(lineId)
            return next
          })
          setActionStates((prev) => {
            const next = { ...prev }
            delete next[lineId]
            return next
          })
          setLines((prev) => prev.filter((line) => line.id !== lineId))
        }, 1500)
      } else {
        // On All/Approved/Rejected views: update the status chip in place, then clear flash.
        setLines((prev) =>
          prev.map((line) =>
            line.id === lineId
              ? {
                  ...line,
                  status: newStatus,
                  reviewed_at: reviewedAt,
                  review_note: serverReviewNote,
                }
              : line,
          ),
        )
        window.setTimeout(() => {
          setJustReviewed((prev) => {
            const next = new Set(prev)
            next.delete(lineId)
            return next
          })
          setActionStates((prev) => {
            const next = { ...prev }
            delete next[lineId]
            return next
          })
        }, 1500)
        void fetchPendingCount()
      }
    } catch {
      setActionStates((prev) => ({ ...prev, [lineId]: 'error' }))
    }
  }

  return (
    <div className="space-y-6 text-slate-100">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-white">Bonus Approval</h1>
          {pendingCount > 0 && (
            <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-1 text-xs font-bold text-amber-300">
              {pendingCount} pending
            </span>
          )}
        </div>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          Review and approve rep bonus lines before payroll locks.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-800 bg-slate-900/70 p-1">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => setStatusFilter(filter.key)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              statusFilter === filter.key
                ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-950/30'
                : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-100'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {loadError}
        </div>
      )}

      {!isFullAdmin && (
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-950/30 px-4 py-3 text-xs text-indigo-300">
          Showing bonuses for your direct reports only.
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <BonusLineSkeleton />
          <BonusLineSkeleton />
          <BonusLineSkeleton />
        </div>
      ) : lines.length === 0 ? (
        statusFilter === 'pending_approval' ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-6 py-10 text-center">
            <p className="text-lg font-semibold text-emerald-300">✓ All clear</p>
            <p className="mt-1 text-sm text-emerald-200/80">No bonuses waiting for approval.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-6 py-10 text-center text-sm text-slate-400">
            No bonus lines found.
          </div>
        )
      ) : (
        <div className="space-y-3">
          {lines.map((line) => (
            <BonusLineCard
              key={line.id}
              line={line}
              actionState={actionStates[line.id] ?? 'idle'}
              justReviewed={justReviewed.has(line.id)}
              isFullAdmin={isFullAdmin}
              onApprove={(note) => void patchStatus(line.id, 'approved', note)}
              onReject={(note) => void patchStatus(line.id, 'rejected', note)}
              onMarkPaid={() => void patchStatus(line.id, 'paid', '')}
            />
          ))}
        </div>
      )}
    </div>
  )
}
