'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import Nav from '@/components/Nav'
import Link from 'next/link'
import CloseScheduleModal, { type CloseScheduleConfirm } from '@/components/appointments/CloseScheduleModal'
import { FEEDBACK_PROMPT_DISPLAY_TIMEZONE } from '@/lib/scheduling-prompt'
import { EASTERN_TZ, easternDatetimeLocalToUtcIso } from '@/lib/eastern-datetime'
import { suggestedNextAttemptDays, type HandoffContext } from '@/lib/inside-sales-priority'
import { formatInTimeZone } from 'date-fns-tz'

type ActivityRow = {
  id: string
  type: string
  body: string | null
  created_at: string
  users?: { full_name?: string | null } | { full_name?: string | null }[] | null
}

type QueueItem = {
  id: string
  customerName: string
  customerPhone: string | null
  address_text: string | null
  inspection_notes: string | null
  follow_up_at: string | null
  created_at: string | null
  followUpKind: 'didnt_sit' | 'handoff' | 'knockback' | 'storm'
  followUpOutcomeLabel: string | null
  knockback_reason: string | null
  closerName: string | null
  assignedToName: string | null
  callableNow: boolean
  eligibleAtIso: string | null
  story: string
  objective: string
  handoffContext: HandoffContext | null
  attemptCount: number
  lastAttemptAt: string | null
  lastAttemptSummary: string | null
  daysInQueue: number | null
  overdueDays: number | null
  priorityTier: number
  activities: ActivityRow[]
  /** Set when an adjuster meeting for this opportunity failed to reach Google Calendar. */
  adjusterMeetingSync: { failedAt: string; error: string | null } | null
}

type QueueCounts = {
  total: number
  readyToCall: number
  didntSit: number
  handoff: number
  knockback: number
  storm: number
  dueNow: number
  neverAttempted: number
  overdue: number
}

type TabId = 'up_next' | 'insurance' | 'didnt_sit' | 'knockback' | 'storm'

const ET = FEEDBACK_PROMPT_DISPLAY_TIMEZONE

const CALL_RESULTS = ['No Answer', 'Left Voicemail', 'Spoke with them', 'Wrong number']
const KNOCKBACK_CALL_RESULTS = ['No Answer', 'Left Voicemail', 'Spoke with them', 'Not Interested']

const CALL_WINDOW_LABELS: Record<string, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  anytime: 'Anytime',
}

function formatEtShort(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: ET,
    month: 'short',
    day: 'numeric',
  })
}

function formatEtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: ET,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function daysAgoLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

function addDaysEtDatetimeLocal(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  // Default retry time: 10:00 ET
  const ymd = formatInTimeZone(d, ET, 'yyyy-MM-dd')
  return `${ymd}T10:00`
}

function addCalendarMonthsIso(months: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return d.toISOString()
}

function isoToEtDatetimeLocalInput(iso: string): string {
  return formatInTimeZone(new Date(iso), ET, "yyyy-MM-dd'T'HH:mm")
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* ignore */
  }
}

function handoffChips(ctx: HandoffContext | null): string[] {
  if (!ctx) return []
  const chips: string[] = []
  if (ctx.claim_filed === 'yes') {
    chips.push(
      `Claim filed${ctx.insurance_carrier ? ` — ${ctx.insurance_carrier}` : ''}${ctx.claim_number ? ` #${ctx.claim_number}` : ''}`
    )
  } else if (ctx.claim_filed === 'no') {
    chips.push('Claim NOT filed')
  } else if (ctx.claim_filed === 'customer_filing') {
    chips.push('Customer filing claim')
  }
  if (ctx.adjuster_meeting_at) chips.push(`Adjuster: ${formatEtDateTime(ctx.adjuster_meeting_at)}`)
  if (ctx.decision_maker) chips.push(`Ask for: ${ctx.decision_maker}`)
  if (ctx.best_call_window && CALL_WINDOW_LABELS[ctx.best_call_window]) {
    chips.push(`Best time: ${CALL_WINDOW_LABELS[ctx.best_call_window]}`)
  }
  return chips
}

export default function InsideSalesPage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [counts, setCounts] = useState<QueueCounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('up_next')
  // Inside-sales reps get the one-lead conveyor as the whole page; managers get the list.
  const [viewerIsRep, setViewerIsRep] = useState(false)
  const [workMode, setWorkMode] = useState(false)
  const [workIndex, setWorkIndex] = useState(0)
  const [sessionLogged, setSessionLogged] = useState(0)
  const [modalItem, setModalItem] = useState<QueueItem | null>(null)
  const [modalMode, setModalMode] = useState<'log' | 'reschedule' | null>(null)
  const [callResult, setCallResult] = useState('')
  const [spokeWith, setSpokeWith] = useState('')
  const [note, setNote] = useState('')
  const [nextFollowUp, setNextFollowUp] = useState('')
  const [nextFollowUpTouched, setNextFollowUpTouched] = useState(false)
  const [scheduleItem, setScheduleItem] = useState<QueueItem | null>(null)
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const [scheduleUsers, setScheduleUsers] = useState<Array<{ id: string; full_name: string; has_calendar?: boolean }>>([])
  const [scheduleTeams, setScheduleTeams] = useState<Array<{ id: string; name: string }>>([])
  const [inspectionDuration, setInspectionDuration] = useState(60)
  const [scheduleDataLoaded, setScheduleDataLoaded] = useState(false)
  const [scheduleNote, setScheduleNote] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [syncNotice, setSyncNotice] = useState<{ kind: 'ok' | 'fail'; message: string } | null>(null)
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const loadQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/opportunities/inside-sales', {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (res.status === 403) {
        setError('You do not have access to Inside Sales.')
        setItems([])
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to load queue')
      }
      const data = await res.json()
      setItems(Array.isArray(data.items) ? data.items : [])
      setCounts(data.counts || null)
      setViewerIsRep(Boolean(data.canSelfAssign))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load queue')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadQueue()
    const interval = setInterval(loadQueue, 60_000)
    return () => clearInterval(interval)
  }, [loadQueue])

  // Server order IS the call order — filter per tab, never re-sort.
  const upNextItems = useMemo(
    () => items.filter((item) => item.callableNow),
    [items]
  )
  const insuranceItems = useMemo(
    () => items.filter((item) => item.followUpKind === 'handoff'),
    [items]
  )
  const didntSitItems = useMemo(
    () => items.filter((item) => item.followUpKind === 'didnt_sit'),
    [items]
  )
  const knockbackItems = useMemo(
    () => items.filter((item) => item.followUpKind === 'knockback'),
    [items]
  )
  const stormItems = useMemo(
    () => items.filter((item) => item.followUpKind === 'storm'),
    [items]
  )

  const loggedToday = useMemo(() => {
    const todayEt = formatInTimeZone(new Date(), ET, 'yyyy-MM-dd')
    let n = 0
    for (const item of items) {
      for (const activity of item.activities) {
        if (
          (activity.type === 'call' || activity.type === 'text') &&
          formatInTimeZone(new Date(activity.created_at), ET, 'yyyy-MM-dd') === todayEt
        ) {
          n += 1
        }
      }
    }
    return n
  }, [items])

  const workQueue = upNextItems
  const conveyorActive = viewerIsRep || workMode
  const workItem = conveyorActive
    ? workQueue[Math.min(workIndex, Math.max(workQueue.length - 1, 0))] ?? null
    : null
  const nextScheduled = useMemo(() => {
    const now = Date.now()
    return items
      .filter((item) => item.follow_up_at && new Date(item.follow_up_at).getTime() > now)
      .sort((a, b) => new Date(a.follow_up_at!).getTime() - new Date(b.follow_up_at!).getTime())[0]
  }, [items])

  async function postAction(opportunityId: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/opportunities/${opportunityId}/inside-sales-follow-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error || 'Action failed')
    }
    return data as {
      google_synced?: boolean
      google_sync_error?: string
      google_event_id?: string
      conflict_warning?: string
    }
  }

  /**
   * Re-push an adjuster meeting to the attending rep's Google Calendar.
   *
   * The meeting itself is never at risk here — it is already booked in the CRM.
   * This only retries the calendar push, so a failure just leaves the warning up.
   */
  function handleRetryCalendarSync(opportunityId: string) {
    startTransition(async () => {
      setSyncNotice(null)
      setActionError(null)
      try {
        const result = await postAction(opportunityId, { action: 'retry_adjuster_meeting_sync' })
        if (result?.google_synced) {
          setSyncNotice({ kind: 'ok', message: 'Adjuster meeting is on the rep’s calendar now.' })
        } else {
          setSyncNotice({
            kind: 'fail',
            message:
              result?.google_sync_error ||
              'Still could not reach Google Calendar. Nathan has been emailed.',
          })
        }
        await loadQueue()
      } catch (err) {
        setSyncNotice({
          kind: 'fail',
          message: err instanceof Error ? err.message : 'Retry failed',
        })
      }
    })
  }

  function openLogModal(item: QueueItem, mode: 'log' | 'reschedule' = 'log') {
    setModalItem(item)
    setModalMode(mode)
    setCallResult('')
    setSpokeWith('')
    setNote('')
    setNextFollowUp('')
    setNextFollowUpTouched(false)
    setActionError(null)
  }

  function closeModal() {
    setModalItem(null)
    setModalMode(null)
    setActionError(null)
  }

  function pickCallResult(result: string) {
    setCallResult(result)
    if (!nextFollowUpTouched) {
      const days = suggestedNextAttemptDays(result)
      setNextFollowUp(days !== null ? addDaysEtDatetimeLocal(days) : '')
    }
  }

  function handleModalSubmit() {
    if (!modalItem) return
    if (modalMode === 'log' && !callResult) {
      setActionError('Pick an outcome.')
      return
    }
    if (modalMode === 'reschedule' && !nextFollowUp) {
      setActionError('Pick a follow-up date.')
      return
    }

    startTransition(async () => {
      try {
        const followUpIso = nextFollowUp ? easternDatetimeLocalToUtcIso(nextFollowUp) : null
        await postAction(modalItem.id, {
          action: 'log_call',
          result: modalMode === 'reschedule' ? 'Follow-up rescheduled' : callResult,
          spoke_with: spokeWith.trim() || undefined,
          note: note.trim() || undefined,
          next_follow_up_at: followUpIso || undefined,
          next_follow_up_timezone: EASTERN_TZ,
        })
        if (modalMode === 'log') setSessionLogged((n) => n + 1)
        closeModal()
        await loadQueue()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to save')
      }
    })
  }

  function handleQuickAction(item: QueueItem, action: string) {
    startTransition(async () => {
      try {
        await postAction(item.id, { action })
        await loadQueue()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Action failed')
      }
    })
  }

  async function loadSchedulingData() {
    if (scheduleDataLoaded) return
    const res = await fetch('/api/canvass/data', { credentials: 'same-origin' })
    if (!res.ok) throw new Error('Failed to load scheduling options')
    const data = await res.json()
    setScheduleUsers(Array.isArray(data.users) ? data.users : [])
    setScheduleTeams(Array.isArray(data.teams) ? data.teams : [])
    if (typeof data.inspectionDuration === 'number' && data.inspectionDuration > 0) {
      setInspectionDuration(data.inspectionDuration)
    }
    setScheduleDataLoaded(true)
  }

  function openScheduleBack(item: QueueItem) {
    startTransition(async () => {
      try {
        await loadSchedulingData()
        setScheduleItem(item)
        setScheduleNote('')
        setScheduleModalOpen(true)
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to load scheduling')
      }
    })
  }

  function handleScheduleConfirm(confirm: CloseScheduleConfirm) {
    if (!scheduleItem) return
    startTransition(async () => {
      try {
        await postAction(scheduleItem.id, {
          action: 'schedule_back_to_closer',
          note: scheduleNote.trim() || undefined,
          schedule: confirm,
        })
        setScheduleModalOpen(false)
        setScheduleItem(null)
        await loadQueue()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to schedule')
      }
    })
  }

  function handleCopyPhone(phone: string) {
    copyToClipboard(phone)
    setCopiedPhone(phone)
    setTimeout(() => setCopiedPhone(null), 2000)
  }

  function renderPhone(phone: string | null, large = false) {
    if (!phone) return <span className="text-gray-400 text-sm">No phone</span>
    return (
      <button
        type="button"
        onClick={() => handleCopyPhone(phone)}
        className={`font-semibold text-indigo-700 hover:text-indigo-900 hover:underline ${
          large ? 'text-2xl tracking-wide' : 'text-sm'
        }`}
        title="Tap to copy for the dialer"
      >
        {copiedPhone === phone ? 'Copied!' : phone}
      </button>
    )
  }

  function kindChip(item: QueueItem) {
    if (item.followUpKind === 'knockback') {
      const reason = (item.knockback_reason || 'knockback').replace(/_/g, ' ')
      return (
        <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-bold uppercase text-orange-900">
          {reason}
        </span>
      )
    }
    if (item.followUpKind === 'didnt_sit') {
      return (
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold uppercase text-amber-900">
          Didn&apos;t sit
        </span>
      )
    }
    if (item.followUpKind === 'storm') {
      return (
        <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold uppercase text-sky-900">
          Storm (est.)
        </span>
      )
    }
    return (
      <span className="rounded-full bg-cyan-100 px-2.5 py-0.5 text-xs font-bold uppercase text-cyan-900">
        {item.followUpOutcomeLabel || 'Handoff'}
      </span>
    )
  }

  function urgencyBadge(item: QueueItem) {
    if (!item.callableNow) {
      return (
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
          {item.eligibleAtIso ? `Opens ${formatEtDateTime(item.eligibleAtIso)}` : 'Waiting on rep'}
        </span>
      )
    }
    if (typeof item.overdueDays === 'number' && item.overdueDays > 0) {
      return (
        <span className="rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-bold text-white">
          OVERDUE {item.overdueDays} day{item.overdueDays === 1 ? '' : 's'}
        </span>
      )
    }
    if (item.priorityTier === 1) {
      return (
        <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-800">
          DUE NOW{item.follow_up_at ? ` — ${formatEtDateTime(item.follow_up_at)}` : ''}
        </span>
      )
    }
    if (item.follow_up_at && new Date(item.follow_up_at).getTime() > Date.now()) {
      return (
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
          Scheduled {formatEtDateTime(item.follow_up_at)}
        </span>
      )
    }
    if (item.attemptCount === 0 && item.priorityTier === 2) {
      return (
        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-900">
          NEW — call first
        </span>
      )
    }
    return (
      <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
        Ready to call
      </span>
    )
  }

  function factLine(item: QueueItem) {
    const facts: string[] = []
    facts.push(
      item.attemptCount === 0
        ? 'Never called'
        : `${item.attemptCount} attempt${item.attemptCount === 1 ? '' : 's'}`
    )
    if (item.lastAttemptAt) facts.push(`last ${daysAgoLabel(item.lastAttemptAt)}`)
    if (typeof item.daysInQueue === 'number') facts.push(`in queue ${item.daysInQueue}d`)
    if (item.closerName) facts.push(`closer ${item.closerName}`)
    return facts.join(' · ')
  }

  function renderCardBody(item: QueueItem, large = false) {
    const chips = handoffChips(item.handoffContext)
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          {kindChip(item)}
          {urgencyBadge(item)}
        </div>
        <div className={`mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 ${large ? 'mt-4' : ''}`}>
          <h3 className={`font-bold text-gray-900 ${large ? 'text-2xl' : 'text-base'}`}>{item.customerName}</h3>
          {renderPhone(item.customerPhone, large)}
        </div>
        <p className="mt-0.5 text-sm text-gray-600">{item.address_text || 'No address'}</p>
        <p className={`mt-2 text-gray-800 ${large ? 'text-base' : 'text-sm'}`}>
          {item.story}{' '}
          <span className="font-semibold text-gray-900">→ {item.objective}</span>
        </p>
        <p className="mt-1 text-xs font-medium text-gray-500">{factLine(item)}</p>
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <span
                key={chip}
                className="rounded-md bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-900 border border-purple-200"
              >
                {chip}
              </span>
            ))}
          </div>
        )}
        {item.adjusterMeetingSync && (
          <div
            className="mt-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2"
            style={{ color: '#2c2c2a' }}
          >
            <p className="text-sm font-semibold" style={{ color: '#2c2c2a' }}>
              Adjuster meeting is not on the rep’s calendar
            </p>
            <p className="mt-0.5 text-sm" style={{ color: '#2c2c2a' }}>
              The meeting is booked, but it did not reach Google Calendar, so the
              attending rep will not get a phone reminder.
              {item.adjusterMeetingSync.error ? ` ${item.adjusterMeetingSync.error}` : ''}
            </p>
            <button
              type="button"
              onClick={() => handleRetryCalendarSync(item.id)}
              disabled={isPending}
              className="mt-2 rounded-md border border-amber-700 bg-white px-3 py-1.5 text-sm font-semibold hover:bg-amber-100 disabled:opacity-60"
              style={{ color: '#2c2c2a' }}
            >
              {isPending ? 'Retrying…' : 'Retry calendar sync'}
            </button>
            {syncNotice && (
              <p
                className="mt-2 text-sm font-medium"
                style={{ color: syncNotice.kind === 'ok' ? '#1a5c2e' : '#8a2010' }}
              >
                {syncNotice.message}
              </p>
            )}
          </div>
        )}
        {item.handoffContext?.context_line && (
          <p className="mt-2 rounded-md bg-gray-50 border border-gray-200 px-2 py-1.5 text-sm text-gray-800">
            Rep said: {item.handoffContext.context_line}
          </p>
        )}
        {item.inspection_notes && (
          <p className={`mt-2 text-sm text-gray-600 ${large ? '' : 'line-clamp-2'}`}>
            Closer notes: {item.inspection_notes}
          </p>
        )}
        {item.lastAttemptSummary && (
          <p className="mt-1 text-xs text-gray-500 truncate">Last: {item.lastAttemptSummary}</p>
        )}
      </>
    )
  }

  function renderActions(item: QueueItem) {
    return (
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => openLogModal(item)}
          className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-700"
        >
          Log Call
        </button>
        {item.followUpKind !== 'knockback' && (
          <button
            type="button"
            onClick={() => openScheduleBack(item)}
            className="rounded-lg bg-indigo-100 px-3 py-2 text-sm font-medium text-indigo-900 hover:bg-indigo-200"
          >
            Schedule Back
          </button>
        )}
        <button
          type="button"
          onClick={() => openLogModal(item, 'reschedule')}
          className="rounded-lg bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-200"
        >
          Reschedule
        </button>
        <button
          type="button"
          onClick={() => handleQuickAction(item, 'mark_unresponsive')}
          disabled={isPending}
          className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-200 disabled:opacity-50"
        >
          Unresponsive
        </button>
        <button
          type="button"
          onClick={() => handleQuickAction(item, 'mark_lost')}
          disabled={isPending}
          className="rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-200 disabled:opacity-50"
        >
          Lost
        </button>
        <Link
          href={`/opportunities/${item.id}`}
          className="rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50"
        >
          Full record →
        </Link>
      </div>
    )
  }

  function renderRow(item: QueueItem) {
    return (
      <div key={item.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3">
          {renderCardBody(item)}
          {renderActions(item)}
        </div>
      </div>
    )
  }

  const tabDefs: Array<{ id: TabId; label: string; count: number; alert?: number }> = [
    { id: 'up_next', label: 'Up Next', count: upNextItems.length, alert: counts?.dueNow || 0 },
    { id: 'insurance', label: 'Insurance', count: insuranceItems.length },
    { id: 'didnt_sit', label: "Didn't Sit", count: didntSitItems.length },
    { id: 'knockback', label: 'Knockbacks', count: knockbackItems.length },
    { id: 'storm', label: 'Storm (est.)', count: stormItems.length },
  ]

  const tabItems: Record<TabId, QueueItem[]> = {
    up_next: upNextItems,
    insurance: insuranceItems,
    didnt_sit: didntSitItems,
    knockback: knockbackItems,
    storm: stormItems,
  }

  const callResults = modalItem?.followUpKind === 'knockback' ? KNOCKBACK_CALL_RESULTS : CALL_RESULTS

  // Inside-sales rep: one lead at a time — the queue decides, the rep dials.
  if (viewerIsRep) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Next Call</h1>
            <p className="text-sm font-medium text-gray-600">
              {upNextItems.length} to call · {loggedToday} logged today
            </p>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 text-sm">{error}</div>
          )}
          {actionError && !modalItem && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 text-sm">
              {actionError}
            </div>
          )}

          {loading ? (
            <div className="rounded-xl border bg-white p-8 text-center text-gray-500">Loading…</div>
          ) : workItem ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              {renderCardBody(workItem, true)}
              <div className="mt-5 border-t pt-4">{renderActions(workItem)}</div>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => setWorkIndex((i) => Math.min(i + 1, Math.max(workQueue.length - 1, 0)))}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50"
                >
                  Skip →
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border bg-white p-8 text-center text-gray-700">
              <p className="text-lg font-semibold">Nothing to call right now. 🎉</p>
              {nextScheduled?.follow_up_at && (
                <p className="mt-2 text-sm text-gray-500">
                  Next scheduled call: {formatEtDateTime(nextScheduled.follow_up_at)} — {nextScheduled.customerName}
                </p>
              )}
            </div>
          )}
        </div>

        {modalItem && renderLogModal()}

        <CloseScheduleModal
          open={scheduleModalOpen}
          onClose={() => setScheduleModalOpen(false)}
          onConfirm={handleScheduleConfirm}
          closeDurationMinutes={inspectionDuration}
          users={scheduleUsers}
          teams={scheduleTeams}
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Inside Sales</h1>
            <p className="text-gray-500 mt-1 text-sm">Calls are ordered for you — start at the top.</p>
          </div>
          {upNextItems.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setWorkIndex(0)
                setSessionLogged(0)
                setWorkMode(true)
              }}
              className="rounded-lg bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-700"
            >
              ▶ Start Calling ({upNextItems.length})
            </button>
          )}
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-red-200 bg-red-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-800">Due / overdue</p>
            <p className="mt-1 text-2xl font-bold text-red-950">{counts?.dueNow ?? 0}</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Never called</p>
            <p className="mt-1 text-2xl font-bold text-emerald-950">{counts?.neverAttempted ?? 0}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Ready now</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{counts?.readyToCall ?? 0}</p>
          </div>
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-800">Logged today</p>
            <p className="mt-1 text-2xl font-bold text-indigo-950">{loggedToday}</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 text-sm">{error}</div>
        )}
        {actionError && !modalItem && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 text-sm">{actionError}</div>
        )}

        <div className="mb-6 flex flex-wrap gap-2">
          {tabDefs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-full px-4 py-2 text-sm font-medium flex items-center gap-2 ${
                activeTab === tab.id ? 'bg-gray-900 text-white' : 'border border-gray-200 bg-white text-gray-700'
              }`}
            >
              {tab.label} ({tab.count})
              {tab.alert && tab.alert > 0 ? (
                <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">{tab.alert}</span>
              ) : null}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="rounded-xl border bg-white p-8 text-center text-gray-500">Loading queue…</div>
        ) : tabItems[activeTab].length > 0 ? (
          <div className="space-y-4">{tabItems[activeTab].map(renderRow)}</div>
        ) : (
          <div className="rounded-xl border bg-white p-8 text-center text-gray-600">
            {activeTab === 'up_next'
              ? 'Nothing to call right now. Great work! 🎉'
              : 'No leads in this queue.'}
          </div>
        )}
      </div>

      {/* Work mode: one lead at a time, ordered by the engine */}
      {workMode && (
        <div className="fixed inset-0 z-40 bg-gray-900/95 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-4 py-8">
            <div className="mb-4 flex items-center justify-between text-white">
              <p className="text-sm font-semibold">
                Call session · {Math.min(workIndex + 1, workQueue.length)} of {workQueue.length} · logged {sessionLogged}
              </p>
              <button
                type="button"
                onClick={() => setWorkMode(false)}
                className="rounded-lg border border-white/30 px-3 py-1.5 text-sm font-medium hover:bg-white/10"
              >
                Exit
              </button>
            </div>
            {workItem ? (
              <div className="rounded-2xl bg-white p-6 shadow-2xl">
                {renderCardBody(workItem, true)}
                <div className="mt-5 border-t pt-4">{renderActions(workItem)}</div>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setWorkIndex((i) => Math.min(i + 1, Math.max(workQueue.length - 1, 0)))}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50"
                  >
                    Skip →
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl bg-white p-8 text-center text-gray-700">
                Queue cleared. Nothing left to call. 🎉
              </div>
            )}
          </div>
        </div>
      )}

      {modalItem && renderLogModal()}

      <CloseScheduleModal
        open={scheduleModalOpen}
        onClose={() => setScheduleModalOpen(false)}
        onConfirm={handleScheduleConfirm}
        closeDurationMinutes={inspectionDuration}
        users={scheduleUsers}
        teams={scheduleTeams}
      />
    </div>
  )

  function renderLogModal() {
    if (!modalItem) return null
    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={closeModal} />
          <div className="relative w-full max-w-md rounded-xl bg-white shadow-xl p-5 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-gray-900">
              {modalMode === 'reschedule' ? 'Reschedule follow-up' : 'Log call'} — {modalItem.customerName}
            </h2>

            {modalMode === 'log' && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Outcome</label>
                <div className="grid grid-cols-2 gap-2">
                  {callResults.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => pickCallResult(r)}
                      className={`rounded-lg border px-3 py-2.5 text-sm font-medium ${
                        callResult === r
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-900'
                          : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {modalMode === 'log' && callResult === 'Spoke with them' && (
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-2">Spoke with (optional)</label>
                <input
                  type="text"
                  value={spokeWith}
                  onChange={(e) => setSpokeWith(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  placeholder="Name of person spoken to"
                />
              </div>
            )}

            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-700 mb-2">Notes (optional)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none"
              />
            </div>

            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Next follow-up <span className="text-gray-400 font-normal">(ET{modalMode === 'log' ? ', auto-suggested' : ''})</span>
              </label>
              {modalItem.followUpKind === 'knockback' && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {[2, 4, 6].map((mo) => (
                    <button
                      key={mo}
                      type="button"
                      onClick={() => {
                        setNextFollowUp(isoToEtDatetimeLocalInput(addCalendarMonthsIso(mo)))
                        setNextFollowUpTouched(true)
                      }}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-amber-400"
                    >
                      +{mo} months
                    </button>
                  ))}
                </div>
              )}
              <input
                type="datetime-local"
                value={nextFollowUp}
                onChange={(e) => {
                  setNextFollowUp(e.target.value)
                  setNextFollowUpTouched(true)
                }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>

            {actionError && <p className="mt-3 text-sm text-red-600">{actionError}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleModalSubmit}
                disabled={isPending}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
    )
  }
}
