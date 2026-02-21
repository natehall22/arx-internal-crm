'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'

type FeedbackOutcome = 'no_show' | 'reschedule' | 'said_no' | 'moving_forward'

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
    if (newOutcome === 'reschedule') {
      setShowReschedule(true)
    } else {
      setShowReschedule(false)
    }
  }

  const handleSubmit = async () => {
    if (!outcome) {
      setError('Please select an outcome')
      return
    }

    if (outcome === 'reschedule' && (!rescheduleDate || !rescheduleTime)) {
      setError('Please select a new date and time for the reschedule')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      if (outcome === 'reschedule') {
        // Handle reschedule - send local time string directly
        // Format: "YYYY-MM-DDTHH:MM" (local time, not UTC)
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
      } else {
        // Handle other outcomes
        const outcomeMap: Record<FeedbackOutcome, string> = {
          no_show: 'not_home',
          said_no: 'said_no',
          moving_forward: 'sale',
          reschedule: 'rescheduled',
        }

        const response = await fetch('/api/inspections/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointment_id: appointmentId,
            outcome: outcomeMap[outcome],
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
            <button
              type="button"
              onClick={() => handleOutcomeChange('no_show')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                outcome === 'no_show'
                  ? 'border-red-500 bg-red-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  outcome === 'no_show' ? 'bg-red-100' : 'bg-gray-100'
                }`}>
                  <svg className={`w-5 h-5 ${outcome === 'no_show' ? 'text-red-600' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">No Show</p>
                  <p className="text-xs text-gray-500">Customer wasn't home</p>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleOutcomeChange('reschedule')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                outcome === 'reschedule'
                  ? 'border-amber-500 bg-amber-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  outcome === 'reschedule' ? 'bg-amber-100' : 'bg-gray-100'
                }`}>
                  <svg className={`w-5 h-5 ${outcome === 'reschedule' ? 'text-amber-600' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Reschedule</p>
                  <p className="text-xs text-gray-500">Need to reschedule</p>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleOutcomeChange('said_no')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                outcome === 'said_no'
                  ? 'border-gray-500 bg-gray-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  outcome === 'said_no' ? 'bg-gray-200' : 'bg-gray-100'
                }`}>
                  <svg className={`w-5 h-5 ${outcome === 'said_no' ? 'text-gray-600' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Said No</p>
                  <p className="text-xs text-gray-500">Not interested</p>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleOutcomeChange('moving_forward')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                outcome === 'moving_forward'
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  outcome === 'moving_forward' ? 'bg-green-100' : 'bg-gray-100'
                }`}>
                  <svg className={`w-5 h-5 ${outcome === 'moving_forward' ? 'text-green-600' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Moving Forward</p>
                  <p className="text-xs text-gray-500">Proceeding with sale</p>
                </div>
              </div>
            </button>
          </div>

          {/* Reschedule Date/Time */}
          {showReschedule && (
            <div className="mb-6 p-4 bg-amber-50 rounded-lg border border-amber-200">
              <h3 className="font-medium text-amber-800 mb-3">Select New Date & Time</h3>
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
