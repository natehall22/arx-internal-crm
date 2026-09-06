'use client'

import { useState } from 'react'

interface Job {
  id: string
  job_number: string
  address_text: string
  job_type: string
  scheduled_date: string | null
  assigned_crew_id?: string | null
  assigned_sub_id?: string | null
  customer?: { name: string } | null
}

interface Crew {
  id: string
  name: string
  crew_type: string
  color: string
  daily_capacity: number
}

interface SubContractor {
  id: string
  company_name: string
  services: string[]
}

interface Props {
  job: Job
  /**
   * Retained for backward compatibility with existing callers that still fetch/pass crew
   * lists (`/admin/crews` is not being removed — see CLAUDE.md). ARX is a subcontractor-only
   * shop (no in-house crews), so this modal no longer offers a crew assignment path; the prop
   * is accepted but unused.
   */
  crews?: Crew[]
  subs: SubContractor[]
  onClose: () => void
  onSave: () => void
  /** `reassign` only updates the sub; does not change schedule date or force status. */
  mode?: 'schedule' | 'reassign'
}

/** Match admin-entered service labels (e.g. "Gutter", "Gutters") to job_type slugs (e.g. gutters). */
export function subServicesMatchJobType(services: string[] | null | undefined, jobType: string): boolean {
  if (!services || services.length === 0) return true
  const j = jobType.toLowerCase().trim()
  if (!j || j === 'mixed') return true

  const variants: string[] = [j]
  const jAlt = j.endsWith('s') && j.length > 2 ? j.slice(0, -1) : `${j}s`
  if (!variants.includes(jAlt)) variants.push(jAlt)

  const cap = jobType.charAt(0).toUpperCase() + jobType.slice(1).toLowerCase()
  const capVariants: string[] = [cap]
  const capAlt = cap.endsWith('s') && cap.length > 2 ? cap.slice(0, -1) : `${cap}s`
  if (!capVariants.includes(capAlt)) capVariants.push(capAlt)

  return services.some((raw) => {
    const s = raw.trim()
    if (!s) return false
    const low = s.toLowerCase()
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i]
      if (v && low.includes(v)) return true
    }
    for (let i = 0; i < capVariants.length; i++) {
      const c = capVariants[i]
      if (c && s.includes(c)) return true
    }
    return false
  })
}

export default function ScheduleJobModal({ job, subs, onClose, onSave, mode = 'schedule' }: Props) {
  const isReassignOnly = mode === 'reassign'
  const [selectedSubId, setSelectedSubId] = useState(job.assigned_sub_id || '')
  const [scheduledDate, setScheduledDate] = useState(job.scheduled_date?.split('T')[0] || '')
  const [scheduledTimeStart, setScheduledTimeStart] = useState('08:00')
  const [estimatedHours, setEstimatedHours] = useState('8')
  const [saving, setSaving] = useState(false)

  const relevantSubs = subs.filter((sub) => subServicesMatchJobType(sub.services, job.job_type))

  const handleSave = async () => {
    if (!isReassignOnly && !scheduledDate) {
      alert('Please select a date')
      return
    }

    if (!selectedSubId) {
      alert('Please select a sub-contractor')
      return
    }

    setSaving(true)

    try {
      // The install-schedule assign route is the single write path for scheduling —
      // it clears the legacy crew assignment, guards the status transition, and syncs
      // the sub's Google invite. The generic job PATCH touches the same columns but
      // does none of that, so scheduling must never go through it (see CLAUDE.md).
      const payload: Record<string, unknown> = {
        jobId: job.id,
        subId: selectedSubId,
      }
      if (!isReassignOnly) {
        payload.scheduledDate = scheduledDate
        payload.scheduledTimeStart = scheduledTimeStart
        payload.estimatedDurationHours = parseFloat(estimatedHours) || 8
      }

      const response = await fetch('/api/ops/install-schedule/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to schedule job')
      }

      // Say what actually happened. The job is scheduled either way — the calendar
      // invite is best-effort, and claiming one was sent when it wasn't is worse
      // than saying nothing.
      const result = await response.json().catch(() => null)
      if (result?.calendar === 'no_token') {
        alert(
          'Job scheduled. No calendar invite was sent — connect your Google account in Settings to email the sub automatically.'
        )
      } else if (result?.calendar === 'failed') {
        alert('Job scheduled, but the Google Calendar invite failed to send. Notify the sub directly.')
      }

      onSave()
    } catch (error) {
      console.error('Error scheduling job:', error)
      alert(error instanceof Error ? error.message : 'Failed to schedule job')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full">
        {/* Header */}
        <div className="p-6 border-b">
          <h2 className="text-xl font-bold text-gray-900">
            {isReassignOnly ? 'Reassign sub-contractor' : 'Schedule Job'}
          </h2>
          <p className="text-gray-500 text-sm mt-1">
            {job.job_number} • {job.customer?.name || job.address_text}
          </p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {isReassignOnly && job.scheduled_date && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-700">
              <span className="font-medium text-gray-900">Current install date: </span>
              {new Date(job.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                timeZone: 'America/New_York',
              })}
              <span className="text-gray-500"> (unchanged)</span>
            </div>
          )}

          {/* Date Selection */}
          {!isReassignOnly && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Install Date *
            </label>
            <input
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              min={new Date().toISOString().split('T')[0]}
            />
          </div>
          )}

          {/* Time & Duration */}
          {!isReassignOnly && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Start Time
              </label>
              <select
                value={scheduledTimeStart}
                onChange={(e) => setScheduledTimeStart(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              >
                <option value="06:00">6:00 AM</option>
                <option value="06:30">6:30 AM</option>
                <option value="07:00">7:00 AM</option>
                <option value="07:30">7:30 AM</option>
                <option value="08:00">8:00 AM</option>
                <option value="08:30">8:30 AM</option>
                <option value="09:00">9:00 AM</option>
                <option value="10:00">10:00 AM</option>
                <option value="11:00">11:00 AM</option>
                <option value="12:00">12:00 PM</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Est. Duration
              </label>
              <select
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              >
                <option value="2">2 hours</option>
                <option value="4">4 hours (Half Day)</option>
                <option value="6">6 hours</option>
                <option value="8">8 hours (Full Day)</option>
                <option value="12">12 hours</option>
                <option value="16">2 Days</option>
                <option value="24">3 Days</option>
              </select>
            </div>
          </div>
          )}

          {/* Assignment */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Assign To Sub-Contractor *
            </label>

            {/* Sub Selection */}
            <div className="space-y-2">
                {relevantSubs.length === 0 ? (
                  <div className="text-center py-6 bg-gray-50 rounded-lg">
                    <p className="text-gray-500 text-sm">No sub-contractors match this job type.</p>
                    <p className="text-gray-400 text-xs mt-1 px-2">
                      On Admin → Sub-Contractors, tag the company with a matching service (e.g. Gutters), or leave
                      services empty to allow all job types. Opening this dialog refreshes the list.
                    </p>
                    <a href="/admin/subs" className="text-indigo-600 text-sm hover:underline">
                      Add a sub-contractor →
                    </a>
                  </div>
                ) : (
                  relevantSubs.map(sub => (
                    <label
                      key={sub.id}
                      className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition ${
                        selectedSubId === sub.id 
                          ? 'border-orange-500 bg-orange-50' 
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="sub"
                        checked={selectedSubId === sub.id}
                        onChange={() => setSelectedSubId(sub.id)}
                        className="sr-only"
                      />
                      <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-orange-600 text-sm font-medium">
                          {sub.company_name.charAt(0)}
                        </span>
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">{sub.company_name}</div>
                        {sub.services && sub.services.length > 0 && (
                          <div className="text-xs text-gray-500">
                            {sub.services.slice(0, 3).join(', ')}
                          </div>
                        )}
                      </div>
                      {selectedSubId === sub.id && (
                        <svg className="w-5 h-5 text-orange-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      )}
                    </label>
                  ))
                )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : isReassignOnly ? 'Save assignment' : 'Schedule Job'}
          </button>
        </div>
      </div>
    </div>
  )
}
