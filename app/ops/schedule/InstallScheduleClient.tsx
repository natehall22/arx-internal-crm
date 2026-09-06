'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Nav from '@/components/Nav'

/* ------------------------------------------------------------------------ *
 * API contract (GET /api/ops/install-schedule, POST .../assign, .../unassign)
 * ------------------------------------------------------------------------ */

interface ScheduleSub {
  id: string
  company_name: string
  services: string[]
  scheduling_email: string | null
  phone: string | null
}

interface ScheduledJob {
  id: string
  job_number: string
  customer_name: string | null
  address_text: string
  /** Bare YYYY-MM-DD — never parse with `new Date(...)`. */
  scheduled_date: string
  install_days: number | null
  assigned_sub_id: string
  status: string
  job_type: string
  total_squares: number | null
}

interface UnscheduledJob {
  id: string
  job_number: string
  customer_name: string | null
  address_text: string
  status: string
  job_type: string
  total_squares: number | null
  sold_at: string | null
}

interface InstallScheduleResponse {
  subs: ScheduleSub[]
  scheduled: ScheduledJob[]
  unscheduled: UnscheduledJob[]
}

type CalendarSyncResult = 'synced' | 'no_token' | 'failed'

/* ------------------------------------------------------------------------ *
 * Pure calendar-day math. `scheduled_date` / `sold_at` are bare date strings —
 * this codebase has already shipped one double-timezone bug from running a
 * bare date through `new Date(...)`. Every helper below works on the
 * YYYY-MM-DD parts directly (or anchors to UTC noon, which carries no real
 * timezone meaning — it's just a stable integer for day arithmetic).
 * ------------------------------------------------------------------------ */

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Browser wall-clock "today" — used only to seed the default window / mark
 *  the "today" column, never to interpret a server-supplied date string. */
function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function isoToUtcNoon(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1, 12))
}

function addDaysISO(iso: string, days: number): string {
  const dt = isoToUtcNoon(iso)
  dt.setUTCDate(dt.getUTCDate() + days)
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`
}

function diffDaysISO(fromIso: string, toIso: string): number {
  const a = isoToUtcNoon(fromIso).getTime()
  const b = isoToUtcNoon(toIso).getTime()
  return Math.round((b - a) / 86400000)
}

function dayOfWeekISO(iso: string): number {
  return isoToUtcNoon(iso).getUTCDay()
}

function isWeekendISO(iso: string): boolean {
  const dow = dayOfWeekISO(iso)
  return dow === 0 || dow === 6
}

function startOfWeekISO(iso: string): string {
  return addDaysISO(iso, -dayOfWeekISO(iso))
}

function formatShortDate(iso: string): string {
  return isoToUtcNoon(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function formatDayNum(iso: string): string {
  return String(isoToUtcNoon(iso).getUTCDate())
}

function formatWeekdayAbbrev(iso: string): string {
  return isoToUtcNoon(iso).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
}

function formatJobType(jobType: string): string {
  return jobType
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

const WINDOW_LENGTH_DAYS = 14
const LABEL_COL_W = 224
const DAY_COL_W = 104
const LANE_HEIGHT = 34

/* ------------------------------------------------------------------------ *
 * Stable per-sub colour so the board is scannable at a glance.
 * ------------------------------------------------------------------------ */

const SUB_PALETTE = [
  '#2563eb', '#d97706', '#059669', '#7c3aed', '#dc2626',
  '#0891b2', '#c2410c', '#4d7c0f', '#be185d', '#4338ca',
  '#0d9488', '#9333ea',
]

function colorForSubId(subId: string): string {
  let hash = 0
  for (let i = 0; i < subId.length; i++) {
    hash = (hash * 31 + subId.charCodeAt(i)) | 0
  }
  return SUB_PALETTE[Math.abs(hash) % SUB_PALETTE.length]
}

/* ------------------------------------------------------------------------ *
 * Per-sub row layout: which jobs are visible in the current window, which
 * "lane" (vertical slot) each sits in so overlapping installs don't collide,
 * and a per-day load count read live off the same data the board schedules
 * from (not a separate report).
 * ------------------------------------------------------------------------ */

interface RowLayoutItem {
  job: ScheduledJob
  visStart: number
  visSpan: number
  lane: number
}

interface RowLayout {
  lanes: number
  items: RowLayoutItem[]
  loadByDay: number[]
}

function rowHeightFor(layout: RowLayout): number {
  return Math.max(64, 30 + layout.lanes * LANE_HEIGHT + 6)
}

/* ------------------------------------------------------------------------ */

interface ToastState {
  id: number
  message: string
  tone: 'success' | 'warning' | 'error'
}

interface DragPayload {
  jobId: string
  installDays?: number
}

export default function InstallScheduleClient() {
  const [windowStart, setWindowStart] = useState<string>(() => startOfWeekISO(todayISO()))
  const [subs, setSubs] = useState<ScheduleSub[]>([])
  const [scheduled, setScheduled] = useState<ScheduledJob[]>([])
  const [unscheduled, setUnscheduled] = useState<UnscheduledJob[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  const [placingJobId, setPlacingJobId] = useState<string | null>(null)
  const [placingInstallDays, setPlacingInstallDays] = useState<1 | 2>(1)
  const [assigning, setAssigning] = useState(false)
  const [dragOverCell, setDragOverCell] = useState<{ subId: string; dateIso: string } | null>(null)

  const [toasts, setToasts] = useState<ToastState[]>([])
  const toastIdRef = useRef(0)

  const todayIso = todayISO()

  const windowDays = useMemo(() => {
    const days: string[] = []
    for (let i = 0; i < WINDOW_LENGTH_DAYS; i++) days.push(addDaysISO(windowStart, i))
    return days
  }, [windowStart])

  const windowEnd = windowDays[windowDays.length - 1]

  /* ---- fetch the board window ---- */
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)

    fetch(`/api/ops/install-schedule?start=${windowStart}&end=${windowEnd}`, {
      cache: 'no-store',
      credentials: 'same-origin',
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error((body && body.error) || `Failed to load schedule (${res.status})`)
        }
        return res.json() as Promise<InstallScheduleResponse>
      })
      .then((data) => {
        if (cancelled) return
        setSubs(Array.isArray(data?.subs) ? data.subs : [])
        setScheduled(Array.isArray(data?.scheduled) ? data.scheduled : [])
        setUnscheduled(Array.isArray(data?.unscheduled) ? data.unscheduled : [])
      })
      .catch((err) => {
        if (cancelled) return
        setSubs([])
        setScheduled([])
        setUnscheduled([])
        setLoadError(err instanceof Error ? err.message : 'Failed to load schedule')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [windowStart, windowEnd, reloadTick])

  /* ---- Esc cancels placing ---- */
  useEffect(() => {
    if (!placingJobId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPlacingJobId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placingJobId])

  const placingJob = unscheduled.find((j) => j.id === placingJobId) ?? null

  const sortedUnscheduled = useMemo(() => {
    return [...unscheduled].sort((a, b) => {
      if (!a.sold_at && !b.sold_at) return a.job_number.localeCompare(b.job_number)
      if (!a.sold_at) return 1
      if (!b.sold_at) return -1
      return a.sold_at.localeCompare(b.sold_at)
    })
  }, [unscheduled])

  const jobsBySub = useMemo(() => {
    const map = new Map<string, ScheduledJob[]>()
    for (const job of scheduled) {
      const list = map.get(job.assigned_sub_id) ?? []
      list.push(job)
      map.set(job.assigned_sub_id, list)
    }
    return map
  }, [scheduled])

  const subLayouts = useMemo(() => {
    const totalDays = windowDays.length
    const out = new Map<string, RowLayout>()
    for (const sub of subs) {
      const jobs = jobsBySub.get(sub.id) ?? []
      const loadByDay = new Array(totalDays).fill(0)
      const candidates: { job: ScheduledJob; visStart: number; visEnd: number }[] = []

      for (const job of jobs) {
        const installDays = job.install_days === 2 ? 2 : 1
        const startIdx = diffDaysISO(windowStart, job.scheduled_date)
        const endIdxExclusive = startIdx + installDays
        const visStart = Math.max(startIdx, 0)
        const visEnd = Math.min(endIdxExclusive, totalDays)
        if (visEnd <= visStart) continue
        for (let d = visStart; d < visEnd; d++) loadByDay[d] += 1
        candidates.push({ job, visStart, visEnd })
      }

      candidates.sort((a, b) => a.visStart - b.visStart || a.visEnd - b.visEnd)
      const laneEnds: number[] = []
      const items: RowLayoutItem[] = []
      for (const c of candidates) {
        let lane = laneEnds.findIndex((end) => end <= c.visStart)
        if (lane === -1) {
          lane = laneEnds.length
          laneEnds.push(c.visEnd)
        } else {
          laneEnds[lane] = c.visEnd
        }
        items.push({ job: c.job, visStart: c.visStart, visSpan: c.visEnd - c.visStart, lane })
      }

      out.set(sub.id, { lanes: Math.max(1, laneEnds.length), items, loadByDay })
    }
    return out
  }, [subs, jobsBySub, windowDays, windowStart])

  /* ---- toasts ---- */
  function pushToast(message: string, tone: ToastState['tone']) {
    const id = ++toastIdRef.current
    setToasts((cur) => [...cur, { id, message, tone }])
    setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), 6000)
  }
  function dismissToast(id: number) {
    setToasts((cur) => cur.filter((t) => t.id !== id))
  }

  /* ---- navigation ---- */
  function shiftWindow(days: number) {
    setWindowStart((cur) => addDaysISO(cur, days))
  }
  function goToday() {
    setWindowStart(startOfWeekISO(todayISO()))
  }

  /* ---- selection ("placing") ---- */
  function beginPlacing(job: UnscheduledJob) {
    setPlacingJobId((cur) => (cur === job.id ? null : job.id))
    setPlacingInstallDays(1)
  }

  /* ---- assignment: the same click/drop path handles a brand-new placement
   *      and moving an already-scheduled chip, since both are just
   *      "put this job on this sub's day". ---- */
  async function performAssign(jobId: string, subId: string, scheduledDate: string, installDays: 1 | 2) {
    if (assigning) return
    setAssigning(true)
    setPlacingJobId(null)

    const fromUnscheduled = unscheduled.find((j) => j.id === jobId)
    const fromScheduled = scheduled.find((j) => j.id === jobId)
    const base = fromScheduled ?? fromUnscheduled

    // Optimistic UI — assignment must equal placement, so reflect it immediately.
    if (base) {
      if (fromUnscheduled) setUnscheduled((cur) => cur.filter((j) => j.id !== jobId))
      setScheduled((cur) => {
        const optimisticJob: ScheduledJob = {
          id: jobId,
          job_number: base.job_number,
          customer_name: base.customer_name,
          address_text: base.address_text,
          scheduled_date: scheduledDate,
          install_days: installDays,
          assigned_sub_id: subId,
          status: 'scheduled',
          job_type: base.job_type,
          total_squares: base.total_squares,
        }
        return [...cur.filter((j) => j.id !== jobId), optimisticJob]
      })
    }

    try {
      const res = await fetch('/api/ops/install-schedule/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ jobId, subId, scheduledDate, installDays }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error((body && body.error) || 'Failed to schedule job')
      }

      const subName = subs.find((s) => s.id === subId)?.company_name || 'the sub'
      const calendar: CalendarSyncResult | undefined = body?.calendar
      if (calendar === 'synced') {
        pushToast(`Scheduled — ${subName} was emailed the calendar invite.`, 'success')
      } else if (calendar === 'no_token') {
        pushToast(
          'Job scheduled — no calendar invite was sent because the scheduling user hasn’t connected Google Calendar.',
          'warning'
        )
      } else if (calendar === 'failed') {
        pushToast('Job scheduled, but the calendar invite failed to send.', 'warning')
      } else {
        pushToast('Job scheduled.', 'success')
      }
      // Reconcile with server truth in the background (load counts, canonical fields).
      setReloadTick((t) => t + 1)
    } catch (err) {
      // Don't trust the optimistic state after a failed write — refetch server truth.
      setReloadTick((t) => t + 1)
      pushToast(err instanceof Error ? err.message : 'Failed to schedule job', 'error')
    } finally {
      setAssigning(false)
    }
  }

  function handleCellClick(subId: string, dateIso: string) {
    if (assigning || !placingJob) return
    performAssign(placingJob.id, subId, dateIso, placingInstallDays)
  }

  function handleDrop(e: React.DragEvent, subId: string, dateIso: string) {
    e.preventDefault()
    setDragOverCell(null)
    if (assigning) return
    const raw = e.dataTransfer.getData('application/json')
    if (!raw) return
    try {
      const payload = JSON.parse(raw) as DragPayload
      if (!payload?.jobId) return
      performAssign(payload.jobId, subId, dateIso, payload.installDays === 2 ? 2 : 1)
    } catch {
      // malformed drag payload — ignore
    }
  }

  function handleDragStartUnscheduled(e: React.DragEvent, job: UnscheduledJob) {
    e.dataTransfer.effectAllowed = 'move'
    const payload: DragPayload = { jobId: job.id, installDays: 1 }
    e.dataTransfer.setData('application/json', JSON.stringify(payload))
  }

  function handleDragStartScheduled(e: React.DragEvent, job: ScheduledJob) {
    e.dataTransfer.effectAllowed = 'move'
    const payload: DragPayload = { jobId: job.id, installDays: job.install_days === 2 ? 2 : 1 }
    e.dataTransfer.setData('application/json', JSON.stringify(payload))
  }

  async function unassignJob(job: ScheduledJob, subName: string) {
    const ok = window.confirm(
      `Remove ${job.job_number}${job.customer_name ? ` — ${job.customer_name}` : ''} from ${subName}'s schedule?\n\nThis un-schedules the job and emails ${subName} that the install date was removed.`
    )
    if (!ok) return

    setScheduled((cur) => cur.filter((j) => j.id !== job.id))
    setUnscheduled((cur) => [
      {
        id: job.id,
        job_number: job.job_number,
        customer_name: job.customer_name,
        address_text: job.address_text,
        status: 'sold',
        job_type: job.job_type,
        total_squares: job.total_squares,
        sold_at: null,
      },
      ...cur,
    ])

    try {
      const res = await fetch('/api/ops/install-schedule/unassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ jobId: job.id }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error((body && body.error) || 'Failed to remove from schedule')
      }
      pushToast(`Removed from ${subName}'s schedule.`, 'success')
      setReloadTick((t) => t + 1)
    } catch (err) {
      setReloadTick((t) => t + 1)
      pushToast(err instanceof Error ? err.message : 'Failed to remove from schedule', 'error')
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f6f2]">
      <Nav />

      <div className="mx-auto max-w-[1800px] px-4 py-6">
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#2c2c2a]">Install Schedule</h1>
            <p className="text-sm text-[#57574f]">
              View a sub&apos;s calendar and put a job on it — same screen, at most 2 clicks.
            </p>
          </div>
          <Link
            href="/ops"
            className="inline-flex items-center rounded-lg border border-[#c9c7c0] bg-white px-4 py-2 text-sm font-medium text-[#2c2c2a] hover:bg-[#f2f1ee]"
          >
            ← Back to Board
          </Link>
        </div>

        {placingJob && (
          <div className="sticky top-2 z-30 mb-4 flex flex-col gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-[#2c2c2a]">
              <span className="font-semibold">Placing:</span> {placingJob.job_number}
              {placingJob.customer_name ? ` · ${placingJob.customer_name}` : ''} — click (or tap) a day on a
              sub&apos;s row to schedule it.
            </div>
            <div className="flex items-center gap-3">
              <div className="flex overflow-hidden rounded-md border border-indigo-300" role="group" aria-label="Install length">
                <button
                  type="button"
                  onClick={() => setPlacingInstallDays(1)}
                  className={`px-3 py-1.5 text-xs font-medium ${placingInstallDays === 1 ? 'bg-indigo-600 text-white' : 'bg-white text-[#2c2c2a]'}`}
                >
                  1 day
                </button>
                <button
                  type="button"
                  onClick={() => setPlacingInstallDays(2)}
                  className={`px-3 py-1.5 text-xs font-medium ${placingInstallDays === 2 ? 'bg-indigo-600 text-white' : 'bg-white text-[#2c2c2a]'}`}
                >
                  2 days
                </button>
              </div>
              <button
                type="button"
                onClick={() => setPlacingJobId(null)}
                className="rounded-md border border-[#c9c7c0] bg-white px-3 py-1.5 text-xs font-medium text-[#2c2c2a] hover:bg-[#f2f1ee]"
              >
                Cancel (Esc)
              </button>
            </div>
          </div>
        )}

        {loadError && (
          <div className="mb-4 flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between">
            <span>Couldn&apos;t load the schedule: {loadError}</span>
            <button
              type="button"
              onClick={() => setReloadTick((t) => t + 1)}
              className="self-start rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 sm:self-auto"
            >
              Retry
            </button>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-[#e5e3dc] bg-white p-3">
          <button
            type="button"
            onClick={() => shiftWindow(-7)}
            className="min-h-[44px] min-w-[44px] rounded-lg p-2 text-lg text-[#2c2c2a] hover:bg-[#f2f1ee]"
            aria-label="Previous week"
          >
            ‹
          </button>
          <div className="min-w-[210px] text-center text-sm font-semibold text-[#2c2c2a]">
            {formatShortDate(windowStart)} – {formatShortDate(windowEnd)}
          </div>
          <button
            type="button"
            onClick={() => shiftWindow(7)}
            className="min-h-[44px] min-w-[44px] rounded-lg p-2 text-lg text-[#2c2c2a] hover:bg-[#f2f1ee]"
            aria-label="Next week"
          >
            ›
          </button>
          <button
            type="button"
            onClick={goToday}
            className="min-h-[44px] rounded-lg border border-[#c9c7c0] px-3 py-1.5 text-sm text-[#2c2c2a] hover:bg-[#f2f1ee]"
          >
            Today
          </button>
          {loading && <span className="text-xs text-[#8a8a82]">Loading…</span>}
        </div>

        <div className="flex flex-col gap-4 lg:flex-row">
          {/* Persistent "to be scheduled" queue — left on desktop, top on mobile via order-1 */}
          <div className="order-1 w-full lg:order-2 lg:w-72 lg:flex-shrink-0">
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wide text-amber-900">To be scheduled</h2>
                <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900">
                  {sortedUnscheduled.length}
                </span>
              </div>
              {sortedUnscheduled.length === 0 ? (
                <p className="py-4 text-center text-xs text-amber-800">
                  Nothing waiting — everything sold is on the board.
                </p>
              ) : (
                <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-0.5">
                  {sortedUnscheduled.map((job) => {
                    const selected = placingJobId === job.id
                    const daysSinceSold = job.sold_at ? diffDaysISO(job.sold_at.slice(0, 10), todayIso) : null
                    return (
                      <div
                        key={job.id}
                        role="button"
                        tabIndex={0}
                        draggable
                        onDragStart={(e) => handleDragStartUnscheduled(e, job)}
                        onDragEnd={() => setDragOverCell(null)}
                        onClick={() => beginPlacing(job)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            beginPlacing(job)
                          }
                        }}
                        className={`min-h-[44px] cursor-pointer rounded-lg border p-2.5 text-left shadow-sm transition ${
                          selected
                            ? 'border-indigo-500 bg-indigo-100 ring-2 ring-indigo-300'
                            : 'border-amber-200 bg-white hover:border-amber-400'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-[#2c2c2a]">{job.job_number}</span>
                          {daysSinceSold !== null && daysSinceSold >= 3 && (
                            <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                              {daysSinceSold}d
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-[#57574f]">{job.customer_name || job.address_text}</div>
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-[#8a8a82]">
                          <span className="rounded bg-[#f2f1ee] px-1.5 py-0.5">{formatJobType(job.job_type)}</span>
                          {job.total_squares ? <span>{job.total_squares} sq</span> : null}
                        </div>
                        {selected && (
                          <div className="mt-1 text-[10px] font-medium text-indigo-700">
                            Placing — tap a day to schedule
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Board */}
          <div className="order-2 min-w-0 flex-1 lg:order-1">
            {loading && subs.length === 0 && !loadError ? (
              <div className="rounded-lg border border-[#e5e3dc] bg-white p-8 text-center text-sm text-[#57574f]">
                Loading schedule…
              </div>
            ) : subs.length === 0 && !loading ? (
              <div className="rounded-lg border border-[#e5e3dc] bg-white p-8 text-center text-sm text-[#57574f]">
                No sub-contractors configured yet.{' '}
                <a href="/admin/subs" className="text-indigo-600 hover:underline">
                  Add one in Admin → Sub-Contractors
                </a>
                .
              </div>
            ) : (
              <>
                {/* Desktop / tablet: sub rows × day columns */}
                <div className="hidden overflow-x-auto rounded-lg border border-[#e5e3dc] bg-white lg:block">
                  <div style={{ width: LABEL_COL_W + windowDays.length * DAY_COL_W }}>
                    <div className="flex border-b border-[#e5e3dc] bg-[#f7f6f2]">
                      <div
                        className="sticky left-0 z-10 shrink-0 border-r border-[#e5e3dc] bg-[#f7f6f2] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#57574f]"
                        style={{ width: LABEL_COL_W }}
                      >
                        Subcontractor
                      </div>
                      {windowDays.map((dateIso) => {
                        const isToday = dateIso === todayIso
                        const weekend = isWeekendISO(dateIso)
                        return (
                          <div
                            key={dateIso}
                            className={`shrink-0 border-r border-[#e5e3dc] px-1 py-2 text-center ${weekend ? 'bg-[#efeee8]' : ''} ${isToday ? 'bg-indigo-100' : ''}`}
                            style={{ width: DAY_COL_W }}
                          >
                            <div className={`text-[10px] uppercase ${weekend ? 'text-[#8a8a82]' : 'text-[#57574f]'}`}>
                              {formatWeekdayAbbrev(dateIso)}
                            </div>
                            <div className={`text-sm font-semibold ${isToday ? 'text-indigo-700' : 'text-[#2c2c2a]'}`}>
                              {formatDayNum(dateIso)}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {subs.map((sub) => {
                      const layout: RowLayout =
                        subLayouts.get(sub.id) ?? { lanes: 1, items: [], loadByDay: new Array(windowDays.length).fill(0) }
                      return (
                        <div
                          key={sub.id}
                          className="flex border-b border-[#e5e3dc] last:border-b-0"
                          style={{ minHeight: rowHeightFor(layout) }}
                        >
                          <div
                            className="sticky left-0 z-10 shrink-0 border-r border-[#e5e3dc] bg-white px-3 py-2"
                            style={{ width: LABEL_COL_W }}
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: colorForSubId(sub.id) }}
                              />
                              <span className="truncate text-sm font-semibold text-[#2c2c2a]">{sub.company_name}</span>
                            </div>
                            {sub.phone && <div className="mt-0.5 truncate text-xs text-[#57574f]">{sub.phone}</div>}
                          </div>

                          <div className="relative flex" style={{ width: windowDays.length * DAY_COL_W }}>
                            {windowDays.map((dateIso, idx) => {
                              const isToday = dateIso === todayIso
                              const weekend = isWeekendISO(dateIso)
                              const load = layout.loadByDay[idx] || 0
                              const isDragTarget = dragOverCell?.subId === sub.id && dragOverCell?.dateIso === dateIso
                              return (
                                <button
                                  key={dateIso}
                                  type="button"
                                  onClick={() => handleCellClick(sub.id, dateIso)}
                                  onDragOver={(e) => {
                                    e.preventDefault()
                                    setDragOverCell({ subId: sub.id, dateIso })
                                  }}
                                  onDragLeave={() => setDragOverCell(null)}
                                  onDrop={(e) => handleDrop(e, sub.id, dateIso)}
                                  className={[
                                    'relative h-full shrink-0 border-r border-[#e5e3dc] px-1 pt-1 text-left align-top',
                                    weekend ? 'bg-[#f7f6f2]' : 'bg-white',
                                    isToday ? 'ring-2 ring-inset ring-indigo-300' : '',
                                    placingJob ? 'cursor-pointer hover:bg-indigo-50' : 'cursor-default',
                                    isDragTarget ? 'bg-indigo-100' : '',
                                  ].join(' ')}
                                  style={{ width: DAY_COL_W }}
                                >
                                  {load > 0 && (
                                    <span className="rounded-full bg-[#e5e3dc] px-1.5 text-[10px] font-medium text-[#2c2c2a]">
                                      {load}
                                    </span>
                                  )}
                                </button>
                              )
                            })}

                            <div className="pointer-events-none absolute inset-0">
                              {layout.items.map(({ job, visStart, visSpan, lane }) => (
                                <div
                                  key={job.id}
                                  draggable
                                  onDragStart={(e) => handleDragStartScheduled(e, job)}
                                  onDragEnd={() => setDragOverCell(null)}
                                  className="pointer-events-auto absolute overflow-hidden rounded-md border px-1.5 py-1 text-[11px] shadow-sm"
                                  style={{
                                    left: `${(visStart / windowDays.length) * 100}%`,
                                    width: `calc(${(visSpan / windowDays.length) * 100}% - 4px)`,
                                    top: 24 + lane * LANE_HEIGHT,
                                    height: LANE_HEIGHT - 4,
                                    backgroundColor: `${colorForSubId(sub.id)}1f`,
                                    borderColor: colorForSubId(sub.id),
                                  }}
                                >
                                  <div className="flex h-full items-center gap-1">
                                    <Link
                                      href={`/ops/jobs/${job.id}`}
                                      className="min-w-0 flex-1 truncate font-medium text-[#2c2c2a] hover:underline"
                                      title={`${job.job_number} — ${job.customer_name || job.address_text}${job.total_squares ? ` · ${job.total_squares} sq` : ''}`}
                                    >
                                      {job.job_number}
                                      {job.customer_name ? ` · ${job.customer_name}` : ''}
                                    </Link>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        unassignJob(job, sub.company_name)
                                      }}
                                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[#57574f] hover:bg-white hover:text-red-600"
                                      aria-label={`Remove ${job.job_number} from schedule`}
                                      title="Remove from schedule"
                                    >
                                      ×
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Mobile: per-day list, one card per day, subs listed inside */}
                <div className="space-y-3 lg:hidden">
                  {windowDays.map((dateIso, dayIdx) => {
                    const isToday = dateIso === todayIso
                    const weekend = isWeekendISO(dateIso)
                    return (
                      <div
                        key={dateIso}
                        className={`rounded-lg border border-[#e5e3dc] ${weekend ? 'bg-[#f7f6f2]' : 'bg-white'}`}
                      >
                        <div
                          className={`flex items-center justify-between rounded-t-lg border-b border-[#e5e3dc] px-3 py-2 ${isToday ? 'bg-indigo-100' : ''}`}
                        >
                          <div className="text-sm font-semibold text-[#2c2c2a]">{formatShortDate(dateIso)}</div>
                          {isToday && (
                            <span className="text-[10px] font-semibold uppercase text-indigo-700">Today</span>
                          )}
                        </div>
                        <div className="divide-y divide-[#efeee8]">
                          {subs.map((sub) => {
                            const layout = subLayouts.get(sub.id)
                            const dayJobs = (layout?.items ?? []).filter(
                              (it) => dayIdx >= it.visStart && dayIdx < it.visStart + it.visSpan
                            )
                            const load = layout?.loadByDay[dayIdx] ?? 0
                            return (
                              <div
                                key={sub.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => handleCellClick(sub.id, dateIso)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    handleCellClick(sub.id, dateIso)
                                  }
                                }}
                                onDragOver={(e) => placingJob && e.preventDefault()}
                                onDrop={(e) => handleDrop(e, sub.id, dateIso)}
                                className={`flex min-h-[44px] w-full items-start gap-2 px-3 py-2 text-left ${placingJob ? 'cursor-pointer active:bg-indigo-50' : ''}`}
                              >
                                <span
                                  className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: colorForSubId(sub.id) }}
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium text-[#2c2c2a]">
                                    {sub.company_name}
                                    {load > 0 && (
                                      <span className="ml-2 text-xs font-normal text-[#57574f]">
                                        ({load} job{load === 1 ? '' : 's'})
                                      </span>
                                    )}
                                  </span>
                                  {dayJobs.length === 0 ? (
                                    placingJob && (
                                      <span className="text-xs text-indigo-600">
                                        Tap to place {placingJob.job_number} here
                                      </span>
                                    )
                                  ) : (
                                    <span className="mt-0.5 flex flex-wrap gap-1">
                                      {dayJobs.map(({ job }) => (
                                        <span
                                          key={job.id}
                                          className="inline-flex min-h-[32px] items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs"
                                          style={{
                                            backgroundColor: `${colorForSubId(sub.id)}1f`,
                                            borderColor: colorForSubId(sub.id),
                                          }}
                                        >
                                          <Link
                                            href={`/ops/jobs/${job.id}`}
                                            className="text-[#2c2c2a] hover:underline"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            {job.job_number}
                                            {job.customer_name ? ` · ${job.customer_name}` : ''}
                                          </Link>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              unassignJob(job, sub.company_name)
                                            }}
                                            className="flex h-6 w-6 items-center justify-center text-[#57574f] hover:text-red-600"
                                            aria-label={`Remove ${job.job_number}`}
                                          >
                                            ×
                                          </button>
                                        </span>
                                      ))}
                                    </span>
                                  )}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex max-w-xs items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg ${
              t.tone === 'success'
                ? 'border-green-300 bg-green-50 text-green-900'
                : t.tone === 'warning'
                  ? 'border-amber-300 bg-amber-50 text-amber-900'
                  : 'border-red-300 bg-red-50 text-red-900'
            }`}
          >
            <span className="flex-1">{t.message}</span>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="shrink-0 text-current opacity-60 hover:opacity-100"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
