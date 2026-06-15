'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import Nav from '@/components/Nav'
import Link from 'next/link'
import CloseScheduleModal, { type CloseScheduleConfirm } from '@/components/appointments/CloseScheduleModal'
import { FEEDBACK_PROMPT_DISPLAY_TIMEZONE } from '@/lib/scheduling-prompt'
import { EASTERN_TZ, easternDatetimeLocalToUtcIso } from '@/lib/eastern-datetime'
import { formatInTimeZone } from 'date-fns-tz'

type ActivityRow = {
  id: string
  type: string
  body: string | null
  created_at: string
}

type QueueItem = {
  id: string
  customerName: string
  customerPhone: string | null
  address_text: string | null
  follow_up_at: string | null
  created_at: string | null
  followUpKind: 'didnt_sit' | 'handoff' | 'knockback'
  knockback_reason: string | null
  closerName: string | null
  callableNow: boolean
  activities: ActivityRow[]
}

type TabId = 'insurance' | 'followup' | 'didnt_sit'

const ET = FEEDBACK_PROMPT_DISPLAY_TIMEZONE

const INSURANCE_CALL_RESULTS = ['No Answer', 'Left Voicemail', 'Spoke with them', 'Wrong number']
const KNOCKBACK_CALL_RESULTS = ['No Answer', 'Left Voicemail', 'Spoke with them', 'Not Interested']

const KNOCKBACK_LABELS: Record<string, string> = {
  credit_fail: 'CREDIT FAIL',
  not_ready: 'NOT READY',
  price_objection: 'PRICE OBJECTION',
}

function lastContactAt(activities: ActivityRow[]): string | null {
  const contactActivities = activities
    .filter((a) => a.type === 'call' || a.type === 'text')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  return contactActivities[0]?.created_at ?? null
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return null
  return Math.floor(ms / (24 * 60 * 60 * 1000))
}

function formatEtShort(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: ET,
    month: 'short',
    day: 'numeric',
  })
}

function relativeOverdueLabel(followUpAt: string): string {
  const diffMs = Date.now() - new Date(followUpAt).getTime()
  if (diffMs <= 0) return formatEtShort(followUpAt)
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000))
  if (days >= 28) {
    const months = Math.max(1, Math.round(days / 30))
    return `${months} month${months === 1 ? '' : 's'} ago`
  }
  return `${days} day${days === 1 ? '' : 's'} ago`
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

export default function InsideSalesPage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('insurance')
  const [modalItem, setModalItem] = useState<QueueItem | null>(null)
  const [modalMode, setModalMode] = useState<'log' | 'reschedule' | null>(null)
  const [callResult, setCallResult] = useState('')
  const [spokeWith, setSpokeWith] = useState('')
  const [note, setNote] = useState('')
  const [nextFollowUp, setNextFollowUp] = useState('')
  const [scheduleItem, setScheduleItem] = useState<QueueItem | null>(null)
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const [scheduleUsers, setScheduleUsers] = useState<Array<{ id: string; full_name: string; has_calendar?: boolean }>>([])
  const [scheduleTeams, setScheduleTeams] = useState<Array<{ id: string; name: string }>>([])
  const [inspectionDuration, setInspectionDuration] = useState(60)
  const [scheduleDataLoaded, setScheduleDataLoaded] = useState(false)
  const [scheduleNote, setScheduleNote] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
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

  const insuranceItems = useMemo(() => {
    return items
      .filter((item) => item.followUpKind === 'handoff')
      .sort((a, b) => {
        const aContact = lastContactAt(a.activities)
        const bContact = lastContactAt(b.activities)
        if (aContact && bContact) {
          return new Date(aContact).getTime() - new Date(bContact).getTime()
        }
        if (aContact && !bContact) return -1
        if (!aContact && bContact) return 1
        return 0
      })
  }, [items])

  const didntSitItems = useMemo(() => items.filter((item) => item.followUpKind === 'didnt_sit'), [items])

  const knockbackItems = useMemo(() => items.filter((item) => item.followUpKind === 'knockback'), [items])

  const nowMs = Date.now()
  const knockbackDue = useMemo(
    () =>
      knockbackItems.filter((item) => {
        if (!item.follow_up_at) return false
        return new Date(item.follow_up_at).getTime() <= nowMs
      }),
    [knockbackItems, nowMs]
  )
  const knockbackUpcoming = useMemo(
    () =>
      knockbackItems.filter((item) => {
        if (!item.follow_up_at) return false
        return new Date(item.follow_up_at).getTime() > nowMs
      }),
    [knockbackItems, nowMs]
  )
  const knockbackNoDate = useMemo(
    () => knockbackItems.filter((item) => !item.follow_up_at),
    [knockbackItems]
  )

  async function postAction(
    opportunityId: string,
    payload: Record<string, unknown>
  ) {
    const res = await fetch(`/api/opportunities/${opportunityId}/inside-sales-follow-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Action failed')
    }
  }

  function openLogModal(item: QueueItem, mode: 'log' | 'reschedule' = 'log') {
    setModalItem(item)
    setModalMode(mode)
    setCallResult('')
    setSpokeWith('')
    setNote('')
    setNextFollowUp('')
    setActionError(null)
  }

  function closeModal() {
    setModalItem(null)
    setModalMode(null)
    setActionError(null)
  }

  function handleModalSubmit() {
    if (!modalItem) return
    if (modalMode === 'log' && !callResult) {
      setActionError('Please select an outcome.')
      return
    }
    if (modalMode === 'reschedule' && !nextFollowUp) {
      setActionError('Please select a follow-up date.')
      return
    }

    startTransition(async () => {
      try {
        const followUpIso = nextFollowUp
          ? easternDatetimeLocalToUtcIso(nextFollowUp)
          : null
        await postAction(modalItem.id, {
          action: 'log_call',
          result: modalMode === 'reschedule' ? 'Follow-up rescheduled' : callResult,
          spoke_with: spokeWith.trim() || undefined,
          note: note.trim() || undefined,
          next_follow_up_at: followUpIso || undefined,
          next_follow_up_timezone: EASTERN_TZ,
        })
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

  function renderPhone(phone: string | null) {
    if (!phone) return <span className="text-gray-400 text-sm">No phone</span>
    return (
      <button
        type="button"
        onClick={() => handleCopyPhone(phone)}
        className="text-sm font-medium text-indigo-700 hover:text-indigo-900 hover:underline"
        title="Tap to copy"
      >
        {copiedPhone === phone ? 'Copied!' : phone}
      </button>
    )
  }

  function renderLastContactBadge(item: QueueItem) {
    const contactAt = lastContactAt(item.activities)
    const days = contactAt ? daysSince(contactAt) : daysSince(item.created_at)
    const isStale = days !== null && days > 7
    const noContactEver = !contactAt

    if (contactAt) {
      return (
        <span className={`text-sm font-medium ${isStale ? 'text-red-600' : 'text-gray-700'}`}>
          Last Contact: {days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'} ago`}
          {isStale ? ' 🔴' : ''}
        </span>
      )
    }

    return (
      <span className={`text-sm font-medium ${noContactEver && isStale ? 'text-red-600' : 'text-gray-500'}`}>
        Last Contact: Never{noContactEver && isStale ? ' 🔴' : ''}
      </span>
    )
  }

  function renderInsuranceRow(item: QueueItem) {
    return (
      <div key={item.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <h3 className="font-semibold text-gray-900">{item.customerName}</h3>
              {renderPhone(item.customerPhone)}
            </div>
            <p className="mt-1 text-sm text-gray-600">{item.address_text || 'No address'}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {renderLastContactBadge(item)}
              {item.follow_up_at && (
                <span className="text-sm text-gray-600">
                  Next Follow-up: {formatEtShort(item.follow_up_at)}
                </span>
              )}
            </div>
            {item.closerName && (
              <p className="mt-1 text-sm text-gray-500">Closer: {item.closerName}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => openLogModal(item)}
              className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200"
            >
              Log Contact
            </button>
            <button
              type="button"
              onClick={() => openScheduleBack(item)}
              className="rounded-lg bg-indigo-100 px-3 py-2 text-sm font-medium text-indigo-900 hover:bg-indigo-200"
            >
              Schedule Back
            </button>
            <button
              type="button"
              onClick={() => handleQuickAction(item, 'mark_lost')}
              disabled={isPending}
              className="rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-200 disabled:opacity-50"
            >
              Mark Lost
            </button>
          </div>
        </div>
      </div>
    )
  }

  function renderKnockbackRow(item: QueueItem) {
    const isOverdue = item.follow_up_at && new Date(item.follow_up_at).getTime() <= nowMs
    const contactAt = lastContactAt(item.activities)
    const contactDays = contactAt ? daysSince(contactAt) : null
    const reasonLabel = item.knockback_reason
      ? KNOCKBACK_LABELS[item.knockback_reason] || item.knockback_reason.replace(/_/g, ' ').toUpperCase()
      : 'KNOCKBACK'

    return (
      <div key={item.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-gray-900">{item.customerName}</h3>
            {renderPhone(item.customerPhone)}
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-900">
              {reasonLabel}
            </span>
          </div>
          <p className="text-sm text-gray-600">{item.address_text || 'No address'}</p>
          <div className="flex flex-wrap gap-4 text-sm">
            {item.follow_up_at ? (
              <span className={isOverdue ? 'font-medium text-red-600' : 'text-gray-700'}>
                Due: {isOverdue ? `${relativeOverdueLabel(item.follow_up_at)} 🔴` : formatEtShort(item.follow_up_at)}
              </span>
            ) : (
              <span className="text-gray-500">Due: Not set</span>
            )}
            {contactAt && contactDays !== null && (
              <span className="text-gray-600">
                Last contact: {contactDays === 0 ? 'Today' : `${contactDays} day${contactDays === 1 ? '' : 's'} ago`}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => openLogModal(item)}
              className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200"
            >
              Log Call
            </button>
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
              Mark Unresponsive
            </button>
            <button
              type="button"
              onClick={() => handleQuickAction(item, 'mark_lost')}
              disabled={isPending}
              className="rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-200 disabled:opacity-50"
            >
              Mark Lost
            </button>
            <Link
              href={`/opportunities/${item.id}`}
              className="rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50"
            >
              Full record →
            </Link>
          </div>
        </div>
      </div>
    )
  }

  function renderKnockbackSection(title: string, sectionItems: QueueItem[], badge?: number) {
    if (sectionItems.length === 0) return null
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
          {title}
          {badge != null && badge > 0 && (
            <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">{badge}</span>
          )}
        </h3>
        {sectionItems.map(renderKnockbackRow)}
      </div>
    )
  }

  const isKnockbackTab = activeTab === 'followup'
  const callResults = isKnockbackTab || modalItem?.followUpKind === 'knockback'
    ? KNOCKBACK_CALL_RESULTS
    : INSURANCE_CALL_RESULTS

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Inside Sales</h1>
          <p className="text-gray-500 mt-1 text-sm">Insurance hopper and follow-up queue</p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 text-sm">{error}</div>
        )}
        {actionError && !modalItem && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 text-sm">{actionError}</div>
        )}

        <div className="mb-6 flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('insurance')}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              activeTab === 'insurance' ? 'bg-gray-900 text-white' : 'border border-gray-200 bg-white text-gray-700'
            }`}
          >
            Insurance ({insuranceItems.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('didnt_sit')}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              activeTab === 'didnt_sit' ? 'bg-gray-900 text-white' : 'border border-gray-200 bg-white text-gray-700'
            }`}
          >
            Didn&apos;t Sit ({didntSitItems.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('followup')}
            className={`rounded-full px-4 py-2 text-sm font-medium flex items-center gap-2 ${
              activeTab === 'followup' ? 'bg-gray-900 text-white' : 'border border-gray-200 bg-white text-gray-700'
            }`}
          >
            Follow-up Queue ({knockbackItems.length})
            {knockbackDue.length > 0 && (
              <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                {knockbackDue.length}
              </span>
            )}
          </button>
        </div>

        {loading ? (
          <div className="rounded-xl border bg-white p-8 text-center text-gray-500">Loading queue…</div>
        ) : activeTab === 'didnt_sit' ? (
          didntSitItems.length > 0 ? (
            <div className="space-y-4">{didntSitItems.map(renderInsuranceRow)}</div>
          ) : (
            <div className="rounded-xl border bg-white p-8 text-center text-gray-600">
              No didn&apos;t-sit leads in the queue.
            </div>
          )
        ) : activeTab === 'insurance' ? (
          insuranceItems.length > 0 ? (
            <div className="space-y-4">{insuranceItems.map(renderInsuranceRow)}</div>
          ) : (
            <div className="rounded-xl border bg-white p-8 text-center text-gray-600">
              No insurance leads in the queue. Great work! 🎉
            </div>
          )
        ) : knockbackItems.length > 0 ? (
          <div className="space-y-8">
            {renderKnockbackSection('Due Today / Overdue', knockbackDue, knockbackDue.length)}
            {renderKnockbackSection('Upcoming', knockbackUpcoming)}
            {renderKnockbackSection('No date set', knockbackNoDate)}
          </div>
        ) : (
          <div className="rounded-xl border bg-white p-8 text-center text-gray-600">
            No follow-up leads yet. They appear here when closers mark a deal as a knockback.
          </div>
        )}
      </div>

      {modalItem && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={closeModal} />
          <div className="relative w-full max-w-md rounded-xl bg-white shadow-xl p-5 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-gray-900">
              {modalMode === 'reschedule' ? 'Reschedule follow-up' : 'Log call'} — {modalItem.customerName}
            </h2>

            {modalMode === 'log' && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Outcome</label>
                <select
                  value={callResult}
                  onChange={(e) => setCallResult(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Select outcome</option>
                  {callResults.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {modalMode === 'log' && (
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
                Next follow-up <span className="text-gray-400 font-normal">(ET)</span>
              </label>
              {modalItem.followUpKind === 'knockback' && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {[2, 4, 6].map((mo) => (
                    <button
                      key={mo}
                      type="button"
                      onClick={() => setNextFollowUp(isoToEtDatetimeLocalInput(addCalendarMonthsIso(mo)))}
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
                onChange={(e) => setNextFollowUp(e.target.value)}
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
                {isPending ? 'Saving…' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

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
