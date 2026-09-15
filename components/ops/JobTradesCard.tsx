'use client'

import { useCallback, useEffect, useState } from 'react'

import ScheduleJobModal, { type ScheduleTrade } from '@/components/ops/ScheduleJobModal'
import { finalPhotoTagLabel } from '@/lib/final-photo-tags'
import { TRADES, TRADE_LABELS, formatInstallDays, formatWallClock12h, type Trade } from '@/lib/job-trades'

/** Shape returned by GET /api/ops/jobs/[id]/trades. */
export interface JobTradeView {
  id: string
  work_order_number: string
  trade: Trade
  trade_source: 'auto' | 'manual' | null
  status: string
  scheduled_date: string | null
  scheduled_time_start: string | null
  install_days: number | null
  completed_at: string | null
  sub: { id: string; company_name: string; phone: string | null; has_scheduling_email: boolean } | null
  calendar_sync_error: string | null
  has_calendar_event: boolean
  missing_photo_tags: string[]
  photo_count: number
  crew_link_url: string | null
}

interface SubContractor {
  id: string
  company_name: string
  services: string[]
}

interface Props {
  jobId: string
  jobLabel: string
  /** Job cancelled → read only. */
  readOnly?: boolean
  /** Called after any change, and with the loaded list, so the page can refresh job status. */
  onTradesChange?: (trades: JobTradeView[], changed: boolean) => void
}

function formatTradeDate(iso: string): string {
  // Bare YYYY-MM-DD: anchor at UTC noon and format in UTC so no timezone shifts the day.
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * Schedule & crews — one row per trade (roofing, gutters, siding, …). Each crew
 * has its own day(s), sub, invite and photo link, and is marked done on its own
 * as it finishes. Replaces the single "who and when" card.
 */
export default function JobTradesCard({ jobId, jobLabel, readOnly = false, onTradesChange }: Props) {
  const [trades, setTrades] = useState<JobTradeView[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [subs, setSubs] = useState<SubContractor[]>([])
  const [scheduling, setScheduling] = useState<ScheduleTrade | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [addTrade, setAddTrade] = useState<Trade | ''>('')
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null)

  const load = useCallback(
    async (changed = false) => {
      try {
        const res = await fetch(`/api/ops/jobs/${jobId}/trades`, { cache: 'no-store' })
        const data = await res.json().catch(() => null)
        if (!res.ok) throw new Error(data?.error || 'Failed to load crews')
        const list = (data?.trades ?? []) as JobTradeView[]
        setTrades(list)
        setCanEdit(Boolean(data?.canEdit))
        setLoadError(null)
        onTradesChange?.(list, changed)
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : 'Failed to load crews')
      } finally {
        setLoading(false)
      }
    },
    [jobId, onTradesChange]
  )

  useEffect(() => {
    void load()
  }, [load])

  const editable = canEdit && !readOnly

  async function openSchedule(t: JobTradeView) {
    try {
      const res = await fetch('/api/ops/scheduling-assignees')
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data.subs)) setSubs(data.subs)
      }
    } catch {
      /* keep the last list */
    }
    setScheduling({
      id: t.id,
      trade: t.trade,
      scheduled_date: t.scheduled_date,
      scheduled_time_start: t.scheduled_time_start,
      install_days: t.install_days,
      assigned_sub_id: t.sub?.id ?? null,
    })
  }

  async function act(t: JobTradeView, action: 'complete' | 'reopen' | 'remove', override = false) {
    setBusyId(t.id)
    setNotice(null)
    try {
      const res = await fetch(`/api/ops/jobs/${jobId}/trades`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workOrderId: t.id, action, override }),
      })
      const data = await res.json().catch(() => null)
      if (res.status === 409 && action === 'complete' && Array.isArray(data?.missingPhotoTags)) {
        const missing = (data.missingPhotoTags as string[]).map((tag) => finalPhotoTagLabel(tag)).join(', ')
        if (window.confirm(`${TRADE_LABELS[t.trade]} is missing photos: ${missing}.\n\nMark it done anyway?`)) {
          setBusyId(null)
          return act(t, 'complete', true)
        }
        return
      }
      if (!res.ok) throw new Error(data?.error || 'Update failed')
      if (data?.calendarWarning) setNotice({ tone: 'warn', text: data.calendarWarning })
      await load(true)
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : 'Update failed' })
    } finally {
      setBusyId(null)
    }
  }

  async function unschedule(t: JobTradeView) {
    if (
      !window.confirm(
        `Take ${TRADE_LABELS[t.trade]} off the schedule?${t.sub ? `\n\n${t.sub.company_name} is sent a cancellation.` : ''}`
      )
    )
      return
    setBusyId(t.id)
    setNotice(null)
    try {
      const res = await fetch('/api/ops/install-schedule/unassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workOrderId: t.id }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Failed to unschedule')
      if (data?.calendarWarning) setNotice({ tone: 'warn', text: data.calendarWarning })
      await load(true)
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : 'Failed to unschedule' })
    } finally {
      setBusyId(null)
    }
  }

  async function remove(t: JobTradeView) {
    if (!window.confirm(`Remove ${TRADE_LABELS[t.trade]} from this job?`)) return
    await act(t, 'remove')
  }

  async function submitAddTrade() {
    if (!addTrade) return
    setBusyId('add')
    setNotice(null)
    try {
      const res = await fetch(`/api/ops/jobs/${jobId}/trades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trade: addTrade }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Failed to add trade')
      setAddTrade('')
      await load(true)
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : 'Failed to add trade' })
    } finally {
      setBusyId(null)
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setNotice({ tone: 'ok', text: 'Crew photo link copied.' })
    } catch {
      window.prompt('Copy the crew photo link:', url)
    }
  }

  const doneCount = trades.filter((t) => t.status === 'completed').length

  return (
    <div id="job-trades" className="bg-white rounded-xl shadow-sm border p-4 sm:p-6 scroll-mt-20">
      <div className="flex items-start justify-between gap-3 mb-4">
        <h2 className="text-base sm:text-lg font-semibold text-[#2c2c2a]">Schedule &amp; Crews</h2>
        {trades.length > 1 && (
          <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-[#2c2c2a]">
            {doneCount}/{trades.length} done
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-[#57574f]">Loading…</p>
      ) : loadError ? (
        <p className="text-sm text-red-800">{loadError}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {trades.length === 0 && <li className="py-3 text-sm text-[#57574f]">No crews on this job yet.</li>}
          {trades.map((t) => {
            const done = t.status === 'completed'
            const busy = busyId === t.id
            const requiredDone = 4 - t.missing_photo_tags.length
            return (
              <li key={t.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold text-[#2c2c2a]">{TRADE_LABELS[t.trade]}</span>
                      {done ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">
                          Done
                        </span>
                      ) : t.scheduled_date ? (
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-900">
                          Scheduled
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                          Not scheduled
                        </span>
                      )}
                    </div>
                    {t.scheduled_date && (
                      <p className="mt-1 text-sm text-[#2c2c2a]">
                        {formatTradeDate(t.scheduled_date)} · {formatInstallDays(t.install_days)}
                        {t.install_days === 0.5 && t.scheduled_time_start
                          ? ` · starts ${formatWallClock12h(t.scheduled_time_start)}`
                          : ''}
                      </p>
                    )}
                    {t.sub && (
                      <p className="mt-0.5 text-sm text-[#2c2c2a]">
                        {t.sub.company_name}
                        {t.sub.phone && (
                          <>
                            {' · '}
                            <a href={`tel:${t.sub.phone}`} className="text-indigo-700 hover:underline">
                              {t.sub.phone}
                            </a>
                          </>
                        )}
                      </p>
                    )}
                    {t.sub && !t.sub.has_scheduling_email && !done && (
                      <p className="mt-0.5 text-xs font-medium text-[#9a3412]">No scheduling email — sub isn&apos;t sent the invite</p>
                    )}
                    {t.calendar_sync_error && (
                      <p className="mt-0.5 text-xs font-medium text-[#9a3412]">Calendar invite failed — reschedule to retry</p>
                    )}
                    {t.scheduled_date && (
                      <p className={`mt-0.5 text-xs ${requiredDone === 4 ? 'text-emerald-800' : 'text-[#57574f]'}`}>
                        Photos {requiredDone}/4{t.photo_count > requiredDone ? ` · ${t.photo_count} total` : ''}
                      </p>
                    )}
                  </div>
                </div>

                {editable && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!done && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void openSchedule(t)}
                        className={`min-h-[44px] rounded-lg px-3 text-sm font-medium disabled:opacity-50 ${
                          t.scheduled_date
                            ? 'border border-gray-300 text-[#2c2c2a] hover:bg-gray-50'
                            : 'bg-indigo-600 text-white hover:bg-indigo-700'
                        }`}
                      >
                        {t.scheduled_date ? 'Change' : 'Schedule'}
                      </button>
                    )}
                    {!done && t.scheduled_date && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void act(t, 'complete')}
                        className="min-h-[44px] rounded-lg bg-emerald-700 px-3 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                      >
                        Mark done
                      </button>
                    )}
                    {t.crew_link_url && !done && (
                      <button
                        type="button"
                        onClick={() => void copyLink(t.crew_link_url as string)}
                        className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm font-medium text-[#2c2c2a] hover:bg-gray-50"
                      >
                        Copy crew photo link
                      </button>
                    )}
                    {done && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void act(t, 'reopen')}
                        className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm font-medium text-[#2c2c2a] hover:bg-gray-50 disabled:opacity-50"
                      >
                        Reopen
                      </button>
                    )}
                    {!done && t.scheduled_date && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void unschedule(t)}
                        className="min-h-[44px] rounded-lg px-3 text-sm font-medium text-[#57574f] hover:text-red-700 disabled:opacity-50"
                      >
                        Unschedule
                      </button>
                    )}
                    {!done && !t.scheduled_date && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void remove(t)}
                        className="min-h-[44px] rounded-lg px-3 text-sm font-medium text-[#57574f] hover:text-red-700 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {editable && !loading && !loadError && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
          <label htmlFor="add-trade" className="sr-only">
            Add a trade
          </label>
          <select
            id="add-trade"
            value={addTrade}
            onChange={(e) => setAddTrade(e.target.value as Trade | '')}
            className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm text-[#2c2c2a]"
          >
            <option value="">Add a trade…</option>
            {TRADES.map((tr) => (
              <option key={tr} value={tr}>
                {TRADE_LABELS[tr]}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!addTrade || busyId === 'add'}
            onClick={() => void submitAddTrade()}
            className="min-h-[44px] rounded-lg border border-indigo-300 px-3 text-sm font-medium text-indigo-800 hover:bg-indigo-50 disabled:opacity-50"
          >
            + Add
          </button>
        </div>
      )}

      {notice && (
        <p
          role="status"
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            notice.tone === 'ok'
              ? 'bg-emerald-50 text-emerald-900'
              : notice.tone === 'warn'
                ? 'bg-amber-50 text-amber-900'
                : 'bg-red-50 text-red-900'
          }`}
        >
          {notice.text}
        </p>
      )}

      {scheduling && (
        <ScheduleJobModal
          trade={scheduling}
          jobLabel={jobLabel}
          subs={subs}
          onClose={() => setScheduling(null)}
          onSave={() => {
            setScheduling(null)
            void load(true)
          }}
        />
      )}
    </div>
  )
}
