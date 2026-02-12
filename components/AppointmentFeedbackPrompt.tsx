'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface PendingPrompt {
  id: string
  appointment_id: string
  prompt_at: string
  scheduled_appointments: {
    id: string
    scheduled_for: string
    address_text: string | null
    leads?: {
      homeowner_name: string | null
      address_text: string | null
    }
    setter?: {
      full_name: string | null
    }
  }
}

export default function AppointmentFeedbackPrompt() {
  const router = useRouter()
  const [prompts, setPrompts] = useState<PendingPrompt[]>([])
  const [loading, setLoading] = useState(true)
  const [dismissing, setDismissing] = useState<string | null>(null)

  useEffect(() => {
    checkForPendingPrompts()
    // Check every 5 minutes
    const interval = setInterval(checkForPendingPrompts, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  const checkForPendingPrompts = async () => {
    try {
      const response = await fetch('/api/inspections/status')
      if (!response.ok) return
      
      const data = await response.json()
      setPrompts(data.prompts || [])
    } catch (error) {
      console.error('Error checking prompts:', error)
    } finally {
      setLoading(false)
    }
  }

  const dismissPrompt = async (promptId: string) => {
    setDismissing(promptId)
    try {
      await fetch('/api/inspections/dismiss-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt_id: promptId }),
      })
      setPrompts(prev => prev.filter(p => p.id !== promptId))
    } catch (error) {
      console.error('Error dismissing prompt:', error)
    } finally {
      setDismissing(null)
    }
  }

  if (loading || prompts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm w-full space-y-3">
      {prompts.slice(0, 3).map((prompt) => {
        const appointment = prompt.scheduled_appointments
        const appointmentDate = new Date(appointment.scheduled_for)
        
        return (
          <div
            key={prompt.id}
            className="bg-white rounded-xl shadow-lg border border-amber-200 p-4 animate-slide-up"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-gray-900 text-sm">Appointment Feedback Needed</h4>
                <p className="text-sm text-gray-600 truncate">
                  {appointment.leads?.homeowner_name || 'Customer'}
                </p>
                <p className="text-xs text-gray-500">
                  {appointmentDate.toLocaleDateString()} at {appointmentDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
            
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => router.push(`/appointments/feedback?id=${appointment.id}`)}
                className="flex-1 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700"
              >
                Give Feedback
              </button>
              <button
                onClick={() => dismissPrompt(prompt.id)}
                disabled={dismissing === prompt.id}
                className="px-3 py-2 text-gray-500 hover:bg-gray-100 rounded-lg text-sm"
              >
                {dismissing === prompt.id ? '...' : 'Later'}
              </button>
            </div>
          </div>
        )
      })}
      
      {prompts.length > 3 && (
        <div className="text-center">
          <button
            onClick={() => router.push('/appointments?filter=needs_feedback')}
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
          >
            +{prompts.length - 3} more appointments need feedback
          </button>
        </div>
      )}
      
      <style jsx>{`
        @keyframes slide-up {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
      `}</style>
    </div>
  )
}
