'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'
import { isPromptEscalated } from '@/lib/inspection-feedback-prompt'

/** YYYY-MM-DD in org default timezone (ET) for calendar comparisons */
function dateKeyEt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: DEFAULT_TIMEZONE })
}

interface PendingFeedback {
  id: string
  appointment_id: string
  closer_user_id: string
  prompt_at: string
  completed: boolean
  dismissed: boolean
  snooze_count: number
  created_at: string
  closer?: { full_name: string }
  appointment?: {
    scheduled_for: string
    lead?: { homeowner_name: string; address_text: string }
  }
}

interface CompletedFeedback {
  id: string
  appointment_id: string
  opportunity_id: string
  closer_user_id: string
  setter_user_id: string
  outcome: string
  notes: string | null
  setter_feedback: string | null
  completed_at: string
  closer?: { full_name: string }
  setter?: { full_name: string }
  lead?: { homeowner_name: string; address_text: string }
}

export default function InspectionFeedbackAdmin() {
  const [pendingFeedback, setPendingFeedback] = useState<PendingFeedback[]>([])
  const [completedFeedback, setCompletedFeedback] = useState<CompletedFeedback[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'pending' | 'completed'>('pending')
  const [pendingFilter, setPendingFilter] = useState<'all' | 'overdue' | 'snoozed'>('all')

  const isOverdue = useCallback((item: PendingFeedback) => {
    const nowMs = Date.now()
    const todayEt = new Date().toLocaleDateString('en-CA', { timeZone: DEFAULT_TIMEZONE })
    const promptMs = item.prompt_at ? new Date(item.prompt_at).getTime() : 0
    const staleWaiting = promptMs > 0 && nowMs - promptMs > 24 * 60 * 60 * 1000
    const appt = item.appointment?.scheduled_for
    const apptDayBeforeTodayEt = !!appt && dateKeyEt(appt) < todayEt
    return staleWaiting || apptDayBeforeTodayEt
  }, [])

  const isLocked = useCallback(
    (item: PendingFeedback) => isPromptEscalated(item.snooze_count),
    []
  )

  // `dismissed` stays true forever once set (only resend/reassignment clear it) — it means
  // "still snoozed right now" only while prompt_at (the resurface timer) hasn't come due again.
  const isStillSnoozed = useCallback(
    (item: PendingFeedback) => item.dismissed && new Date(item.prompt_at).getTime() > Date.now(),
    []
  )

  const sortedPending = useMemo(() => {
    return [...pendingFeedback].sort((a, b) => {
      const aOver = isOverdue(a)
      const bOver = isOverdue(b)
      if (aOver !== bOver) return aOver ? -1 : 1
      return new Date(a.prompt_at).getTime() - new Date(b.prompt_at).getTime()
    })
  }, [pendingFeedback, isOverdue])

  const filteredPending = useMemo(() => {
    if (pendingFilter === 'overdue') return sortedPending.filter(isOverdue)
    if (pendingFilter === 'snoozed') return sortedPending.filter((i) => isLocked(i) || isStillSnoozed(i))
    return sortedPending
  }, [sortedPending, pendingFilter, isOverdue, isLocked, isStillSnoozed])

  useEffect(() => {
    loadFeedback()
  }, [])

  const loadFeedback = async () => {
    try {
      const response = await fetch('/api/admin/inspection-feedback')
      if (response.ok) {
        const data = await response.json()
        setPendingFeedback(data.pending || [])
        setCompletedFeedback(data.completed || [])
      }
    } catch (error) {
      console.error('Error loading feedback:', error)
    } finally {
      setLoading(false)
    }
  }

  const resendPrompt = async (promptId: string) => {
    setSending(promptId)
    try {
      const response = await fetch('/api/admin/inspection-feedback/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt_id: promptId }),
      })

      if (response.ok) {
        alert('Feedback request resent successfully')
        loadFeedback()
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to resend')
      }
    } catch (error) {
      console.error('Error resending:', error)
      alert('Failed to resend')
    } finally {
      setSending(null)
    }
  }

  const resendAll = async () => {
    if (!confirm(`Resend feedback requests to ${sortedPending.length} closers?`)) return
    
    setSending('all')
    try {
      const response = await fetch('/api/admin/inspection-feedback/resend-all', {
        method: 'POST',
      })

      if (response.ok) {
        const data = await response.json()
        alert(`Resent ${data.count} feedback requests`)
        loadFeedback()
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to resend')
      }
    } catch (error) {
      console.error('Error resending all:', error)
      alert('Failed to resend')
    } finally {
      setSending(null)
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: DEFAULT_TIMEZONE,
    })
  }

  const outcomeStyles: Record<string, string> = {
    sale: 'bg-green-100 text-green-700',
    moving_to_close: 'bg-emerald-100 text-emerald-700',
    insurance_follow_up: 'bg-purple-100 text-purple-700',
    said_no: 'bg-red-100 text-red-700',
    not_home: 'bg-amber-100 text-amber-700',
    no_problems_found: 'bg-gray-100 text-gray-700',
    needs_repair: 'bg-orange-100 text-orange-700',
    rescheduled: 'bg-blue-100 text-blue-700',
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      
      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <Link
            href="/admin"
            className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-2"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Admin
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Inspection Feedback</h1>
              <p className="text-gray-600 mt-1">Manage pending and completed inspection feedback</p>
            </div>
            {sortedPending.length > 0 && (
              <button
                onClick={resendAll}
                disabled={sending === 'all'}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 min-h-[44px]"
              >
                {sending === 'all' ? 'Sending...' : `Resend All (${sortedPending.length})`}
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-4 py-2 rounded-lg font-medium min-h-[44px] ${
              activeTab === 'pending'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Pending ({pendingFeedback.length})
          </button>
          <button
            onClick={() => setActiveTab('completed')}
            className={`px-4 py-2 rounded-lg font-medium min-h-[44px] ${
              activeTab === 'completed'
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Completed ({completedFeedback.length})
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : activeTab === 'pending' ? (
          /* Pending Feedback */
          sortedPending.length === 0 ? (
            <div className="bg-white rounded-xl border p-8 text-center">
              <div className="text-4xl mb-3">✓</div>
              <h3 className="text-lg font-medium text-gray-900">All caught up!</h3>
              <p className="text-gray-500 mt-1">No pending inspection feedback requests</p>
            </div>
          ) : (
            <>
              {/* Filter pills — overdue sorted first, oldest prompt_at first */}
              <div className="flex flex-wrap gap-2 mb-4">
                {(
                  [
                    { key: 'all' as const, label: 'All' },
                    { key: 'overdue' as const, label: 'Overdue' },
                    { key: 'snoozed' as const, label: 'Snoozed' },
                  ] as const
                ).map(({ key: f, label }) => {
                  const count =
                    f === 'all'
                      ? sortedPending.length
                      : f === 'overdue'
                        ? sortedPending.filter(isOverdue).length
                        : sortedPending.filter((i) => isLocked(i) || isStillSnoozed(i)).length
                  const selected = pendingFilter === f
                  const selectedClass =
                    f === 'overdue'
                      ? 'bg-red-600 text-white shadow-sm'
                      : f === 'snoozed'
                        ? 'bg-slate-700 text-white shadow-sm'
                        : 'bg-amber-600 text-white shadow-sm'
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setPendingFilter(f)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                        selected ? selectedClass : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {label}{' '}
                      <span className={selected ? 'opacity-90' : 'text-gray-400'}>({count})</span>
                    </button>
                  )
                })}
              </div>

              {filteredPending.length === 0 ? (
                <div className="bg-white rounded-xl border p-6 text-center text-sm text-gray-500">
                  {pendingFilter === 'all'
                    ? 'No prompts match this view.'
                    : pendingFilter === 'overdue'
                      ? 'No overdue prompts — everything is current or same-day.'
                      : 'No snoozed prompts.'}
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredPending.map((item) => {
                    const overdue = isOverdue(item)
                    const locked = isLocked(item)
                    const stillSnoozed = isStillSnoozed(item)
                    return (
                      <div
                        key={item.id}
                        className={`bg-white rounded-xl border p-4 flex items-center gap-4 ${
                          overdue ? 'border-red-200' : ''
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900">
                            {item.appointment?.lead?.homeowner_name || 'Unknown'}
                          </div>
                          <div className="text-sm text-gray-500 truncate">
                            {item.appointment?.lead?.address_text || 'No address'}
                          </div>
                          <div className="text-xs text-gray-400 mt-1">
                            Closer: {item.closer?.full_name || 'Unknown'} •{' '}
                            Appt: {item.appointment?.scheduled_for ? formatDate(item.appointment.scheduled_for) : 'N/A'}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="flex flex-wrap items-center justify-end gap-1.5 mb-2">
                            {overdue && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700 uppercase tracking-wide">
                                Overdue
                              </span>
                            )}
                            {locked && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-600 text-white uppercase tracking-wide">
                                Locked for rep
                              </span>
                            )}
                            {!locked && stillSnoozed && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 uppercase tracking-wide">
                                Snoozed {item.snooze_count}x
                              </span>
                            )}
                            <span className={`text-xs font-medium ${overdue ? 'text-red-600' : 'text-amber-600'}`}>
                              {locked
                                ? 'Rep must submit — resend can’t clear this'
                                : stillSnoozed
                                  ? 'Snoozed by rep'
                                  : `Prompt due ${formatDate(item.prompt_at)}`}
                            </span>
                          </div>
                          {locked ? (
                            <span className="inline-block px-3 py-1.5 rounded-lg text-sm font-medium min-h-[36px] bg-gray-100 text-gray-400 cursor-not-allowed">
                              Resend
                            </span>
                          ) : (
                            <button
                              onClick={() => resendPrompt(item.id)}
                              disabled={sending === item.id}
                              className={`px-3 py-1.5 rounded-lg text-sm font-medium min-h-[36px] disabled:opacity-50 ${
                                overdue
                                  ? 'bg-red-100 text-red-700 hover:bg-red-200'
                                  : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                              }`}
                            >
                              {sending === item.id ? 'Sending...' : 'Resend'}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )
        ) : (
          /* Completed Feedback */
          completedFeedback.length === 0 ? (
            <div className="bg-white rounded-xl border p-8 text-center">
              <p className="text-gray-500">No completed feedback in the last 7 days</p>
            </div>
          ) : (
            <div className="space-y-3">
              {completedFeedback.map((item) => {
                const outcomeStyle = outcomeStyles[item.outcome] || 'bg-gray-100 text-gray-700'
                return (
                  <div
                    key={item.id}
                    className="bg-white rounded-xl border p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-gray-900">
                            {item.lead?.homeowner_name || 'Unknown'}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${outcomeStyle}`}>
                            {item.outcome.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <div className="text-sm text-gray-500 truncate">
                          {item.lead?.address_text || 'No address'}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">
                          Closer: {item.closer?.full_name || 'Unknown'} → 
                          Setter: {item.setter?.full_name || 'Unknown'}
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 text-right">
                        {formatDate(item.completed_at)}
                      </div>
                    </div>
                    {(item.notes || item.setter_feedback) && (
                      <div className="mt-3 pt-3 border-t space-y-2">
                        {item.setter_feedback && (
                          <div className="text-sm">
                            <span className="font-medium text-gray-700">Setter Feedback:</span>{' '}
                            <span className="text-gray-600">{item.setter_feedback}</span>
                          </div>
                        )}
                        {item.notes && item.notes !== item.setter_feedback && (
                          <div className="text-sm">
                            <span className="font-medium text-gray-700">Notes:</span>{' '}
                            <span className="text-gray-600">{item.notes}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>
    </div>
  )
}
