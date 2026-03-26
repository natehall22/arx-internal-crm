import Link from 'next/link'
import { labelForCloseOutcome } from '@/lib/close-feedback-outcomes'

type Props = {
  opportunityId: string
  /** ISO string for scheduled close time */
  scheduledFor: string | null
  outcome: string | null
  /** Resolved label from org Close outcomes settings (optional) */
  outcomeLabel?: string | null
  outcomeSubmittedAt: string | null
  /** Link to close-feedback: use close_appointments.id when available */
  closeAppointmentId: string | null
  /** Legacy: scheduled_appointments row when no close_appointments row yet */
  scheduledAppointmentId: string | null
}

function formatEt(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function CloseAppointmentStatusSection({
  opportunityId,
  scheduledFor,
  outcome,
  outcomeLabel,
  outcomeSubmittedAt,
  closeAppointmentId,
  scheduledAppointmentId,
}: Props) {
  const hasAnyClose = Boolean(scheduledFor)
  const feedbackHref =
    closeAppointmentId || scheduledAppointmentId
      ? closeAppointmentId
        ? `/appointments/close-feedback?id=${closeAppointmentId}&opportunity_id=${opportunityId}`
        : `/appointments/close-feedback?scheduled_appointment_id=${scheduledAppointmentId}&opportunity_id=${opportunityId}`
      : null

  const now = Date.now()
  const scheduledMs = scheduledFor ? new Date(scheduledFor).getTime() : null
  const isPast = scheduledMs != null && scheduledMs <= now

  if (!hasAnyClose) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-2">Close Appointment Status</h2>
        <p className="text-sm text-gray-600">No close appointment scheduled yet.</p>
      </div>
    )
  }

  if (outcome) {
    return (
      <div className="bg-white shadow rounded-lg p-6 mb-6 border border-green-200">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Close Appointment Status</h2>
        <div className="p-4 rounded-lg bg-green-50 border border-green-200">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-green-900">Close outcome recorded</p>
              <span className="inline-flex mt-1 px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                {outcomeLabel ?? labelForCloseOutcome(outcome)}
              </span>
            </div>
          </div>
          {scheduledFor && (
            <p className="text-sm text-green-800 mt-2">
              Appointment was scheduled for {formatEt(scheduledFor)} (ET)
            </p>
          )}
          {outcomeSubmittedAt && (
            <p className="text-xs text-green-700 mt-1">
              Submitted {formatEt(outcomeSubmittedAt)} (ET)
            </p>
          )}
        </div>
      </div>
    )
  }

  if (!isPast) {
    return (
      <div className="bg-white shadow rounded-lg p-6 mb-6 border border-blue-100">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Close Appointment Status</h2>
        <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
          <h3 className="text-sm font-semibold text-blue-900">Close Appointment Scheduled</h3>
          <p className="text-sm text-blue-800 mt-1">
            Scheduled for {scheduledFor ? formatEt(scheduledFor) : '—'} (ET)
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white shadow rounded-lg p-6 mb-6">
      <h2 className="text-xl font-bold text-gray-900 mb-4">Close Appointment Status</h2>
      <div className="p-4 rounded-lg bg-amber-50 border border-amber-200">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <svg className="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-amber-800">Close Appointment Not Updated</h3>
            <p className="text-sm text-amber-700 mt-1">
              The close appointment outcome has not been recorded yet. Appointment was scheduled for{' '}
              {scheduledFor ? formatEt(scheduledFor) : '—'} (ET).
            </p>
            {feedbackHref && (
              <Link
                href={feedbackHref}
                className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 min-h-[44px]"
              >
                Update Close Appointment Status
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
