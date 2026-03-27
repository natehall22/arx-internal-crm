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

type AppointmentType = {
  id: string
  name: string
  duration_minutes: number
  buffer_after_minutes?: number | null
  color: string
  description: string | null
  category: 'inspection' | 'close' | 'other'
  active: boolean
  sort_order: number
}

export default function SchedulingPage() {
  const searchParams = useSearchParams()
  const success = searchParams.get('success')
  const error = searchParams.get('error')

  const [currentUser, setCurrentUser] = useState<UserWithCalendar | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showTypeModal, setShowTypeModal] = useState(false)
  const [editingType, setEditingType] = useState<AppointmentType | null>(null)
  const [typeForm, setTypeForm] = useState({
    name: '',
    duration_minutes: 60,
    buffer_after_minutes: 0,
    color: '#3b82f6',
    description: '',
    category: 'inspection' as 'inspection' | 'close' | 'other',
    active: true,
  })

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
      const [schedulingRes, typesRes] = await Promise.all([
        fetch('/api/admin/scheduling'),
        fetch('/api/admin/appointment-types'),
      ])
      
      const schedulingData = await schedulingRes.json()
      const typesData = await typesRes.json()
      
      if (!schedulingRes.ok) {
        console.error('Failed to load scheduling data:', schedulingData.error)
        setLoading(false)
        return
      }

      setCurrentUser(schedulingData.profile)
      setTeams(schedulingData.teams || [])
      setAppointmentTypes(typesData.appointmentTypes || [])
    } catch (error) {
      console.error('Failed to load scheduling data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveType = async () => {
    try {
      const method = editingType ? 'PUT' : 'POST'
      const body = editingType 
        ? { id: editingType.id, ...typeForm }
        : typeForm

      const res = await fetch('/api/admin/appointment-types', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save')
      }

      await loadData()
      setShowTypeModal(false)
      setEditingType(null)
      setTypeForm({
        name: '',
        duration_minutes: 60,
        buffer_after_minutes: 0,
        color: '#3b82f6',
        description: '',
        category: 'inspection',
        active: true,
      })
      setMessage({ type: 'success', text: `Appointment type ${editingType ? 'updated' : 'created'}` })
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save appointment type' })
    }
  }

  const handleDeleteType = async (id: string) => {
    if (!confirm('Delete this appointment type?')) return

    try {
      const res = await fetch(`/api/admin/appointment-types?id=${id}`, { method: 'DELETE' })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete')
      }

      await loadData()
      setMessage({ type: 'success', text: 'Appointment type deleted' })
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to delete appointment type' })
    }
  }

  const openEditModal = (type: AppointmentType) => {
    setEditingType(type)
    setTypeForm({
      name: type.name,
      duration_minutes: type.duration_minutes,
      buffer_after_minutes: type.buffer_after_minutes ?? 0,
      color: type.color,
      description: type.description || '',
      category: type.category,
      active: type.active,
    })
    setShowTypeModal(true)
  }

  const openCreateModal = () => {
    setEditingType(null)
    setTypeForm({
      name: '',
      duration_minutes: 60,
      buffer_after_minutes: 0,
      color: '#3b82f6',
      description: '',
      category: 'inspection',
      active: true,
    })
    setShowTypeModal(true)
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
                    {isTokenExpired 
                      ? 'Your calendar connection has expired. Click "Reconnect Calendar" to restore scheduling features.'
                      : 'Your calendar is connected. The system can check your availability and create appointments.'
                    }
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

            {/* Appointment Types */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Appointment Types</h2>
                  <p className="text-sm text-gray-500">
                    Durations and &quot;buffer after&quot; minutes here drive canvass scheduling, inspection feedback
                    timing, close scheduling (including round-robin), reschedules, and follow-ups—matching by
                    category and name. Falls back to the org default gap between appointments when unset.
                  </p>
                </div>
                <button
                  onClick={openCreateModal}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium text-sm"
                >
                  Add Type
                </button>
              </div>

              {/* Inspection Types (Setter) */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                  Inspection Types (Setter schedules)
                </h3>
                <div className="space-y-2">
                  {appointmentTypes.filter(t => t.category === 'inspection').length === 0 ? (
                    <p className="text-gray-400 text-sm italic">No inspection types configured</p>
                  ) : (
                    appointmentTypes.filter(t => t.category === 'inspection').map((type) => (
                      <div
                        key={type.id}
                        className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-gray-300"
                      >
                        <div className="flex items-center gap-3">
                          <div 
                            className="w-4 h-4 rounded-full" 
                            style={{ backgroundColor: type.color }}
                          />
                          <div>
                            <p className="font-medium text-gray-900">{type.name}</p>
                            <p className="text-sm text-gray-500">
                              {type.duration_minutes} min
                              {(type.buffer_after_minutes ?? 0) > 0
                                ? ` · +${type.buffer_after_minutes} min after slot`
                                : ''}
                              {type.description && ` • ${type.description}`}
                            </p>
                          </div>
                          {!type.active && (
                            <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">Inactive</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEditModal(type)}
                            className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDeleteType(type.id)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Close Types (Closer) */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  Close Types (Closer schedules from flow cards)
                </h3>
                <div className="space-y-2">
                  {appointmentTypes.filter(t => t.category === 'close').length === 0 ? (
                    <p className="text-gray-400 text-sm italic">No close types configured</p>
                  ) : (
                    appointmentTypes.filter(t => t.category === 'close').map((type) => (
                      <div
                        key={type.id}
                        className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-gray-300"
                      >
                        <div className="flex items-center gap-3">
                          <div 
                            className="w-4 h-4 rounded-full" 
                            style={{ backgroundColor: type.color }}
                          />
                          <div>
                            <p className="font-medium text-gray-900">{type.name}</p>
                            <p className="text-sm text-gray-500">
                              {type.duration_minutes} min
                              {(type.buffer_after_minutes ?? 0) > 0
                                ? ` · +${type.buffer_after_minutes} min after slot`
                                : ''}
                              {type.description && ` • ${type.description}`}
                            </p>
                          </div>
                          {!type.active && (
                            <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">Inactive</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEditModal(type)}
                            className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDeleteType(type.id)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Other Types */}
              {appointmentTypes.filter(t => t.category === 'other').length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-gray-500"></span>
                    Other Types
                  </h3>
                  <div className="space-y-2">
                    {appointmentTypes.filter(t => t.category === 'other').map((type) => (
                      <div
                        key={type.id}
                        className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-gray-300"
                      >
                        <div className="flex items-center gap-3">
                          <div 
                            className="w-4 h-4 rounded-full" 
                            style={{ backgroundColor: type.color }}
                          />
                          <div>
                            <p className="font-medium text-gray-900">{type.name}</p>
                            <p className="text-sm text-gray-500">
                              {type.duration_minutes} min
                              {(type.buffer_after_minutes ?? 0) > 0
                                ? ` · +${type.buffer_after_minutes} min after slot`
                                : ''}
                              {type.description && ` • ${type.description}`}
                            </p>
                          </div>
                          {!type.active && (
                            <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">Inactive</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEditModal(type)}
                            className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDeleteType(type.id)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
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
                <li>System checks the team&apos;s closer queue (priority order)</li>
                <li>For each closer, checks Google Calendar availability</li>
                <li>First available closer gets assigned the appointment</li>
                <li>Calendar event is created automatically</li>
                <li>Lead is converted to an Opportunity assigned to that closer</li>
              </ol>
            </div>
          </div>
        )}

        {/* Appointment Type Modal */}
        {showTypeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto bg-black/50">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[min(90vh,calc(100dvh-2rem))] flex flex-col overflow-hidden">
              <h3 className="text-lg font-semibold text-gray-900 px-6 pt-6 pb-2 flex-shrink-0">
                {editingType ? 'Edit Appointment Type' : 'New Appointment Type'}
              </h3>

              <div className="space-y-4 px-6 overflow-y-auto min-h-0 flex-1 py-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    type="text"
                    value={typeForm.name}
                    onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
                    placeholder="e.g., Initial Inspection"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <select
                    value={typeForm.category}
                    onChange={(e) => setTypeForm({ ...typeForm, category: e.target.value as 'inspection' | 'close' | 'other' })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
                  >
                    <option value="inspection">Inspection (Setter schedules)</option>
                    <option value="close">Close (Closer schedules from flow cards)</option>
                    <option value="other">Other</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    {typeForm.category === 'inspection' && 'Used when setters schedule appointments from the canvass app'}
                    {typeForm.category === 'close' && 'Used when closers schedule follow-up or close appointments from flow cards'}
                    {typeForm.category === 'other' && 'General purpose appointment type'}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Duration (minutes)</label>
                  <select
                    value={typeForm.duration_minutes}
                    onChange={(e) => setTypeForm({ ...typeForm, duration_minutes: parseInt(e.target.value, 10) })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
                  >
                    <option value={15}>15 minutes</option>
                    <option value={30}>30 minutes</option>
                    <option value={45}>45 minutes</option>
                    <option value={60}>1 hour</option>
                    <option value={90}>1.5 hours</option>
                    <option value={120}>2 hours</option>
                    <option value={180}>3 hours</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Buffer after slot (minutes)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={480}
                    step={5}
                    value={typeForm.buffer_after_minutes}
                    onChange={(e) =>
                      setTypeForm({
                        ...typeForm,
                        buffer_after_minutes: Math.max(0, parseInt(e.target.value, 10) || 0),
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Minutes after the slot end counted toward inspection feedback prompt timing (together with
                    the org-wide feedback delay). If no matching type row exists, the org default gap between
                    appointments is used instead.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={typeForm.color}
                      onChange={(e) => setTypeForm({ ...typeForm, color: e.target.value })}
                      className="w-10 h-10 rounded border border-gray-300 cursor-pointer"
                    />
                    <div className="flex gap-2">
                      {['#3b82f6', '#22c55e', '#ef4444', '#f59e0b', '#8b5cf6', '#ec4899'].map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setTypeForm({ ...typeForm, color })}
                          className={`w-6 h-6 rounded-full border-2 ${typeForm.color === color ? 'border-gray-900' : 'border-transparent'}`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
                  <input
                    type="text"
                    value={typeForm.description}
                    onChange={(e) => setTypeForm({ ...typeForm, description: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
                    placeholder="Brief description"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="active"
                    checked={typeForm.active}
                    onChange={(e) => setTypeForm({ ...typeForm, active: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                  />
                  <label htmlFor="active" className="text-sm text-gray-700">Active</label>
                </div>
              </div>

              <div className="flex justify-end gap-3 px-6 pb-6 pt-4 border-t border-gray-100 flex-shrink-0 bg-white">
                <button
                  onClick={() => {
                    setShowTypeModal(false)
                    setEditingType(null)
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveType}
                  disabled={!typeForm.name}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50"
                >
                  {editingType ? 'Save Changes' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
