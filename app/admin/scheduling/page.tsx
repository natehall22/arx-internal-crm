'use client'

import { useEffect, useState } from 'react'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { User, Team, UserGoogleToken } from '@/lib/types/database'

type UserWithCalendar = User & {
  google_token?: UserGoogleToken | null
  team?: Team | null
}

export default function SchedulingPage() {
  const searchParams = useSearchParams()
  const success = searchParams.get('success')
  const error = searchParams.get('error')

  const [currentUser, setCurrentUser] = useState<UserWithCalendar | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (success === 'calendar_connected') {
      setMessage({ type: 'success', text: 'Google Calendar connected successfully!' })
    } else if (error) {
      const errorMessages: Record<string, string> = {
        oauth_denied: 'Calendar access was denied',
        missing_params: 'Invalid OAuth response',
        no_profile: 'User profile not found',
        token_storage: 'Failed to save calendar connection',
        callback_failed: 'Calendar connection failed',
      }
      setMessage({ type: 'error', text: errorMessages[error] || 'An error occurred' })
    }
  }, [success, error])

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const res = await fetch('/api/admin/scheduling')
      const data = await res.json()
      
      if (!res.ok) {
        console.error('Failed to load scheduling data:', data.error)
        setLoading(false)
        return
      }

      setCurrentUser(data.profile)
      setTeams(data.teams || [])
    } catch (error) {
      console.error('Failed to load scheduling data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnectCalendar = async () => {
    if (!currentUser) return
    if (!confirm('Disconnect your Google Calendar? You will need to reconnect to use scheduling features.')) return

    try {
      const res = await fetch('/api/admin/scheduling', { method: 'DELETE' })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to disconnect')
      }

      await loadData()
      setMessage({ type: 'success', text: 'Calendar disconnected' })
    } catch (error: any) {
      console.error('Failed to disconnect calendar:', error)
      setMessage({ type: 'error', text: error.message || 'Failed to disconnect calendar' })
    }
  }

  const isCalendarConnected = currentUser?.google_token != null
  const isTokenExpired = currentUser?.google_token 
    ? new Date(currentUser.google_token.expires_at) < new Date()
    : false

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
            <Link href="/admin" className="hover:text-indigo-600">Admin</Link>
            <span>/</span>
            <span>Scheduling</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Scheduling Settings</h1>
          <p className="mt-1 text-gray-600">
            Connect your Google Calendar for automatic appointment scheduling
          </p>
        </div>

        {message && (
          <div className={`mb-6 p-4 rounded-lg ${
            message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            {message.text}
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-500">
            Loading...
          </div>
        ) : (
          <div className="space-y-6">
            {/* Calendar Connection */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Google Calendar</h2>
              
              {isCalendarConnected ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${isTokenExpired ? 'bg-amber-500' : 'bg-green-500'}`} />
                    <span className={isTokenExpired ? 'text-amber-700' : 'text-green-700'}>
                      {isTokenExpired ? 'Token expired - reconnect required' : 'Calendar connected'}
                    </span>
                  </div>
                  
                  <p className="text-sm text-gray-500">
                    Your calendar is connected. The system can check your availability and create appointments.
                  </p>

                  <div className="flex gap-3">
                    {isTokenExpired && (
                      <Link
                        href="/api/auth/google"
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
                      >
                        Reconnect Calendar
                      </Link>
                    )}
                    <button
                      onClick={handleDisconnectCalendar}
                      className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg font-medium"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-gray-600">
                    Connect your Google Calendar to enable automatic scheduling. This allows:
                  </p>
                  <ul className="text-sm text-gray-500 space-y-1 ml-4 list-disc">
                    <li>Checking your availability before scheduling appointments</li>
                    <li>Automatically creating calendar events for inspections</li>
                    <li>Respecting buffer times between appointments</li>
                  </ul>
                  
                  <Link
                    href="/api/auth/google"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Connect Google Calendar
                  </Link>
                </div>
              )}
            </div>

            {/* Team Closer Queues */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Round-Robin Queues</h2>
              <p className="text-gray-600 mb-4">
                Manage closer queues for each team. When a canvasser schedules an inspection, 
                the system assigns it to the next available closer in the queue.
              </p>
              
              {teams.length === 0 ? (
                <p className="text-gray-500 italic">No teams created yet.</p>
              ) : (
                <div className="space-y-2">
                  {teams.map((team) => (
                    <Link
                      key={team.id}
                      href={`/admin/teams/${team.id}/closers`}
                      className="flex items-center justify-between p-4 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors"
                    >
                      <div>
                        <p className="font-medium text-gray-900">{team.name}</p>
                        <p className="text-sm text-gray-500">Manage closer queue</p>
                      </div>
                      <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* How it Works */}
            <div className="bg-blue-50 rounded-xl p-6">
              <h3 className="font-semibold text-blue-900 mb-3">How Scheduling Works</h3>
              <ol className="text-sm text-blue-800 space-y-2 list-decimal ml-4">
                <li>Canvasser schedules an inspection from the canvass map</li>
                <li>System checks the team's closer queue (priority order)</li>
                <li>For each closer, checks Google Calendar availability</li>
                <li>First available closer gets assigned the appointment</li>
                <li>Calendar event is created automatically</li>
                <li>Lead is converted to an Opportunity assigned to that closer</li>
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
