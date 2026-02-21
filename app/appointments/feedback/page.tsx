'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'

type FeedbackOutcome = 'not_home' | 'rescheduled' | 'moving_to_close' | 'no_problems_found'

interface Appointment {
  id: string
  scheduled_for: string
  duration_minutes: number
  address_text: string | null
  notes: string | null
  status: string
  leads?: {
    homeowner_name: string | null
    phone: string | null
  }
  setter?: {
    full_name: string | null
  }
}

export default function AppointmentFeedbackPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const appointmentId = searchParams.get('id')

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [appointment, setAppointment] = useState<Appointment | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Form state
  const [outcome, setOutcome] = useState<FeedbackOutcome | null>(null)
  const [feedbackNotes, setFeedbackNotes] = useState('')
  
  // Reschedule state
  const [showReschedule, setShowReschedule] = useState(false)
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [rescheduleTime, setRescheduleTime] = useState('')
  
  // Moving to close state (schedule close appointment)
  const [showCloseSchedule, setShowCloseSchedule] = useState(false)
  const [closeDate, setCloseDate] = useState('')
  const [closeTime, setCloseTime] = useState('')

  useEffect(() => {
    if (appointmentId) {
      loadAppointment()
    } else {
      setLoading(false)
      setError('No appointment ID provided')
    }
  }, [appointmentId])

  const loadAppointment = async () => {
    try {
      const response = await fetch(`/api/appointments/${appointmentId}`)
      
      if (!response.ok) {
        if (response.status === 401) {
          router.push('/login')
          return
        }
        throw new Error('Failed to load appointment')
      }

      const data = await response.json()
      setAppointment(data.appointment)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load appointment')
    } finally {
      setLoading(false)
    }
  }

  const handleOutcomeChange = (newOutcome: FeedbackOutcome) => {
    setOutcome(newOutcome)
    setShowReschedule(newOutcome === 'rescheduled')
    setShowCloseSchedule(newOutcome === 'moving_to_close')
  }

  const handleSubmit = async () => {
    if (!outcome) {
      setError('Please select an outcome')
      return
    }

    if (outcome === 'rescheduled' && (!rescheduleDate || !rescheduleTime)) {
      setError('Please select a new date and time for the reschedule')
      return
    }

    if (outcome === 'moving_to_close' && (!closeDate || !closeTime)) {
      setError('Please select a date and time for the close appointment')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      if (outcome === 'rescheduled') {
        // Handle reschedule - send local time string directly
        const localDateTime = `${rescheduleDate}T${rescheduleTime}`
        
        const response = await fetch('/api/inspections/reschedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            original_appointment_id: appointmentId,
            new_scheduled_for: localDateTime,
            notes: feedbackNotes || 'Rescheduled via feedback form',
          }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to reschedule')
        }

        setSuccess(true)
        setTimeout(() => router.push('/dashboard'), 2000)
      } else if (outcome === 'moving_to_close') {
        // First submit the inspection outcome
        const statusResponse = await fetch('/api/inspections/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointment_id: appointmentId,
            outcome: 'moving_to_close',
            notes: feedbackNotes,
            setter_feedback: feedbackNotes,
          }),
        })

        if (!statusResponse.ok) {
          const data = await statusResponse.json()
          throw new Error(data.error || 'Failed to submit feedback')
        }

        // Then schedule the close appointment
        const localDateTime = `${closeDate}T${closeTime}`
        
        const scheduleResponse = await fetch('/api/inspections/schedule-close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            original_appointment_id: appointmentId,
            scheduled_for: localDateTime,
            notes: feedbackNotes || 'Close appointment scheduled from inspection',
          }),
        })

        if (!scheduleResponse.ok) {
          const data = await scheduleResponse.json()
          throw new Error(data.error || 'Failed to schedule close appointment')
        }

        setSuccess(true)
        setTimeout(() => router.push('/dashboard'), 2000)
      } else {
        // Handle other outcomes (not_home, no_problems_found)
        const response = await fetch('/api/inspections/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointment_id: appointmentId,
            outcome: outcome,
            notes: feedbackNotes,
            setter_feedback: feedbackNotes,
          }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to submit feedback')
        }

        setSuccess(true)
        setTimeout(() => router.push('/dashboard'), 2000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="max-w-2xl mx-auto px-4 py-8">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/2 mb-4"></div>
            <div className="h-64 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="max-w-2xl mx-auto px-4 py-8">
          <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-green-800 mb-2">Feedback Submitted!</h2>
            <p className="text-green-600">Redirecting to dashboard...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!appointment) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="max-w-2xl mx-auto px-4 py-8">
          <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center">
            <p className="text-red-700">{error || 'Appointment not found'}</p>
            <Link href="/dashboard" className="mt-4 inline-block text-indigo-600 hover:text-indigo-800">
              Return to Dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const appointmentDate = new Date(appointment.scheduled_for)

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Link href="/dashboard" className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
            ← Back to Dashboard
          </Link>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Appointment Feedback</h1>
          <p className="text-gray-500">Please provide feedback for this appointment</p>
        </div>

        {/* Appointment Details */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Appointment Details</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Customer</p>
              <p className="font-medium text-gray-900">{appointment.leads?.homeowner_name || 'N/A'}</p>
            </div>
            <div>
              <p className="text-gray-500">Phone</p>
              <p className="font-medium text-gray-900">{appointment.leads?.phone || 'N/A'}</p>
            </div>
            <div>
              <p className="text-gray-500">Date & Time</p>
              <p className="font-medium text-gray-900">
                {appointmentDate.toLocaleDateString('en-US', { timeZone: 'America/New_York' })} at {appointmentDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' })}
              </p>
            </div>
            <div>
              <p className="text-gray-500">Address</p>
              <p className="font-medium text-gray-900">{appointment.address_text || 'N/A'}</p>
            </div>
            {appointment.setter?.full_name && (
              <div>
                <p className="text-gray-500">Set By</p>
                <p className="font-medium text-gray-900">{appointment.setter.full_name}</p>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {/* Feedback Form */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">What was the outcome?</h2>
          
          <div className="grid grid-cols-2 gap-3 mb-6">
            {/* Not Home */}
            <button
              type="button"
              onClick={() => handleOutcomeChange('not_home')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                outcome === 'not_home'
                  ? 'border-red-500 bg-red-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  outcome === 'not_home' ? 'bg-red-100' : 'bg-gray-100'
                }`}>
                  <svg className={`w-5 h-5 ${outcome === 'not_home' ? 'text-red-600' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Not Home</p>
                  <p className="text-xs text-gray-500">Customer wasn't there</p>
                </div>
              </div>
            </button>

            {/* Rescheduled */}
            <button
              type="button"
              onClick={() => handleOutcomeChange('rescheduled')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                outcome === 'rescheduled'
                  ? 'border-amber-500 bg-amber-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  outcome === 'rescheduled' ? 'bg-amber-100' : 'bg-gray-100'
                }`}>
                  <svg className={`w-5 h-5 ${outcome === 'rescheduled' ? 'text-amber-600' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Rescheduled</p>
                  <p className="text-xs text-gray-500">Need to reschedule inspection</p>
                </div>
              </div>
            </button>

            {/* Moving to Close */}
            <button
              type="button"
              onClick={() => handleOutcomeChange('moving_to_close')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                outcome === 'moving_to_close'
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  outcome === 'moving_to_close' ? 'bg-green-100' : 'bg-gray-100'
                }`}>
                  <svg className={`w-5 h-5 ${outcome === 'moving_to_close' ? 'text-green-600' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Moving to Close</p>
                  <p className="text-xs text-gray-500">Schedule close appointment</p>
                </div>
              </div>
            </button>

            {/* No Problems Found */}
            <button
              type="button"
              onClick={() => handleOutcomeChange('no_problems_found')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                outcome === 'no_problems_found'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  outcome === 'no_problems_found' ? 'bg-blue-100' : 'bg-gray-100'
                }`}>
                  <svg className={`w-5 h-5 ${outcome === 'no_problems_found' ? 'text-blue-600' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">No Problems Found</p>
                  <p className="text-xs text-gray-500">Roof is in good condition</p>
                </div>
              </div>
            </button>
          </div>

          {/* Reschedule Date/Time */}
          {showReschedule && (
            <div className="mb-6 p-4 bg-amber-50 rounded-lg border border-amber-200">
              <h3 className="font-medium text-amber-800 mb-3">Select New Inspection Date & Time</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={rescheduleDate}
                    onChange={(e) => setRescheduleDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Time</label>
                  <input
                    type="time"
                    value={rescheduleTime}
                    onChange={(e) => setRescheduleTime(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Schedule Close Appointment */}
          {showCloseSchedule && (
            <div className="mb-6 p-4 bg-green-50 rounded-lg border border-green-200">
              <h3 className="font-medium text-green-800 mb-3">Schedule Close Appointment</h3>
              <p className="text-sm text-green-700 mb-3">Select when you'll return to close the deal</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={closeDate}
                    onChange={(e) => setCloseDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Time</label>
                  <input
                    type="time"
                    value={closeTime}
                    onChange={(e) => setCloseTime(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Notes (optional)</label>
            <textarea
              value={feedbackNotes}
              onChange={(e) => setFeedbackNotes(e.target.value)}
              rows={3}
              placeholder="Add any additional notes about this appointment..."
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>

          {/* Submit Button */}
          <button
            onClick={handleSubmit}
            disabled={!outcome || submitting}
            className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Submitting...
              </>
            ) : (
              'Submit Feedback'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
