'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'
import {
  CLOSE_FEEDBACK_OUTCOME_LABELS,
  type CloseFeedbackOutcome,
} from '@/lib/close-feedback-outcomes'

const OUTCOME_ORDER: CloseFeedbackOutcome[] = [
  'sold',
  'needs_another_visit',
  'waiting_on_insurance',
  'insurance_follow_up',
  'said_no',
  'not_home',
  'rescheduled',
]

export default function CloseAppointmentFeedbackPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const opportunityId = searchParams.get('opportunity_id')
  const closeId = searchParams.get('id')
  const scheduledAppointmentId = searchParams.get('scheduled_appointment_id')

  const [loading, setLoading] = useState(true)
  const [contextOk, setContextOk] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const [customerName, setCustomerName] = useState<string>('—')
  const [closerName, setCloserName] = useState<string | null>(null)
  const [address, setAddress] = useState<string>('—')
  const [scheduledFor, setScheduledFor] = useState<string | null>(null)

  const [outcome, setOutcome] = useState<CloseFeedbackOutcome | null>(null)
  const [notes, setNotes] = useState('')
  const [insuranceFollowUpDate, setInsuranceFollowUpDate] = useState('')
  const [insuranceFollowUpTime, setInsuranceFollowUpTime] = useState('')

  const loadContext = useCallback(async () => {
    if (!opportunityId || (!closeId && !scheduledAppointmentId)) {
      setLoading(false)
      setContextOk(false)
      setError('Missing opportunity or close appointment. Use the link from the opportunity page.')
      return
    }

    try {
      let url = `/api/close-appointments/context?opportunity_id=${encodeURIComponent(opportunityId)}`
      if (closeId) {
        url += `&id=${encodeURIComponent(closeId)}`
      } else if (scheduledAppointmentId) {
        url += `&scheduled_appointment_id=${encodeURIComponent(scheduledAppointmentId)}`
      }

      const response = await fetch(url, { credentials: 'same-origin' })
      if (!response.ok) {
        if (response.status === 401) {
          router.push('/login')
          return
        }
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to load')
      }

      const data = await response.json()
      setCustomerName(data.opportunity?.customer_name || '—')
      setCloserName(data.closer_name || null)
      setAddress(data.opportunity?.address_text || '—')

      if (data.mode === 'close_row' && data.close_appointment) {
        setScheduledFor(data.close_appointment.scheduled_for)
        if (data.close_appointment.outcome) {
          setOutcome(data.close_appointment.outcome as CloseFeedbackOutcome)
        }
        if (data.close_appointment.notes) {
          setNotes(data.close_appointment.notes)
        }
      } else if (data.mode === 'legacy_scheduled' && data.scheduled_appointment) {
        setScheduledFor(data.scheduled_appointment.scheduled_for)
      }
      setContextOk(true)
    } catch (err) {
      setContextOk(false)
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [opportunityId, closeId, scheduledAppointmentId, router])

  useEffect(() => {
    loadContext()
  }, [loadContext])

  const handleSubmit = async () => {
    if (!outcome || !opportunityId) {
      setError('Please select an outcome')
      return
    }

    if (outcome === 'insurance_follow_up' && (!insuranceFollowUpDate || !insuranceFollowUpTime)) {
      setError('Please select a date and time for the insurance follow-up')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const body: Record<string, string | undefined> = {
        opportunity_id: opportunityId,
        outcome,
        notes: notes || undefined,
      }
      if (outcome === 'insurance_follow_up') {
        body.follow_up_date = `${insuranceFollowUpDate}T${insuranceFollowUpTime}`
      }
      if (closeId) {
        body.close_appointment_id = closeId
      }
      if (scheduledAppointmentId) {
        body.scheduled_appointment_id = scheduledAppointmentId
      }

      const response = await fetch('/api/close-appointments/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit')
      }

      setSuccess(true)
      setTimeout(() => router.push(`/opportunities/${opportunityId}`), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit')
    } finally {
      setSubmitting(false)
    }
  }

  const formatEt = (iso: string) =>
    new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })

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
            <p className="text-green-600">Returning to the opportunity…</p>
          </div>
        </div>
      </div>
    )
  }

  if (!loading && !contextOk) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="max-w-2xl mx-auto px-4 py-8">
          <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center">
            <p className="text-red-700">{error || 'Unable to load this page.'}</p>
            <Link href="/dashboard" className="mt-4 inline-block text-indigo-600 hover:text-indigo-800">
              Return to Dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-2xl mx-auto px-4 py-8 pb-16">
        <div className="mb-6">
          <Link
            href={opportunityId ? `/opportunities/${opportunityId}` : '/dashboard'}
            className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
          >
            ← Back to opportunity
          </Link>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Close Appointment Feedback</h1>
          <p className="text-gray-500">Record the outcome of your close appointment</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Opportunity Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Customer</p>
              <p className="font-medium text-gray-900">{customerName}</p>
            </div>
            <div>
              <p className="text-gray-500">Closer</p>
              <p className="font-medium text-gray-900">{closerName || '—'}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-gray-500">Close appointment scheduled</p>
              <p className="font-medium text-gray-900">
                {scheduledFor ? formatEt(scheduledFor) + ' (ET)' : '—'}
              </p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-gray-500">Address</p>
              <p className="font-medium text-gray-900">{address}</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">What was the outcome?</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            {OUTCOME_ORDER.map((key) => {
              const meta = CLOSE_FEEDBACK_OUTCOME_LABELS[key]
              const selected = outcome === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setOutcome(key)}
                  className={`p-4 rounded-lg border-2 text-left transition-all min-h-[88px] ${
                    selected ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-lg ${
                        selected ? 'bg-indigo-500 text-white' : 'bg-gray-100'
                      }`}
                    >
                      {meta.icon}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{meta.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{meta.description}</p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {outcome === 'insurance_follow_up' && (
            <div className="mb-6 p-4 bg-purple-50 rounded-lg border border-purple-200">
              <h3 className="font-medium text-purple-900 mb-2">Schedule insurance follow-up</h3>
              <p className="text-sm text-purple-800 mb-3">
                When should you be prompted for feedback after this follow-up visit? (Required — same
                idea as inspection feedback.)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={insuranceFollowUpDate}
                    onChange={(e) => setInsuranceFollowUpDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Time</label>
                  <input
                    type="time"
                    value={insuranceFollowUpTime}
                    onChange={(e) => setInsuranceFollowUpTime(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Add any additional notes about this close appointment…"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 resize-none text-base"
            />
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={
              !outcome ||
              submitting ||
              (outcome === 'insurance_follow_up' &&
                (!insuranceFollowUpDate || !insuranceFollowUpTime))
            }
            className="w-full min-h-[48px] py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Submitting…
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
