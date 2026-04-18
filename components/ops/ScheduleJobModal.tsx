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
  crews: Crew[]
  subs: SubContractor[]
  onClose: () => void
  onSave: () => void
  /** `reassign` only updates crew/sub; does not change schedule date or force status. */
  mode?: 'schedule' | 'reassign'
}

export default function ScheduleJobModal({ job, crews, subs, onClose, onSave, mode = 'schedule' }: Props) {
  const isReassignOnly = mode === 'reassign'
  const [assigneeType, setAssigneeType] = useState<'crew' | 'sub'>(
    job.assigned_sub_id ? 'sub' : 'crew'
  )
  const [selectedCrewId, setSelectedCrewId] = useState(job.assigned_crew_id || '')
  const [selectedSubId, setSelectedSubId] = useState(job.assigned_sub_id || '')
  const [scheduledDate, setScheduledDate] = useState(job.scheduled_date?.split('T')[0] || '')
  const [scheduledTimeStart, setScheduledTimeStart] = useState('08:00')
  const [estimatedHours, setEstimatedHours] = useState('8')
  const [saving, setSaving] = useState(false)

  // Filter crews by job type
  const relevantCrews = crews.filter(crew => {
    if (crew.crew_type === 'general') return true
    return crew.crew_type === job.job_type
  })

  // Filter subs by services
  const relevantSubs = subs.filter(sub => {
    if (!sub.services || sub.services.length === 0) return true
    const jobTypeCapitalized = job.job_type.charAt(0).toUpperCase() + job.job_type.slice(1)
    return sub.services.some(s => 
      s.toLowerCase().includes(job.job_type.toLowerCase()) ||
      s.includes(jobTypeCapitalized)
    )
  })

  const handleSave = async () => {
    if (!isReassignOnly && !scheduledDate) {
      alert('Please select a date')
      return
    }

    if (assigneeType === 'crew' && !selectedCrewId) {
      alert('Please select a crew')
      return
    }

    if (assigneeType === 'sub' && !selectedSubId) {
      alert('Please select a sub-contractor')
      return
    }

    setSaving(true)

    try {
      let updates: Record<string, unknown>

      if (isReassignOnly) {
        updates = {}
        if (assigneeType === 'crew') {
          updates.assigned_crew_id = selectedCrewId
          updates.assigned_sub_id = null
        } else {
          updates.assigned_sub_id = selectedSubId
          updates.assigned_crew_id = null
        }
      } else {
        updates = {
          scheduled_date: scheduledDate,
          scheduled_time_start: scheduledTimeStart,
          estimated_duration_hours: parseFloat(estimatedHours) || 8,
          status: 'scheduled',
        }

        if (assigneeType === 'crew') {
          updates.assigned_crew_id = selectedCrewId
          updates.assigned_sub_id = null
        } else {
          updates.assigned_sub_id = selectedSubId
          updates.assigned_crew_id = null
        }
      }

      const response = await fetch(`/api/ops/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to schedule job')
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
            {isReassignOnly ? 'Reassign crew or sub' : 'Schedule Job'}
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

          {/* Assignment Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Assign To *
            </label>
            <div className="flex gap-4 mb-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="assigneeType"
                  checked={assigneeType === 'crew'}
                  onChange={() => setAssigneeType('crew')}
                  className="w-4 h-4 text-indigo-600"
                />
                <span className="text-sm text-gray-700">In-House Crew</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="assigneeType"
                  checked={assigneeType === 'sub'}
                  onChange={() => setAssigneeType('sub')}
                  className="w-4 h-4 text-indigo-600"
                />
                <span className="text-sm text-gray-700">Sub-Contractor</span>
              </label>
            </div>

            {/* Crew Selection */}
            {assigneeType === 'crew' && (
              <div className="space-y-2">
                {relevantCrews.length === 0 ? (
                  <div className="text-center py-6 bg-gray-50 rounded-lg">
                    <p className="text-gray-500 text-sm">No crews available for {job.job_type} jobs</p>
                    <a href="/admin/crews" className="text-indigo-600 text-sm hover:underline">
                      Create a crew →
                    </a>
                  </div>
                ) : (
                  relevantCrews.map(crew => (
                    <label
                      key={crew.id}
                      className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition ${
                        selectedCrewId === crew.id 
                          ? 'border-indigo-500 bg-indigo-50' 
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="crew"
                        checked={selectedCrewId === crew.id}
                        onChange={() => setSelectedCrewId(crew.id)}
                        className="sr-only"
                      />
                      <div 
                        className="w-4 h-4 rounded-full flex-shrink-0" 
                        style={{ backgroundColor: crew.color }}
                      />
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">{crew.name}</div>
                        <div className="text-xs text-gray-500">
                          {crew.crew_type} • {crew.daily_capacity} jobs/day capacity
                        </div>
                      </div>
                      {selectedCrewId === crew.id && (
                        <svg className="w-5 h-5 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      )}
                    </label>
                  ))
                )}
              </div>
            )}

            {/* Sub Selection */}
            {assigneeType === 'sub' && (
              <div className="space-y-2">
                {relevantSubs.length === 0 ? (
                  <div className="text-center py-6 bg-gray-50 rounded-lg">
                    <p className="text-gray-500 text-sm">No sub-contractors available</p>
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
            )}
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
