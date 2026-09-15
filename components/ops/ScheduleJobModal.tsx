'use client'

import { useState } from 'react'

import { INSTALL_DAY_OPTIONS, TRADE_LABELS, formatInstallDays, type InstallDays, type Trade } from '@/lib/job-trades'

/** One trade (crew) of a job, as the modal needs it. */
export interface ScheduleTrade {
  id: string
  trade: Trade
  scheduled_date: string | null
  scheduled_time_start: string | null
  install_days: number | null
  assigned_sub_id: string | null
}

interface SubContractor {
  id: string
  company_name: string
  services: string[]
}

interface Props {
  trade: ScheduleTrade
  jobLabel: string
  subs: SubContractor[]
  onClose: () => void
  onSave: () => void
}

/** Match admin-entered service labels (e.g. "Gutter", "Gutters") to a trade/job type slug (e.g. gutters). */
export function subServicesMatchJobType(services: string[] | null | undefined, jobType: string): boolean {
  if (!services || services.length === 0) return true
  const j = jobType.toLowerCase().trim()
  if (!j || j === 'mixed' || j === 'other') return true

  const variants: string[] = [j]
  const jAlt = j.endsWith('s') && j.length > 2 ? j.slice(0, -1) : `${j}s`
  if (!variants.includes(jAlt)) variants.push(jAlt)

  return services.some((raw) => {
    const low = raw.trim().toLowerCase()
    return Boolean(low) && variants.some((v) => v && low.includes(v))
  })
}

const HALF_DAY_STARTS: { value: string; label: string }[] = [
  { value: '07:00', label: '7:00 AM' },
  { value: '08:00', label: '8:00 AM' },
  { value: '09:00', label: '9:00 AM' },
  { value: '10:00', label: '10:00 AM' },
  { value: '12:00', label: '12:00 PM' },
  { value: '13:00', label: '1:00 PM' },
]

/** Browser-local today as YYYY-MM-DD (input `min` only). */
function todayIsoLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Schedule (or reschedule / reassign) ONE trade: date, crew time on site
 * (½, 1, 1½, 2 days — ops-selected), a start time for a ½ day, and the sub.
 * Goes through the single install write path, which syncs that trade's invite.
 */
export default function ScheduleJobModal({ trade, jobLabel, subs, onClose, onSave }: Props) {
  const [selectedSubId, setSelectedSubId] = useState(trade.assigned_sub_id || '')
  const [scheduledDate, setScheduledDate] = useState(trade.scheduled_date || '')
  const [installDays, setInstallDays] = useState<InstallDays>(
    (INSTALL_DAY_OPTIONS as readonly number[]).includes(Number(trade.install_days))
      ? (Number(trade.install_days) as InstallDays)
      : 1
  )
  const [halfDayStart, setHalfDayStart] = useState((trade.scheduled_time_start || '08:00').slice(0, 5))
  const [showAllSubs, setShowAllSubs] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matchingSubs = subs.filter((sub) => subServicesMatchJobType(sub.services, trade.trade))
  const visibleSubs = showAllSubs ? subs : matchingSubs
  const hiddenCount = subs.length - matchingSubs.length

  const handleSave = async () => {
    if (!scheduledDate) return setError('Pick a date')
    if (!selectedSubId) return setError('Pick a sub-contractor')
    setError(null)
    setSaving(true)
    try {
      const response = await fetch('/api/ops/install-schedule/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workOrderId: trade.id,
          subId: selectedSubId,
          scheduledDate,
          installDays,
          ...(installDays === 0.5 ? { scheduledTimeStart: halfDayStart } : {}),
        }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok) throw new Error(result?.error || 'Failed to schedule')

      // Say what actually happened. The trade is scheduled either way — the
      // calendar invite is best-effort, and claiming one was sent when it wasn't
      // is worse than saying nothing.
      if (result?.calendar === 'synced' && !result?.subNotified) {
        alert('Scheduled, but the sub was not notified — add a scheduling email to their record to send invites.')
      } else if (result?.calendar === 'no_token') {
        alert('Scheduled. No calendar invite was sent — no Google account is connected for install scheduling.')
      } else if (result?.calendar === 'failed') {
        alert('Scheduled, but the Google Calendar invite failed to send. Notify the sub directly.')
      }
      onSave()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to schedule')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col">
        <div className="p-5 sm:p-6 border-b">
          <h2 className="text-xl font-bold text-[#2c2c2a]">
            {trade.scheduled_date ? 'Change' : 'Schedule'} {TRADE_LABELS[trade.trade]}
          </h2>
          <p className="text-[#57574f] text-sm mt-1">{jobLabel}</p>
        </div>

        <div className="p-5 sm:p-6 space-y-5 overflow-y-auto">
          <div>
            <label htmlFor="trade-date" className="block text-sm font-medium text-[#2c2c2a] mb-2">
              Start date *
            </label>
            <input
              id="trade-date"
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="w-full min-h-[44px] px-4 py-2 border border-gray-300 rounded-lg text-[#2c2c2a]"
              min={trade.scheduled_date && trade.scheduled_date < todayIsoLocal() ? undefined : todayIsoLocal()}
            />
          </div>

          <div>
            <span className="block text-sm font-medium text-[#2c2c2a] mb-2">Crew time on site *</span>
            <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Crew time on site">
              {INSTALL_DAY_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={installDays === d}
                  onClick={() => setInstallDays(d)}
                  className={`min-h-[44px] rounded-lg border text-sm font-medium ${
                    installDays === d
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-gray-300 bg-white text-[#2c2c2a] hover:bg-gray-50'
                  }`}
                >
                  {formatInstallDays(d)}
                </button>
              ))}
            </div>
            {installDays === 1.5 && (
              <p className="mt-2 text-xs text-[#57574f]">Blocks both days on the crew&apos;s calendar.</p>
            )}
          </div>

          {installDays === 0.5 && (
            <div>
              <label htmlFor="trade-start" className="block text-sm font-medium text-[#2c2c2a] mb-2">
                Start time
              </label>
              <select
                id="trade-start"
                value={halfDayStart}
                onChange={(e) => setHalfDayStart(e.target.value)}
                className="w-full min-h-[44px] px-4 py-2 border border-gray-300 rounded-lg text-[#2c2c2a]"
              >
                {HALF_DAY_STARTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-[#57574f]">Sent as a 4-hour block.</p>
            </div>
          )}

          <div>
            <span className="block text-sm font-medium text-[#2c2c2a] mb-2">Sub-contractor *</span>
            <div className="space-y-2">
              {visibleSubs.length === 0 ? (
                <div className="text-center py-5 bg-gray-50 rounded-lg">
                  <p className="text-[#2c2c2a] text-sm">No sub-contractors are tagged for {TRADE_LABELS[trade.trade]}.</p>
                  <a href="/admin/subs" className="text-indigo-700 text-sm hover:underline">
                    Manage sub-contractors →
                  </a>
                </div>
              ) : (
                visibleSubs.map((sub) => (
                  <label
                    key={sub.id}
                    className={`flex min-h-[48px] items-center gap-3 p-3 border rounded-lg cursor-pointer transition ${
                      selectedSubId === sub.id ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="sub"
                      checked={selectedSubId === sub.id}
                      onChange={() => setSelectedSubId(sub.id)}
                      className="sr-only"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[#2c2c2a] truncate">{sub.company_name}</div>
                      {sub.services && sub.services.length > 0 && (
                        <div className="text-xs text-[#57574f] truncate">{sub.services.join(', ')}</div>
                      )}
                    </div>
                    {selectedSubId === sub.id && <span className="text-orange-700 font-bold" aria-hidden>✓</span>}
                  </label>
                ))
              )}
            </div>
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAllSubs((v) => !v)}
                className="mt-2 min-h-[44px] text-sm text-indigo-700 hover:underline"
              >
                {showAllSubs ? `Only ${TRADE_LABELS[trade.trade]} subs` : `Show all subs (${hiddenCount} more)`}
              </button>
            )}
          </div>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="p-5 sm:p-6 border-t flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-[#2c2c2a]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="min-h-[44px] px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
