'use client'

import { useState, useEffect } from 'react'

type TimeSlot = { time: string; display: string; available: boolean }

export type CloseScheduleConfirm = {
  /** Local datetime string YYYY-MM-DDTHH:MM (same as canvass availability API) */
  scheduledLocal: string
  useRoundRobin: boolean
  teamId?: string
  closerUserId?: string
}

type Props = {
  open: boolean
  onClose: () => void
  onConfirm: (params: CloseScheduleConfirm) => void
  closeDurationMinutes: number
  users: Array<{ id: string; full_name: string; has_calendar?: boolean }>
  teams: Array<{ id: string; name: string }>
}

export default function CloseScheduleModal({
  open,
  onClose,
  onConfirm,
  closeDurationMinutes,
  users,
  teams,
}: Props) {
  const [selectedCloser, setSelectedCloser] = useState('')
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [slotsError, setSlotsError] = useState<string | null>(null)
  const [closerTimezone, setCloserTimezone] = useState('America/New_York')

  useEffect(() => {
    if (!open) {
      setSelectedCloser('')
      setSelectedDate('')
      setSelectedTime('')
      setTimeSlots([])
      setSlotsError(null)
    }
  }, [open])

  useEffect(() => {
    if (selectedCloser && selectedDate && open) {
      setSlotsError(null)
      loadTimeSlots(selectedCloser, selectedDate)
    } else {
      setTimeSlots([])
      setSlotsError(null)
    }
  }, [selectedCloser, selectedDate, open, closeDurationMinutes])

  useEffect(() => {
    setSelectedDate('')
    setSelectedTime('')
    setTimeSlots([])
  }, [selectedCloser])

  const getDateOptions = () => {
    const formatLocalYmd = (date: Date) => {
      const y = date.getFullYear()
      const m = String(date.getMonth() + 1).padStart(2, '0')
      const d = String(date.getDate()).padStart(2, '0')
      return `${y}-${m}-${d}`
    }

    const dates: { value: string; label: string }[] = []
    const today = new Date()
    for (let i = 0; i < 7; i++) {
      const date = new Date(today)
      date.setDate(today.getDate() + i)
      dates.push({
        value: formatLocalYmd(date),
        label:
          i === 0
            ? 'Today'
            : i === 1
              ? 'Tomorrow'
              : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      })
    }
    return dates
  }

  const loadTimeSlots = async (closerOrTeamId: string, date: string, isRetry = false) => {
    setLoadingSlots(true)
    setSlotsError(null)
    try {
      let res: Response
      const d = closeDurationMinutes
      if (closerOrTeamId.startsWith('team:')) {
        const teamId = closerOrTeamId.replace('team:', '')
        res = await fetch(`/api/canvass/team-availability?team_id=${teamId}&date=${date}&duration=${d}`)
      } else {
        res = await fetch(`/api/canvass/availability?closer_id=${closerOrTeamId}&date=${date}&duration=${d}`)
      }

      if (res.ok) {
        const data = await res.json()
        const slots = data.slots || []
        setTimeSlots(slots)
        setCloserTimezone(data.timezone || 'America/New_York')
        if (slots.length === 0 && !isRetry && data.hasCalendar !== false) {
          await new Promise((r) => setTimeout(r, 800))
          await loadTimeSlots(closerOrTeamId, date, true)
        }
      } else {
        const errData = await res.json().catch(() => ({}))
        setSlotsError((errData as { error?: string }).error || `Failed to load (${res.status})`)
        setTimeSlots([])
      }
    } catch {
      setSlotsError('Network error. Try again.')
      setTimeSlots([])
    } finally {
      setLoadingSlots(false)
    }
  }

  const handleConfirm = () => {
    if (!selectedTime || !selectedCloser) return

    if (selectedCloser.startsWith('team:')) {
      onConfirm({
        scheduledLocal: selectedTime,
        useRoundRobin: true,
        teamId: selectedCloser.replace('team:', ''),
      })
      return
    }

    onConfirm({
      scheduledLocal: selectedTime,
      useRoundRobin: false,
      closerUserId: selectedCloser,
    })
  }

  const hasTeams = teams.length > 0
  const hasUsers = users.length > 0

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-xl">
        <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50">
          <h2 className="font-semibold text-lg text-gray-900">Schedule close appointment</h2>
          <button type="button" onClick={onClose} className="p-2 -mr-2 text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <p className="text-sm text-gray-600">
            Same options as the canvass app: pick a <strong>team</strong> for round-robin assignment, or an{' '}
            <strong>individual closer</strong> for a named rep. Then choose a free slot ({closeDurationMinutes}{' '}
            min close duration from Admin → Scheduling).
          </p>

          {!hasTeams && !hasUsers && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              No teams or closers loaded. Ask an admin to configure teams and users who can receive appointments.
            </p>
          )}

          {(hasTeams || hasUsers) && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">Assign to</label>
                <select
                  value={selectedCloser}
                  onChange={(e) => setSelectedCloser(e.target.value)}
                  className="w-full px-4 py-3 border rounded-xl bg-white text-gray-900 focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select team or closer…</option>
                  {hasTeams && (
                    <optgroup label="Teams (round-robin)">
                      {teams.map((team) => (
                        <option key={`team:${team.id}`} value={`team:${team.id}`}>
                          {team.name} (auto-assign)
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {hasUsers && (
                    <optgroup label="Individual closers">
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.full_name} {u.has_calendar ? '✓' : '(no calendar)'}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              {selectedCloser && (
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">Date</label>
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {getDateOptions().map((date) => (
                      <button
                        key={date.value}
                        type="button"
                        onClick={() => setSelectedDate(date.value)}
                        className={`flex-shrink-0 px-4 py-2 rounded-lg border text-sm font-medium ${
                          selectedDate === date.value
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                            : 'border-gray-200 bg-white text-gray-900'
                        }`}
                      >
                        {date.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selectedDate && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-900">
                      Time ({closerTimezone.replace('America/', '').replace('_', ' ')})
                    </label>
                    {!loadingSlots && selectedCloser && (
                      <button
                        type="button"
                        onClick={() => loadTimeSlots(selectedCloser, selectedDate)}
                        className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                      >
                        Refresh
                      </button>
                    )}
                  </div>
                  {loadingSlots ? (
                    <div className="flex items-center justify-center py-6 text-gray-500 text-sm">
                      Loading available times…
                    </div>
                  ) : slotsError ? (
                    <div className="py-3 px-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                      {slotsError}
                    </div>
                  ) : timeSlots.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                      {timeSlots.map((slot) => (
                        <button
                          key={slot.time}
                          type="button"
                          disabled={!slot.available}
                          onClick={() => setSelectedTime(slot.time)}
                          className={`px-3 py-2 rounded-lg text-sm font-medium ${
                            selectedTime === slot.time
                              ? 'bg-indigo-600 text-white'
                              : slot.available
                                ? 'bg-white border border-gray-200 text-gray-900 hover:border-indigo-300'
                                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          }`}
                        >
                          {slot.display}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 text-center py-4">No slots. Try another date or Refresh.</p>
                  )}
                </div>
              )}

              {selectedTime && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-800">
                  Close will be booked for the selected slot using your choice above.
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t bg-gray-50 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 rounded-xl font-medium border border-gray-300 text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!selectedTime || !selectedCloser}
            onClick={handleConfirm}
            className="flex-1 py-3 rounded-xl font-semibold bg-indigo-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700"
          >
            Use this slot
          </button>
        </div>
      </div>
    </div>
  )
}
