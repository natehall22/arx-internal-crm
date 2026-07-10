'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'
import CloseVisitDebriefWizard from '@/components/inspection/CloseVisitDebriefWizard'
import {
  DEFAULT_INSPECTION_OUTCOMES,
  inspectionOutcomeRequiresCloseSchedule,
  normalizeInspectionOutcomeId,
  sortActiveOutcomes,
  type InspectionOutcomeConfigRow,
} from '@/lib/inspection-outcomes'
import { easternDatetimeLocalToUtcIso, getEasternTodayIso, EASTERN_TZ } from '@/lib/eastern-datetime'

function addDaysToEasternDateIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

function getEasternWeekdayForDateIso(iso: string): number {
  const weekday = new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
    timeZone: EASTERN_TZ,
    weekday: 'short',
  })
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
}

/** Tomorrow in ET, skipping Sunday — default suggestion for the inside-sales insurance call. */
function defaultInsuranceCallDate(): string {
  let next = addDaysToEasternDateIso(getEasternTodayIso(), 1)
  if (getEasternWeekdayForDateIso(next) === 0) {
    next = addDaysToEasternDateIso(next, 1)
  }
  return next
}

function isRescheduledOutcomeId(id: string | null): boolean {
  return normalizeInspectionOutcomeId(id) === 'rescheduled'
}

function isInsuranceFollowUpOutcomeId(id: string | null): boolean {
  return normalizeInspectionOutcomeId(id) === 'insurance_follow_up'
}

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
  const redirectPath = leadId ? `/leads/${leadId}` : '/dashboard'

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [appointment, setAppointment] = useState<Appointment | null>(null)
  const [lead, setLead] = useState<Lead | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Form state — outcome id from org settings (admin Inspection Outcomes)
  const [outcomeRows, setOutcomeRows] = useState<InspectionOutcomeConfigRow[]>(() =>
    sortActiveOutcomes([...DEFAULT_INSPECTION_OUTCOMES])
  )
  const [outcome, setOutcome] = useState<string | null>(null)
  const [feedbackNotes, setFeedbackNotes] = useState('')
  
  // Reschedule state
  const [showReschedule, setShowReschedule] = useState(false)
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [rescheduleTime, setRescheduleTime] = useState('')

  // Inside-sales handoff state (insurance call booking + structured context for the call center)
  const [insuranceCallDate, setInsuranceCallDate] = useState(() => defaultInsuranceCallDate())
  const [insuranceCallTime, setInsuranceCallTime] = useState('10:00')
  const [claimFiled, setClaimFiled] = useState('')
  const [insuranceCarrier, setInsuranceCarrier] = useState('')
  const [claimNumber, setClaimNumber] = useState('')
  const [adjusterMeeting, setAdjusterMeeting] = useState('')
  const [decisionMaker, setDecisionMaker] = useState('')
  const [bestCallWindow, setBestCallWindow] = useState('')
  const [contextLine, setContextLine] = useState('')
  
  const [schedulingUsers, setSchedulingUsers] = useState<
    Array<{ id: string; full_name: string; has_calendar?: boolean }>
  >([])
  const [schedulingTeams, setSchedulingTeams] = useState<Array<{ id: string; name: string }>>([])
  const [closeDurationMinutes, setCloseDurationMinutes] = useState(60)
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [closeVisitDebrief, setCloseVisitDebrief] = useState<{ opportunityId: string } | null>(null)

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

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/canvass/data')
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        if (Array.isArray(data.users)) {
          setSchedulingUsers(
            data.users.map((u: { id: string; full_name: string; has_calendar?: boolean }) => ({
              id: u.id,
              full_name: u.full_name,
              has_calendar: u.has_calendar,
            }))
          )
        }
        if (Array.isArray(data.teams)) {
          setSchedulingTeams(data.teams.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })))
        }
        if (typeof data.closeDurationMinutes === 'number' && data.closeDurationMinutes > 0) {
          setCloseDurationMinutes(data.closeDurationMinutes)
        }
        if (typeof data.currentUserRole === 'string') {
          setCurrentUserRole(data.currentUserRole)
        }
        if (typeof data.currentUserId === 'string') {
          setCurrentUserId(data.currentUserId)
        }
      } catch {
        /* non-fatal */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/inspections/outcomes')
        if (!res.ok) return
        const data = await res.json()
        const rows = data?.outcomes as InspectionOutcomeConfigRow[] | undefined
        if (cancelled || !Array.isArray(rows) || rows.length === 0) return
        setOutcomeRows(sortActiveOutcomes(rows))
      } catch {
        /* keep defaults */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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

  const handleOutcomeChange = (newOutcomeId: string) => {
    setOutcome(newOutcomeId)
    setShowReschedule(isRescheduledOutcomeId(newOutcomeId))
  }

  const handleSubmit = async () => {
    if (!outcome) {
      setError('Please select an outcome')
      return
    }

    // Reschedule only works with appointment ID
    if (isRescheduledOutcomeId(outcome) && !appointmentId) {
      setError('Cannot reschedule without an existing appointment. Please select a different outcome.')
      return
    }

    if (isInsuranceFollowUpOutcomeId(outcome) && (!insuranceCallDate || !insuranceCallTime)) {
      setError('Pick the insurance call date and time')
      return
    }

    if (isInsuranceFollowUpOutcomeId(outcome) && !claimFiled) {
      setError('Select whether the claim was filed')
      return
    }

    if (isRescheduledOutcomeId(outcome) && (!rescheduleDate || !rescheduleTime)) {
      setError('Please select a new date and time for the reschedule')
      return
    }

    setSubmitting(true)
    setError(null)

    const handoffContext: Record<string, string> = {}
    if (claimFiled) handoffContext.claim_filed = claimFiled
    if (insuranceCarrier.trim()) handoffContext.insurance_carrier = insuranceCarrier.trim()
    if (claimNumber.trim()) handoffContext.claim_number = claimNumber.trim()
    if (adjusterMeeting) {
      const adjusterIso = easternDatetimeLocalToUtcIso(adjusterMeeting)
      if (adjusterIso) handoffContext.adjuster_meeting_at = adjusterIso
    }
    if (decisionMaker.trim()) handoffContext.decision_maker = decisionMaker.trim()
    if (bestCallWindow) handoffContext.best_call_window = bestCallWindow
    if (contextLine.trim()) handoffContext.context_line = contextLine.trim()
    const handoffContextPayload = Object.keys(handoffContext).length > 0 ? handoffContext : undefined

    try {
      if (isRescheduledOutcomeId(outcome)) {
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
      } else if (
        outcome &&
        inspectionOutcomeRequiresCloseSchedule(
          outcomeRows.find((o) => o.id === outcome) ?? { id: outcome, label: '' }
        )
      ) {
        const statusResponse = await fetch('/api/inspections/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointment_id: appointmentId || undefined,
            lead_id: leadId || undefined,
            outcome,
            notes: feedbackNotes,
            setter_feedback: feedbackNotes,
          }),
        })

        if (!statusResponse.ok) {
          const data = await statusResponse.json()
          throw new Error(data.error || 'Failed to submit feedback')
        }

        const statusData = (await statusResponse.json()) as { opportunity_id?: string | null }
        if (!statusData.opportunity_id) {
          throw new Error(
            'Could not resolve an opportunity for this lead. Ensure Moving to Close is allowed for your org and try again.'
          )
        }

        setCloseVisitDebrief({ opportunityId: statusData.opportunity_id })
        return
      } else if (outcome && isInsuranceFollowUpOutcomeId(outcome)) {
        const insuranceCallIso = easternDatetimeLocalToUtcIso(
          `${insuranceCallDate}T${insuranceCallTime}`
        )
        if (!insuranceCallIso) {
          throw new Error('Could not parse the insurance call date and time. Check the fields and try again.')
        }
        const response = await fetch('/api/inspections/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointment_id: appointmentId || undefined,
            lead_id: leadId || undefined,
            outcome,
            notes: feedbackNotes,
            setter_feedback: feedbackNotes,
            insurance_call_at: insuranceCallIso,
            handoff_context: handoffContextPayload,
          }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to submit feedback')
        }

        setSuccess(true)
        setTimeout(() => router.push(redirectPath), 2000)
      } else {
        // Handle other outcomes (sale, said_no, not_home, no_problems_found, needs_repair)
        const response = await fetch('/api/inspections/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointment_id: appointmentId || undefined,
            lead_id: leadId || undefined,
            outcome: outcome,
            notes: feedbackNotes,
            setter_feedback: feedbackNotes,
            handoff_context: handoffContextPayload,
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

  const selectedOutcomeRow = outcome ? outcomeRows.find((o) => o.id === outcome) : undefined
  const showMovingToCloseNote =
    selectedOutcomeRow != null && inspectionOutcomeRequiresCloseSchedule(selectedOutcomeRow)

  const finishCloseVisitDebrief = () => {
    setCloseVisitDebrief(null)
    setSuccess(true)
    setTimeout(() => router.push(redirectPath), 2000)
  }

  if (closeVisitDebrief) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="max-w-2xl mx-auto px-4 pt-8 pb-[calc(4rem+var(--safe-area-inset-bottom))]">
          <div className="mb-6">
            <Link href={backLink} className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
              ← Back
            </Link>
          </div>
          <CloseVisitDebriefWizard
            opportunityId={closeVisitDebrief.opportunityId}
            inspectionAppointmentId={appointmentId}
            currentUserRole={currentUserRole}
            currentUserId={currentUserId}
            closeDurationMinutes={closeDurationMinutes}
            users={schedulingUsers}
            teams={schedulingTeams}
            onComplete={finishCloseVisitDebrief}
            onFinishLater={() => router.push(redirectPath)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-2xl mx-auto px-4 py-8 pb-[calc(4rem+var(--safe-area-inset-bottom))]">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            {outcomeRows.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleOutcomeChange(opt.id)}
                className={`p-4 rounded-lg border-2 text-left transition-all min-h-[88px] overflow-hidden ${
                  outcome === opt.id
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-lg font-bold ${
                      opt.color?.startsWith('#') ? 'text-white' : opt.color || 'bg-gray-500 text-white'
                    }`}
                    style={opt.color?.startsWith('#') ? { backgroundColor: opt.color } : undefined}
                  >
                    {opt.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 break-words">{opt.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5 break-words">{opt.description}</p>
                  </div>
                </div>
              </button>
            ))}
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

          {isInsuranceFollowUpOutcomeId(outcome) && (
            <div className="mb-6 p-4 bg-purple-50 rounded-lg border border-purple-200 space-y-4">
              <h3 className="font-medium text-purple-900">Insurance call (book it with the customer now)</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Call date</label>
                  <input
                    type="date"
                    value={insuranceCallDate}
                    onChange={(e) => setInsuranceCallDate(e.target.value)}
                    min={getEasternTodayIso()}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Call time (ET)</label>
                  <input
                    type="time"
                    value={insuranceCallTime}
                    onChange={(e) => setInsuranceCallTime(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Claim filed?</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: 'yes', label: 'Yes' },
                    { value: 'no', label: 'No' },
                    { value: 'customer_filing', label: 'Customer filing' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setClaimFiled(opt.value)}
                      className={`px-3 py-2 rounded-lg border text-sm font-medium ${
                        claimFiled === opt.value
                          ? 'border-purple-500 bg-purple-100 text-purple-900'
                          : 'border-gray-300 bg-white text-gray-700'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Insurance company</label>
                  <input
                    type="text"
                    value={insuranceCarrier}
                    onChange={(e) => setInsuranceCarrier(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Claim #</label>
                  <input
                    type="text"
                    value={claimNumber}
                    onChange={(e) => setClaimNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Adjuster meeting (if known, ET)
                </label>
                <input
                  type="datetime-local"
                  value={adjusterMeeting}
                  onChange={(e) => setAdjusterMeeting(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base"
                />
              </div>
            </div>
          )}

          {outcome &&
            !isInsuranceFollowUpOutcomeId(outcome) &&
            !isRescheduledOutcomeId(outcome) &&
            selectedOutcomeRow?.inside_sales_handoff_enabled === true && (
              <div className="mb-6 p-4 bg-cyan-50 rounded-lg border border-cyan-200 space-y-4">
                <h3 className="font-medium text-cyan-900">For the call center</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Best time to call</label>
                    <select
                      value={bestCallWindow}
                      onChange={(e) => setBestCallWindow(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base bg-white"
                    >
                      <option value="">—</option>
                      <option value="morning">Morning</option>
                      <option value="afternoon">Afternoon</option>
                      <option value="evening">Evening</option>
                      <option value="anytime">Anytime</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Ask for</label>
                    <input
                      type="text"
                      value={decisionMaker}
                      onChange={(e) => setDecisionMaker(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">What you told the customer</label>
                  <input
                    type="text"
                    value={contextLine}
                    onChange={(e) => setContextLine(e.target.value)}
                    maxLength={200}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base"
                  />
                </div>
              </div>
            )}

          {showMovingToCloseNote && (
            <div className="mb-6 p-4 bg-emerald-50 rounded-lg border border-emerald-200 text-sm text-emerald-900">
              After you submit, you&apos;ll complete the <strong>close visit debrief</strong>: photos, briefing
              fields for the closer, optional close scheduling, then final submit (with optional email to the
              closer).
            </div>
          )}

          {/* Notes */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Notes (optional)</label>
            <textarea
              value={feedbackNotes}
              onChange={(e) => setFeedbackNotes(e.target.value)}
              rows={4}
              placeholder="Add any additional notes about this appointment..."
              className="w-full box-border px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 resize-none text-base leading-normal"
            />
          </div>

          {/* Submit Button */}
          <button
            onClick={handleSubmit}
            disabled={!outcome || submitting}
            className="w-full min-h-[48px] py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
