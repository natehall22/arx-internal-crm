'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'

type FeedbackOutcome = 'sale' | 'moving_to_close' | 'insurance_follow_up' | 'said_no' | 'not_home' | 'no_problems_found' | 'failed_credit' | 'rescheduled'

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

interface Lead {
  id: string
  homeowner_name: string | null
  phone: string | null
  address_text: string | null
  inspection_scheduled_for: string | null
}

export default function AppointmentFeedbackPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const appointmentId = searchParams.get('id')
  const leadId = searchParams.get('lead_id')

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [appointment, setAppointment] = useState<Appointment | null>(null)
  const [lead, setLead] = useState<Lead | null>(null)
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
    } else if (leadId) {
      loadLead()
    } else {
      setLoading(false)
      setError('No appointment or lead ID provided')
    }
  }, [appointmentId, leadId])

  const loadAppointment = async () => {
    try {
      const response = await fetch(`/api/appointments/${appointmentId}`)
      
      if (!response.ok) {
        if (response.status === 401) {
          router.push('/login')
          return
        }
        // If appointment not found but we have a lead_id, fall back to loading the lead
        if (response.status === 404 && leadId) {
          console.log('Appointment not found, falling back to lead_id:', leadId)
          await loadLead()
          return
        }
        throw new Error('Failed to load appointment')
      }

      const data = await response.json()
      setAppointment(data.appointment)
    } catch (err) {
      // If we have a lead_id, try to fall back to it
      if (leadId) {
        console.log('Appointment load failed, falling back to lead_id:', leadId)
        await loadLead()
        return
      }
      setError(err instanceof Error ? err.message : 'Failed to load appointment')
    } finally {
      setLoading(false)
    }
  }

  const loadLead = async () => {
    try {
      const response = await fetch(`/api/leads/${leadId}`)
      
      if (!response.ok) {
        if (response.status === 401) {
          router.push('/login')
          return
        }
        throw new Error('Failed to load lead')
      }

      const data = await response.json()
      setLead(data.lead)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load lead')
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

    // Reschedule only works with appointment ID
    if (outcome === 'rescheduled' && !appointmentId) {
      setError('Cannot reschedule without an existing appointment. Please select a different outcome.')
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

    // Determine the redirect path based on whether we came from a lead or appointment
    const redirectPath = leadId ? `/leads/${leadId}` : '/dashboard'

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
        setTimeout(() => router.push(redirectPath), 2000)
      } else if (outcome === 'moving_to_close') {
        // First submit the inspection outcome
        const statusResponse = await fetch('/api/inspections/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointment_id: appointmentId || undefined,
            lead_id: leadId || undefined,
            outcome: 'moving_to_close',
            notes: feedbackNotes,
            setter_feedback: feedbackNotes,
          }),
        })

        if (!statusResponse.ok) {
          const data = await statusResponse.json()
          throw new Error(data.error || 'Failed to submit feedback')
        }

        // Then schedule the close appointment (only if we have an appointment)
        if (appointmentId) {
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
        }

        setSuccess(true)
        setTimeout(() => router.push(redirectPath), 2000)
      } else {
        // Handle other outcomes (sale, said_no, not_home, no_problems_found, failed_credit, insurance_follow_up)
        const response = await fetch('/api/inspections/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointment_id: appointmentId || undefined,
            lead_id: leadId || undefined,
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
        setTimeout(() => router.push(redirectPath), 2000)
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

  if (!appointment && !lead) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="max-w-2xl mx-auto px-4 py-8">
          <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center">
            <p className="text-red-700">{error || 'Appointment or lead not found'}</p>
            <Link href="/dashboard" className="mt-4 inline-block text-indigo-600 hover:text-indigo-800">
              Return to Dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const appointmentDate = appointment ? new Date(appointment.scheduled_for) : null
  const inspectionDate = lead?.inspection_scheduled_for ? new Date(lead.inspection_scheduled_for) : null
  const backLink = leadId ? `/leads/${leadId}` : '/dashboard'

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Link href={backLink} className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
            ← Back
          </Link>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            {appointment ? 'Appointment Feedback' : 'Inspection Status Update'}
          </h1>
          <p className="text-gray-500">
            {appointment ? 'Please provide feedback for this appointment' : 'Update the inspection outcome for this lead'}
          </p>
        </div>

        {/* Details Section */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {appointment ? 'Appointment Details' : 'Lead Details'}
          </h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Customer</p>
              <p className="font-medium text-gray-900">
                {appointment?.leads?.homeowner_name || lead?.homeowner_name || 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-gray-500">Phone</p>
              <p className="font-medium text-gray-900">
                {appointment?.leads?.phone || lead?.phone || 'N/A'}
              </p>
            </div>
            {(appointmentDate || inspectionDate) && (
              <div>
                <p className="text-gray-500">
                  {appointment ? 'Date & Time' : 'Inspection Scheduled'}
                </p>
                <p className="font-medium text-gray-900">
                  {appointmentDate 
                    ? `${appointmentDate.toLocaleDateString('en-US', { timeZone: 'America/New_York' })} at ${appointmentDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' })}`
                    : inspectionDate
                    ? `${inspectionDate.toLocaleDateString('en-US', { timeZone: 'America/New_York' })} at ${inspectionDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' })}`
                    : 'N/A'
                  }
                </p>
              </div>
            )}
            <div>
              <p className="text-gray-500">Address</p>
              <p className="font-medium text-gray-900">
                {appointment?.address_text || lead?.address_text || 'N/A'}
              </p>
            </div>
            {appointment?.setter?.full_name && (
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
            {/* Sale */}
            <button
              type="button"
              onClick={() => handleOutcomeChange('sale')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                outcome === 'sale'
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  outcome === 'sale' ? 'bg-green-500 text-white' : 'bg-gray-100'
                }`}>
                  <span className="text-lg font-bold">✓</span>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Sale</p>
                  <p className="text-xs text-gray-500">Customer signed the contract</p>
                </div>
              </div>
            </button>

            {/* Moving to Close */}
            <button
              type="button"
              onClick={() => handleOutcomeChange('moving_to_close')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                outcome === 'moving_to_close'
                  ? 'border-emerald-500 bg-emerald-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  outcome === 'moving_to_close' ? 'bg-emerald-500 text-white' : 'bg-gray-100'
                }`}>
                  <span className="text-lg font-bold">→</span>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Moving to Close</p>
                  <p className="text-xs text-gray-500">Schedule close appointment</p>
                </div>
              </div>
            </button>

            {/* Insurance Follow Up */}
            <button
              type="button"
              onClick={() => handleOutcomeChange('insurance_follow_up')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                outcome === 'insurance_follow_up'
                  ? 'border-purple-500 bg-purple-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  outcome === 'insurance_follow_up' ? 'bg-purple-500 text-white' : 'bg-gray-100'
                }`}>
                  <span className="text-lg">📋</span>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Insurance Follow Up</p>
                  <p className="text-xs text-gray-500">Waiting on insurance claim</p>
                </div>
              </div>
            </button>

            {/* Said No */}
            <button
              type="button"
              onClick={() => handleOutcomeChange('said_no')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                outcome === 'said_no'
                  ? 'border-red-500 bg-red-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  outcome === 'said_no' ? 'bg-red-500 text-white' : 'bg-gray-100'
                }`}>
                  <span className="text-lg font-bold">✗</span>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Said No</p>
                  <p className="text-xs text-gray-500">Customer declined</p>
                </div>
              </div>
            </button>

            {/* Not Home */}
            <button
              type="button"
              onClick={() => handleOutcomeChange('not_home')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                outcome === 'not_home'
                  ? 'border-amber-500 bg-amber-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  outcome === 'not_home' ? 'bg-amber-500 text-white' : 'bg-gray-100'
                }`}>
                  <span className="text-lg font-bold">?</span>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Not Home</p>
                  <p className="text-xs text-gray-500">Customer wasn't there</p>
                </div>
              </div>
            </button>

            {/* No Problems Found */}
            <button
              type="button"
              onClick={() => handleOutcomeChange('no_problems_found')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                outcome === 'no_problems_found'
                  ? 'border-gray-500 bg-gray-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  outcome === 'no_problems_found' ? 'bg-gray-500 text-white' : 'bg-gray-100'
                }`}>
                  <span className="text-lg font-bold">○</span>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">No Problems Found</p>
                  <p className="text-xs text-gray-500">Roof is in good condition</p>
                </div>
              </div>
            </button>

            {/* Failed Credit */}
            <button
              type="button"
              onClick={() => handleOutcomeChange('failed_credit')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                outcome === 'failed_credit'
                  ? 'border-orange-500 bg-orange-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  outcome === 'failed_credit' ? 'bg-orange-500 text-white' : 'bg-gray-100'
                }`}>
                  <span className="text-lg font-bold">$</span>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Failed Credit</p>
                  <p className="text-xs text-gray-500">Did not qualify for financing</p>
                </div>
              </div>
            </button>

            {/* Rescheduled */}
            <button
              type="button"
              onClick={() => handleOutcomeChange('rescheduled')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                outcome === 'rescheduled'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  outcome === 'rescheduled' ? 'bg-blue-500 text-white' : 'bg-gray-100'
                }`}>
                  <span className="text-lg font-bold">↻</span>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Rescheduled</p>
                  <p className="text-xs text-gray-500">Moved to new date</p>
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
