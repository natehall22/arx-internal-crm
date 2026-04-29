'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ScheduledAppointment } from '@/lib/types/database'
import {
  DEFAULT_INSPECTION_OUTCOMES,
  inspectionOutcomeRequiresCloseSchedule,
  sortActiveOutcomes,
  type InspectionOutcomeConfigRow,
} from '@/lib/inspection-outcomes'
import {
  FEEDBACK_PROMPT_DISPLAY_TIMEZONE,
  calendarDateYmdInTimezone,
} from '@/lib/scheduling-prompt'
import CloseScheduleModal, { type CloseScheduleConfirm } from '@/components/appointments/CloseScheduleModal'

type AppointmentWithDetails = ScheduledAppointment & {
  lead?: { homeowner_name: string | null; address_text: string | null } | null
  opportunity?: { id: string } | null
  setter?: { full_name: string | null } | null
}

type OutcomeOption = {
  id: string
  label: string
  description: string
  color: string
  icon: string
}

function toUiOptions(rows: InspectionOutcomeConfigRow[]): OutcomeOption[] {
  return sortActiveOutcomes(rows).map((o) => ({
    id: o.id,
    label: o.label,
    description: o.description,
    color: o.color,
    icon: o.icon,
  }))
}

/** Built-in ids that keep special UI (reschedule redirect, insurance slot, optional follow-up). */
const RESCHEDULE_OUTCOME_ID = 'rescheduled'
const INSURANCE_OUTCOME_ID = 'insurance_follow_up'
const DIDNT_SIT_OUTCOME_ID = 'not_home'

interface InspectionStatusCardProps {
  appointment: AppointmentWithDetails
  /** When feedback is due (from `pending_status_prompts.prompt_at`). */
  promptAt?: string | null
  onComplete: (data: {
    outcome: string
    notes: string
    setterFeedback: string
    scheduleFollowUp?: boolean
    followUpDate?: string
    /** True when outcome is “Moving to Close” (any id/label variant orgs use). */
    requiresCloseSchedule?: boolean
    /** Present when requiresCloseSchedule — triggers /api/inspections/schedule-close after status. */
    closeSchedule?: CloseScheduleConfirm | null
  }) => Promise<void>
  onReschedule: (appointmentId: string) => void
  onFillLater?: () => Promise<void> | void
}

export default function InspectionStatusCard({
  appointment,
  promptAt,
  onComplete,
  onReschedule,
  onFillLater,
}: InspectionStatusCardProps) {
  const [outcomeOptions, setOutcomeOptions] = useState<OutcomeOption[]>(() =>
    toUiOptions(DEFAULT_INSPECTION_OUTCOMES)
  )
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [setterFeedback, setSetterFeedback] = useState('')
  const [saving, setSaving] = useState(false)
  const [snoozing, setSnoozing] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [followUpDate, setFollowUpDate] = useState('')
  const [followUpTime, setFollowUpTime] = useState('')
  const [showCloseModal, setShowCloseModal] = useState(false)
  const [closeSchedulePayload, setCloseSchedulePayload] = useState<CloseScheduleConfirm | null>(null)
  const [schedulingUsers, setSchedulingUsers] = useState<
    Array<{ id: string; full_name: string; has_calendar?: boolean }>
  >([])
  const [schedulingTeams, setSchedulingTeams] = useState<Array<{ id: string; name: string }>>([])
  const [closeDurationMinutes, setCloseDurationMinutes] = useState(60)
  const [schedulePortalReady, setSchedulePortalReady] = useState(false)

  useEffect(() => {
    setSchedulePortalReady(true)
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
        setOutcomeOptions(toUiOptions(rows))
      } catch {
        // Keep DEFAULT_INSPECTION_OUTCOMES
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
      } catch {
        /* non-fatal */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const selectedOutcomeOption = selectedOutcome
    ? outcomeOptions.find((o) => o.id === selectedOutcome)
    : undefined
  const requiresCloseScheduleForSelected = selectedOutcomeOption
    ? inspectionOutcomeRequiresCloseSchedule(selectedOutcomeOption)
    : false

  useEffect(() => {
    if (!requiresCloseScheduleForSelected) {
      setCloseSchedulePayload(null)
      setShowCloseModal(false)
    }
  }, [requiresCloseScheduleForSelected])

  const showInsuranceSchedule = selectedOutcome === INSURANCE_OUTCOME_ID
  const showMovingToCloseSchedule = requiresCloseScheduleForSelected
  const showDidntSitHandoff = selectedOutcome === DIDNT_SIT_OUTCOME_ID

  const handleSubmit = async () => {
    if (completed) return

    if (!selectedOutcome) {
      setError('Please select an outcome')
      return
    }

    if (selectedOutcome === RESCHEDULE_OUTCOME_ID) {
      onReschedule(appointment.id)
      return
    }

    if (selectedOutcome === INSURANCE_OUTCOME_ID) {
      if (!followUpDate || !followUpTime) {
        setError('Please select a date and time for the insurance follow-up')
        return
      }
    }

    if (requiresCloseScheduleForSelected) {
      if (!closeSchedulePayload) {
        setError('Open “Schedule close” and pick a team or closer and time slot.')
        return
      }
    }

    setSaving(true)
    setError(null)

    try {
      const followUpDateTime =
        selectedOutcome === INSURANCE_OUTCOME_ID
          ? `${followUpDate}T${followUpTime}`
          : undefined

      await onComplete({
        outcome: selectedOutcome!,
        notes,
        setterFeedback,
        scheduleFollowUp: selectedOutcome === INSURANCE_OUTCOME_ID ? true : undefined,
        followUpDate: followUpDateTime,
        requiresCloseSchedule: requiresCloseScheduleForSelected,
        closeSchedule: requiresCloseScheduleForSelected ? closeSchedulePayload : undefined,
      })

      setCompleted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save status update')
    } finally {
      setSaving(false)
    }
  }

  const handleFillLater = async () => {
    if (!onFillLater || completed) return

    setSnoozing(true)
    setError(null)
    try {
      await onFillLater()
    } catch (err) {
      setError('Failed to snooze this reminder')
    } finally {
      setSnoozing(false)
    }
  }

  const displayTz = FEEDBACK_PROMPT_DISPLAY_TIMEZONE
  const minDateYmd = calendarDateYmdInTimezone(displayTz)
  const scheduledTime = new Date(appointment.scheduled_for)
  const promptMs = promptAt ? new Date(promptAt).getTime() : null
  /** Amber header: feedback has been due for a while (not tied to UTC calendar quirks). */
  const isUrgentFollowUp =
    promptMs != null
      ? Date.now() > promptMs + 45 * 60 * 1000
      : (() => {
          const startMs = new Date(appointment.scheduled_for).getTime()
          const durMin = appointment.duration_minutes ?? 60
          const slotEndMs = startMs + durMin * 60 * 1000
          return Date.now() > slotEndMs + 30 * 60 * 1000
        })()

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header - Fixed */}
        <div className={`px-6 py-4 ${isUrgentFollowUp ? 'bg-amber-500' : 'bg-indigo-600'} text-white flex-shrink-0`}>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold">Inspection Status Update</h2>
              <p className="text-white/80 text-sm">
                {isUrgentFollowUp ? 'Status update required' : 'How did the appointment go?'}
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
                  {scheduledTime.toLocaleDateString('en-US', { timeZone: displayTz })}
                </p>
                <p className="text-sm text-gray-500">
                  {scheduledTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: displayTz })}
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
                  onClick={() => {
                    setSelectedOutcome(option.id)
                    if (inspectionOutcomeRequiresCloseSchedule(option)) {
                      setCloseSchedulePayload(null)
                      setShowCloseModal(true)
                    }
                  }}
                  className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left ${
                    selectedOutcome === option.id
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-full text-white flex items-center justify-center text-lg font-bold shrink-0 ${
                      option.color?.startsWith('#') ? '' : option.color || 'bg-gray-500'
                    }`}
                    style={option.color?.startsWith('#') ? { backgroundColor: option.color } : undefined}
                  >
                    {option.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900">{option.label}</p>
                    <p className="text-sm text-gray-500">{option.description}</p>
                  </div>
                  {selectedOutcome === option.id && (
                    <svg className="w-6 h-6 text-indigo-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Moving to Close — same scheduling as /appointments/feedback */}
          {showMovingToCloseSchedule && (
            <div className="px-6 py-4 border-t bg-green-50/80">
              <h3 className="text-sm font-semibold text-green-900 mb-1">Schedule close appointment</h3>
              <p className="text-xs text-green-800 mb-3">
                Choose a team (round-robin) or a specific closer, then pick a time—same as canvass scheduling.
              </p>
              {closeSchedulePayload ? (
                <div className="flex flex-wrap items-center gap-2 text-sm text-green-900">
                  <span className="font-medium">Ready:</span>
                  <span>
                    {closeSchedulePayload.useRoundRobin
                      ? `Team round-robin · ${closeSchedulePayload.scheduledLocal.replace('T', ' ')}`
                      : `Closer assigned · ${closeSchedulePayload.scheduledLocal.replace('T', ' ')}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowCloseModal(true)}
                    className="text-indigo-600 font-medium hover:underline"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCloseModal(true)}
                  className="w-full py-3 px-4 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700"
                >
                  Schedule close (team or closer)
                </button>
              )}
            </div>
          )}

          {/* Insurance follow-up — required date & time */}
          {showInsuranceSchedule && (
            <div className="px-6 py-4 border-t">
              <p className="text-sm font-medium text-gray-700 mb-3">Schedule insurance follow-up *</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Date</label>
                  <input
                    type="date"
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                    min={minDateYmd}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Time</label>
                  <input
                    type="time"
                    value={followUpTime}
                    onChange={(e) => setFollowUpTime(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
                <p className="text-xs text-gray-500">
                  You&apos;ll get an inspection feedback reminder after this appointment.
                </p>
              </div>
            </div>
          )}

          {/* Notes Section */}
          {selectedOutcome && selectedOutcome !== RESCHEDULE_OUTCOME_ID && (
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

          {showDidntSitHandoff && (
            <div className="px-6 py-4 border-t bg-amber-50/80">
              <h3 className="text-sm font-semibold text-amber-900 mb-1">Inside sales handoff</h3>
              <p className="text-xs text-amber-800">
                Submitting this result will automatically push the customer to the inside sales follow-up queue.
              </p>
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
            type="button"
            onClick={handleFillLater}
            disabled={saving || snoozing || completed || !onFillLater}
            className="w-full mb-2 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {snoozing ? 'Snoozing...' : 'Fill Later'}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedOutcome || saving || snoozing || completed}
            className="w-full py-4 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-lg"
          >
            {saving
              ? 'Saving...'
              : completed
              ? 'Status Updated ✓'
              : selectedOutcome === RESCHEDULE_OUTCOME_ID
              ? 'Continue to Reschedule'
              : 'Submit Status Update'}
          </button>
          <p className="mt-2 text-center text-xs text-gray-500">
            This information will be saved to the customer&apos;s file
          </p>
        </div>
      </div>

      {schedulePortalReady &&
        createPortal(
          <CloseScheduleModal
            open={showCloseModal}
            onClose={() => setShowCloseModal(false)}
            onConfirm={(params) => {
              setCloseSchedulePayload(params)
              setShowCloseModal(false)
            }}
            closeDurationMinutes={closeDurationMinutes}
            users={schedulingUsers}
            teams={schedulingTeams}
          />,
          document.body
        )}
    </div>
  )
}
