'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import CloseScheduleModal, { type CloseScheduleConfirm } from '@/components/appointments/CloseScheduleModal'

type ActivityRow = {
  id: string
  type: string
  body: string | null
  created_at: string
  users?: { full_name?: string | null } | { full_name?: string | null }[] | null
}

type Props = {
  opportunityId: string
  customerName: string
  customerPhone: string | null
  followUpKind: 'didnt_sit' | 'handoff'
  /** Admin inspection outcome label when followUpKind is handoff */
  handoffOutcomeLabel?: string | null
  assignedToName: string | null
  statusLabel: string
  nextFollowUpAt: string | null
  closerNotes: string | null
  /** Past admin wait / didnt-sit ready */
  callableNow?: boolean
  eligibleAtIso?: string | null
  adminHandoffDelayDays?: number | null
  /** Refetch queue list after claim / save / schedule */
  onFollowUpCompleted?: () => void
  visible: boolean
  canManage: boolean
  canSelfAssign: boolean
  activities: ActivityRow[]
}

type FollowUpAction = 'claim_self' | 'log_call' | 'log_text' | 'mark_rescheduled' | 'mark_unresponsive' | 'mark_lost'
type ActionKind = Exclude<FollowUpAction, 'claim_self'> | null

const CALL_RESULTS = ['Spoke with customer', 'Left voicemail', 'No answer', 'Wrong number']
const TEXT_RESULTS = ['Sent text', 'Customer replied', 'No response yet']

export default function InsideSalesFollowUpDrawer({
  opportunityId,
  customerName,
  customerPhone,
  followUpKind,
  handoffOutcomeLabel,
  assignedToName,
  statusLabel,
  nextFollowUpAt,
  closerNotes,
  callableNow = true,
  eligibleAtIso = null,
  adminHandoffDelayDays = null,
  onFollowUpCompleted,
  visible,
  canManage,
  canSelfAssign,
  activities,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [action, setAction] = useState<ActionKind>(null)
  const [result, setResult] = useState('')
  const [note, setNote] = useState('')
  const [nextFollowUpValue, setNextFollowUpValue] = useState('')
  const [scheduleNote, setScheduleNote] = useState('')
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const [scheduleUsers, setScheduleUsers] = useState<Array<{ id: string; full_name: string; has_calendar?: boolean }>>([])
  const [scheduleTeams, setScheduleTeams] = useState<Array<{ id: string; name: string }>>([])
  const [inspectionDuration, setInspectionDuration] = useState(60)
  const [scheduleDataLoaded, setScheduleDataLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const recentActivities = useMemo(
    () =>
      activities.filter((item) =>
        ['call', 'text', 'status_change', 'appointment_scheduled'].includes(item.type)
      ).slice(0, 8),
    [activities]
  )

  const followUpBadgeLabel =
    followUpKind === 'handoff'
      ? handoffOutcomeLabel?.trim() || 'Inspection handoff'
      : "Didn't sit"
  const headline = callableNow
    ? 'Your turn — ok to call'
    : eligibleAtIso
      ? 'Still with field rep'
      : 'In follow-up queue'

  const drawerEyebrow = 'Inside sales'
  const schedulePlaceholder =
    followUpKind === 'handoff'
      ? 'Example: Customer is ready for the next visit. Review prior notes before arriving and confirm the right decision-maker will be there.'
      : 'Example: Customer available after 6 PM. Wife needs Spanish support. Confirm husband is home before driving out.'

  const phoneDigits = customerPhone ? customerPhone.replace(/\D/g, '') : ''

  if (!visible) return null

  const resultOptions =
    action === 'log_call' ? CALL_RESULTS : action === 'log_text' ? TEXT_RESULTS : []

  async function submitAction(kind: FollowUpAction) {
    setError(null)
    const payload: Record<string, string> = { action: kind }
    if (note.trim()) payload.note = note.trim()
    if (result.trim()) payload.result = result.trim()
    if (nextFollowUpValue) payload.next_follow_up_at = nextFollowUpValue

    const response = await fetch(`/api/opportunities/${opportunityId}/inside-sales-follow-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to save follow-up')
    }
  }

  async function loadSchedulingData() {
    if (scheduleDataLoaded) return
    const response = await fetch('/api/canvass/data', { credentials: 'same-origin' })
    if (!response.ok) throw new Error('Failed to load scheduling options')
    const data = await response.json()
    setScheduleUsers(Array.isArray(data.users) ? data.users : [])
    setScheduleTeams(Array.isArray(data.teams) ? data.teams : [])
    if (typeof data.inspectionDuration === 'number' && data.inspectionDuration > 0) {
      setInspectionDuration(data.inspectionDuration)
    }
    setScheduleDataLoaded(true)
  }

  function resetForm() {
    setAction(null)
    setResult('')
    setNote('')
    setNextFollowUpValue('')
    setError(null)
  }

  function handleQuickAction(kind: Exclude<ActionKind, null>) {
    setAction(kind)
    setResult('')
    setNote('')
    setError(null)
  }

  function handleSave(kind: Exclude<ActionKind, null>) {
    startTransition(async () => {
      try {
        await submitAction(kind)
        resetForm()
        setScheduleError(null)
        onFollowUpCompleted?.()
        setOpen(false)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save follow-up')
      }
    })
  }

  function handleClaimSelf() {
    startTransition(async () => {
      try {
        await submitAction('claim_self')
        setScheduleError(null)
        onFollowUpCompleted?.()
        setOpen(false)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to claim follow-up')
      }
    })
  }

  function handleOpenSchedule() {
    startTransition(async () => {
      try {
        await loadSchedulingData()
        setError(null)
        setScheduleError(null)
        setScheduleModalOpen(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load scheduling options')
      }
    })
  }

  function handleScheduleConfirm(confirm: CloseScheduleConfirm) {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/opportunities/${opportunityId}/inside-sales-follow-up`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'schedule_back_to_closer',
            note: scheduleNote.trim(),
            schedule: confirm,
          }),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || 'Failed to schedule back to closer')
        }
        setScheduleError(null)
        setScheduleModalOpen(false)
        setScheduleNote('')
        onFollowUpCompleted?.()
        setOpen(false)
        router.refresh()
      } catch (err) {
        setScheduleError(err instanceof Error ? err.message : 'Failed to schedule back to closer')
      }
    })
  }

  return (
    <>
      <div className="mb-4 sm:mb-6 rounded-xl border border-amber-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                {followUpBadgeLabel}
              </span>
              <span className="text-sm font-semibold text-gray-900">{headline}</span>
            </div>
            <p className="mt-2 text-sm text-gray-700">
              {customerPhone && phoneDigits ? (
                <a href={`tel:${phoneDigits}`} className="font-medium text-indigo-700 hover:underline">
                  {customerPhone}
                </a>
              ) : (
                <span>No phone on file</span>
              )}
              <span className="text-gray-500">
                {assignedToName ? ` · Assigned: ${assignedToName}` : ' · Unassigned'}
              </span>
            </p>
            <p className="mt-1 text-xs text-gray-600">
              {callableNow && (
                <span className="font-medium text-emerald-800">Dial when ready.</span>
              )}
              {!callableNow && eligibleAtIso && (
                <>
                  Opens{' '}
                  <span className="font-semibold text-gray-900">
                    {new Date(eligibleAtIso).toLocaleString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                  {adminHandoffDelayDays != null ? (
                    <span className="text-gray-600"> ({adminHandoffDelayDays}-day rule)</span>
                  ) : null}
                </>
              )}
              {!callableNow && !eligibleAtIso && (
                <span className="text-gray-600">Ask a manager if timing looks off.</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex shrink-0 items-center rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-600"
          >
            Work this customer
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/25" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b px-5 py-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-amber-700">{drawerEyebrow}</p>
                <h2 className="mt-1 text-xl font-bold text-gray-900">{customerName}</h2>
                <p className="mt-1 text-sm text-gray-600">
                  {customerPhone && phoneDigits ? (
                    <a href={`tel:${phoneDigits}`} className="font-medium text-indigo-700 hover:underline">
                      {customerPhone}
                    </a>
                  ) : (
                    'No phone on file'
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-amber-800">Status</p>
                    <p className="mt-1 font-medium text-gray-900 capitalize">{statusLabel}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-amber-800">Assigned To</p>
                    <p className="mt-1 font-medium text-gray-900">{assignedToName || 'Unassigned'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-amber-800">
                      {!callableNow && eligibleAtIso ? 'Call opens' : 'Next follow-up'}
                    </p>
                    <p className="mt-1 font-medium text-gray-900">
                      {!callableNow && eligibleAtIso
                        ? new Date(eligibleAtIso).toLocaleString(undefined, {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })
                        : nextFollowUpAt
                          ? new Date(nextFollowUpAt).toLocaleString()
                          : adminHandoffDelayDays != null
                            ? `${adminHandoffDelayDays}-day rule from inspection`
                            : 'Not set'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-amber-800">Phone</p>
                    <p className="mt-1 font-medium text-gray-900">{customerPhone || '—'}</p>
                  </div>
                </div>
                {closerNotes && (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-white/80 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-amber-800">Closer Notes</p>
                    <p className="mt-1 text-sm text-gray-800 whitespace-pre-wrap">{closerNotes}</p>
                  </div>
                )}
                {!callableNow && eligibleAtIso && (
                  <p className="mt-3 text-xs text-gray-600">
                    Easiest flow: wait until the time above (company rule). Early call OK only if a manager said so.
                  </p>
                )}
              </div>

              {canManage && (
                <div className="mt-5 rounded-xl border bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-gray-900">Actions</h3>
                    {!assignedToName && canSelfAssign && (
                      <button
                        type="button"
                        onClick={handleClaimSelf}
                        disabled={isPending}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Assign to me
                      </button>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => handleQuickAction('log_call')} className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200">Log call</button>
                    <button type="button" onClick={() => handleQuickAction('log_text')} className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200">Log text</button>
                    <button type="button" onClick={handleOpenSchedule} className="rounded-lg bg-indigo-100 px-3 py-2 text-sm font-medium text-indigo-900 hover:bg-indigo-200">Schedule back to closer</button>
                    <button type="button" onClick={() => handleQuickAction('mark_rescheduled')} className="rounded-lg bg-emerald-100 px-3 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-200">Rescheduled</button>
                    <button type="button" onClick={() => handleQuickAction('mark_unresponsive')} className="rounded-lg bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-200">Unresponsive</button>
                    <button type="button" onClick={() => handleQuickAction('mark_lost')} className="rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-200">Lost</button>
                  </div>

                  <div className="mt-4 rounded-lg border border-gray-200 p-4">
                    <p className="text-sm font-semibold text-gray-900">Closer briefing note</p>
                    <p className="mt-1 text-xs text-gray-500">
                      This note goes onto the scheduled inspection and the closer&apos;s calendar event.
                    </p>
                    <textarea
                      value={scheduleNote}
                      onChange={(e) => setScheduleNote(e.target.value)}
                      rows={3}
                      placeholder={schedulePlaceholder}
                      className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none"
                    />
                    {scheduleError && <p className="mt-3 text-sm text-red-600">{scheduleError}</p>}
                  </div>

                  {action && (
                    <div className="mt-4 rounded-lg border border-gray-200 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-900">
                          {action === 'log_call'
                            ? 'Log call result'
                            : action === 'log_text'
                              ? 'Log text result'
                              : action === 'mark_rescheduled'
                                ? 'Mark rescheduled'
                                : action === 'mark_unresponsive'
                                  ? 'Mark unresponsive'
                                  : 'Mark lost'}
                        </p>
                        <button type="button" onClick={resetForm} className="text-sm text-gray-500 hover:text-gray-700">
                          Cancel
                        </button>
                      </div>

                      {resultOptions.length > 0 && (
                        <div className="mt-3">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Result</label>
                          <select
                            value={result}
                            onChange={(e) => setResult(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                          >
                            <option value="">Select result</option>
                            {resultOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="mt-3">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Next follow-up</label>
                        <input
                          type="datetime-local"
                          value={nextFollowUpValue}
                          onChange={(e) => setNextFollowUpValue(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div className="mt-3">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Note</label>
                        <textarea
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          rows={3}
                          placeholder="Add a short note..."
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none"
                        />
                      </div>

                      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

                      <div className="mt-4 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleSave(action)}
                          disabled={isPending}
                          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          {isPending ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-5">
                <h3 className="text-sm font-semibold text-gray-900">Recent Activity</h3>
                <div className="mt-3 space-y-3">
                  {recentActivities.length > 0 ? (
                    recentActivities.map((activity) => {
                      const author = Array.isArray(activity.users)
                        ? activity.users[0]?.full_name
                        : activity.users?.full_name

                      return (
                        <div key={activity.id} className="rounded-lg border border-gray-200 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-gray-900 capitalize">
                              {activity.type.replace(/_/g, ' ')}
                            </p>
                            <p className="text-xs text-gray-500">{new Date(activity.created_at).toLocaleString()}</p>
                          </div>
                          <p className="mt-1 text-sm text-gray-700">{activity.body || '—'}</p>
                          <p className="mt-1 text-xs text-gray-500">{author || 'Unknown user'}</p>
                        </div>
                      )
                    })
                  ) : (
                    <p className="text-sm text-gray-500">No follow-up activity yet.</p>
                  )}
                </div>
              </div>
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
    </>
  )
}
