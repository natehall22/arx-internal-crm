'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAppointmentPrompts } from '@/hooks/useRealtimeUpdates'
import {
  FEEDBACK_PROMPT_ESCALATION_THRESHOLD,
  isPromptEscalated,
} from '@/lib/inspection-feedback-prompt'

const FEEDBACK_FORM_PATHS = ['/appointments/feedback', '/appointments/close-feedback']

function feedbackUrl(appointment: { id: string; lead_id: string | null; leads?: { id?: string } }): string {
  const leadId = appointment.leads?.id || appointment.lead_id
  return leadId
    ? `/appointments/feedback?id=${appointment.id}&lead_id=${leadId}`
    : `/appointments/feedback?id=${appointment.id}`
}

function formatWhen(scheduledFor: string): string {
  const date = new Date(scheduledFor)
  return `${date.toLocaleDateString('en-US', { timeZone: 'America/New_York' })} at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' })}`
}

export default function AppointmentFeedbackPrompt() {
  const router = useRouter()
  const pathname = usePathname()
  const { prompts, refresh } = useAppointmentPrompts()
  const [dismissing, setDismissing] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  // Safety valve: if a prompt can never actually be submitted (broken/deleted appointment data —
  // see app/api/inspections/status/route.ts's appointment-lookup fallback), the blocking modal
  // below would otherwise trap the rep with zero way out. This bypass is session-only (component
  // state, gone on reload) — it relieves the lockout without weakening the escalation on the server.
  const [bypassedIds, setBypassedIds] = useState<Set<string>>(new Set())

  const dismissPrompt = async (promptId: string) => {
    setDismissing(promptId)
    try {
      // No local "hide it now" state here on purpose: a snooze is timed (resurfaces after a few
      // hours, or immediately if it just escalated), so the server's prompts list is the only
      // correct source of truth. refresh() re-fetches it right away.
      await fetch('/api/inspections/dismiss-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt_id: promptId }),
      })
      refresh()
    } catch (error) {
      console.error('Error dismissing prompt:', error)
    } finally {
      setDismissing(null)
    }
  }

  if (FEEDBACK_FORM_PATHS.some((path) => pathname?.startsWith(path))) return null

  const live = prompts
  const escalated = live
    .filter(p => isPromptEscalated(p.snooze_count) && !bypassedIds.has(p.id))
    .sort((a, b) => a.prompt_at.localeCompare(b.prompt_at))
  // Note: `dismissed` isn't a visibility gate here — the server query already only returns prompts
  // whose prompt_at is due (a snooze pushes prompt_at forward, see dismiss-prompt route). Once that
  // timer elapses it's due again even though `dismissed` stays true for the admin dashboard's history.
  const pending = live.filter(p => !isPromptEscalated(p.snooze_count))

  // Escalated (snoozed too many times) blocks everything else — one at a time, no way out but to give feedback.
  if (escalated.length > 0) {
    const prompt = escalated[0]
    const appointment = prompt.scheduled_appointments
    return (
      <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl border border-red-200 p-6 max-w-sm w-full">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-gray-900">Feedback overdue</h4>
              <p className="text-sm text-gray-600 truncate">{appointment.leads?.homeowner_name || 'Customer'}</p>
              <p className="text-xs text-gray-500">{formatWhen(appointment.scheduled_for)}</p>
            </div>
          </div>
          <p className="text-sm text-gray-700 mb-4">
            This appointment has been snoozed {prompt.snooze_count}x. It can&apos;t be put off any longer —
            submit the outcome to continue.
            {escalated.length > 1 && (
              <span className="block mt-1 text-xs text-gray-500">{escalated.length} appointments need this.</span>
            )}
          </p>
          <button
            onClick={() => router.push(feedbackUrl(appointment))}
            className="w-full py-2.5 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700"
          >
            Give Feedback Now
          </button>
          <button
            onClick={() => setBypassedIds(prev => new Set(Array.from(prev).concat(prompt.id)))}
            className="w-full mt-2 py-1.5 text-xs text-[#2c2c2a] hover:text-black underline"
          >
            Can&apos;t submit this? Let me back into the app (contact your manager)
          </button>
        </div>
      </div>
    )
  }

  if (pending.length === 0) return null

  return (
    <div className="fixed z-50 right-3 sm:right-4 bottom-[calc(1rem+var(--safe-area-inset-bottom))] w-[min(calc(100vw-1.5rem),24rem)]">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between gap-3 bg-amber-600 text-white px-4 py-3 rounded-xl shadow-lg hover:bg-amber-700"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {pending.length} appointment{pending.length === 1 ? '' : 's'} need feedback
        </span>
        <svg
          className={`w-4 h-4 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-2 bg-white rounded-xl shadow-lg border border-amber-200 overflow-y-auto divide-y divide-gray-100" style={{ maxHeight: 'calc(70vh - 60px)' }}>
          {pending.map((prompt) => {
            const appointment = prompt.scheduled_appointments
            const nearEscalation = prompt.snooze_count === FEEDBACK_PROMPT_ESCALATION_THRESHOLD - 1
            return (
              <div key={prompt.id} className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm truncate">
                    {appointment.leads?.homeowner_name || 'Customer'}
                  </p>
                  <p className="text-xs text-gray-500">{formatWhen(appointment.scheduled_for)}</p>
                  {nearEscalation && (
                    <p className="text-xs text-red-600 mt-0.5">Last snooze before this locks in</p>
                  )}
                </div>
                <button
                  onClick={() => router.push(feedbackUrl(appointment))}
                  className="px-3 py-1.5 bg-amber-600 text-white text-xs font-medium rounded-lg hover:bg-amber-700 whitespace-nowrap"
                >
                  Give Feedback
                </button>
                <button
                  onClick={() => dismissPrompt(prompt.id)}
                  disabled={dismissing === prompt.id}
                  className="px-2 py-1.5 text-gray-500 hover:bg-gray-100 rounded-lg text-xs whitespace-nowrap"
                >
                  {dismissing === prompt.id ? '...' : 'Later'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
