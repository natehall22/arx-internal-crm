'use client'

import { useState } from 'react'
import type { InspectionOutcome, ScheduledAppointment } from '@/lib/types/database'

type AppointmentWithDetails = ScheduledAppointment & {
  lead?: { homeowner_name: string | null; address_text: string | null } | null
  opportunity?: { id: string } | null
  setter?: { full_name: string | null } | null
}

interface InspectionStatusCardProps {
  appointment: AppointmentWithDetails
  onComplete: (data: {
    outcome: InspectionOutcome
    notes: string
    setterFeedback: string
    scheduleFollowUp?: boolean
    followUpDate?: string
  }) => Promise<void>
  onReschedule: (appointmentId: string) => void
}

const outcomeOptions: { id: InspectionOutcome; label: string; description: string; color: string; icon: string; needsFollowUp?: boolean }[] = [
  { 
    id: 'sale', 
    label: 'Sale', 
    description: 'Customer signed the contract',
    color: 'bg-green-500',
    icon: '✓'
  },
  { 
    id: 'moving_to_close', 
    label: 'Moving to Close', 
    description: 'Customer interested, following up to close',
    color: 'bg-emerald-500',
    icon: '→',
    needsFollowUp: true
  },
  { 
    id: 'insurance_follow_up', 
    label: 'Insurance Follow Up', 
    description: 'Waiting on insurance claim/approval',
    color: 'bg-purple-500',
    icon: '📋',
    needsFollowUp: true
  },
  { 
    id: 'said_no', 
    label: 'Said No', 
    description: 'Customer declined after presentation',
    color: 'bg-red-500',
    icon: '✗'
  },
  { 
    id: 'not_home', 
    label: 'Not Home', 
    description: 'Customer was not present',
    color: 'bg-amber-500',
    icon: '?',
    needsFollowUp: true
  },
  { 
    id: 'no_problems_found', 
    label: 'No Problems Found', 
    description: 'Roof inspection showed no issues',
    color: 'bg-gray-500',
    icon: '○'
  },
  { 
    id: 'failed_credit', 
    label: 'Failed Credit', 
    description: 'Customer did not qualify for financing',
    color: 'bg-orange-500',
    icon: '$'
  },
  { 
    id: 'rescheduled', 
    label: 'Rescheduled', 
    description: 'Appointment moved to new date',
    color: 'bg-blue-500',
    icon: '↻'
  },
]

export default function InspectionStatusCard({ 
  appointment, 
  onComplete,
  onReschedule 
}: InspectionStatusCardProps) {
  const [selectedOutcome, setSelectedOutcome] = useState<InspectionOutcome | null>(null)
  const [notes, setNotes] = useState('')
  const [setterFeedback, setSetterFeedback] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scheduleFollowUp, setScheduleFollowUp] = useState(false)
  const [followUpDate, setFollowUpDate] = useState('')
  const [followUpTime, setFollowUpTime] = useState('')
  
  // Check if selected outcome needs follow-up option
  const selectedOption = outcomeOptions.find(o => o.id === selectedOutcome)
  const showFollowUpOption = selectedOption?.needsFollowUp && selectedOutcome !== 'rescheduled'

  const handleSubmit = async () => {
    if (!selectedOutcome) {
      setError('Please select an outcome')
      return
    }

    // If rescheduled, redirect to scheduling
    if (selectedOutcome === 'rescheduled') {
      onReschedule(appointment.id)
      return
    }

    setSaving(true)
    setError(null)

    try {
      const followUpDateTime = scheduleFollowUp && followUpDate && followUpTime 
        ? `${followUpDate}T${followUpTime}` 
        : undefined
        
      await onComplete({
        outcome: selectedOutcome,
        notes,
        setterFeedback,
        scheduleFollowUp: scheduleFollowUp && !!followUpDateTime,
        followUpDate: followUpDateTime,
      })
    } catch (err) {
      setError('Failed to save status update')
    } finally {
      setSaving(false)
    }
  }

  const scheduledTime = new Date(appointment.scheduled_for)
  const isOverdue = new Date() > new Date(scheduledTime.getTime() + 30 * 60 * 1000)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header - Fixed */}
        <div className={`px-6 py-4 ${isOverdue ? 'bg-amber-500' : 'bg-indigo-600'} text-white flex-shrink-0`}>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold">Inspection Status Update</h2>
              <p className="text-white/80 text-sm">
                {isOverdue ? 'Status update required' : 'How did the appointment go?'}
              </p>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Appointment Info */}
          <div className="px-6 py-4 bg-gray-50 border-b">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-gray-900">
                  {appointment.lead?.homeowner_name || 'Unknown Customer'}
                </p>
                <p className="text-sm text-gray-600">
                  {appointment.lead?.address_text || appointment.address_text || 'No address'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-gray-900">
                  {scheduledTime.toLocaleDateString('en-US', { timeZone: 'America/New_York' })}
                </p>
                <p className="text-sm text-gray-500">
                  {scheduledTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' })}
                </p>
              </div>
            </div>
            {appointment.setter && (
              <p className="mt-2 text-xs text-gray-500">
                Set by: {appointment.setter.full_name || 'Unknown'}
              </p>
            )}
          </div>

          {/* Outcome Selection */}
          <div className="px-6 py-4">
            <p className="text-sm font-medium text-gray-700 mb-3">Select Outcome *</p>
            <div className="grid grid-cols-1 gap-2">
              {outcomeOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSelectedOutcome(option.id)}
                  className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left ${
                    selectedOutcome === option.id
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-full ${option.color} text-white flex items-center justify-center text-lg font-bold`}>
                    {option.icon}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">{option.label}</p>
                    <p className="text-sm text-gray-500">{option.description}</p>
                  </div>
                  {selectedOutcome === option.id && (
                    <svg className="w-6 h-6 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Notes Section */}
          {selectedOutcome && selectedOutcome !== 'rescheduled' && (
            <div className="px-6 py-4 border-t">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Notes (Internal)
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add any notes about this appointment..."
                    rows={2}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                  />
                </div>
                
                {appointment.setter && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Feedback for Setter
                      <span className="text-gray-400 font-normal ml-1">
                        ({appointment.setter.full_name} will see this)
                      </span>
                    </label>
                    <textarea
                      value={setterFeedback}
                      onChange={(e) => setSetterFeedback(e.target.value)}
                      placeholder="Quality of lead, any issues with the appointment..."
                      rows={2}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Follow-up Scheduling Option */}
          {showFollowUpOption && (
            <div className="px-6 py-4 border-t">
              <button
                type="button"
                onClick={() => setScheduleFollowUp(!scheduleFollowUp)}
                className={`w-full py-3 px-4 rounded-xl border-2 flex items-center justify-between ${
                  scheduleFollowUp ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">📅</span>
                  <span className="font-medium text-gray-900">Schedule Follow-up</span>
                </div>
                <div className={`w-12 h-7 rounded-full transition-colors ${scheduleFollowUp ? 'bg-indigo-500' : 'bg-gray-300'}`}>
                  <div className={`w-5 h-5 bg-white rounded-full mt-1 transition-transform ${scheduleFollowUp ? 'translate-x-6' : 'translate-x-1'}`} />
                </div>
              </button>
              
              {scheduleFollowUp && (
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Follow-up Date
                    </label>
                    <input
                      type="date"
                      value={followUpDate}
                      onChange={(e) => setFollowUpDate(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Follow-up Time
                    </label>
                    <input
                      type="time"
                      value={followUpTime}
                      onChange={(e) => setFollowUpTime(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                  <p className="text-xs text-gray-500">
                    This will add a follow-up appointment to your calendar
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="px-6 pb-4">
              <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                {error}
              </div>
            </div>
          )}
        </div>

        {/* Actions - Fixed at bottom */}
        <div className="px-6 py-4 bg-gray-50 border-t flex-shrink-0 pb-safe">
          <button
            onClick={handleSubmit}
            disabled={!selectedOutcome || saving}
            className="w-full py-4 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-lg"
          >
            {saving ? 'Saving...' : selectedOutcome === 'rescheduled' ? 'Continue to Reschedule' : 'Submit Status Update'}
          </button>
          <p className="mt-2 text-center text-xs text-gray-500">
            This information will be saved to the customer&apos;s file
          </p>
        </div>
      </div>
    </div>
  )
}
