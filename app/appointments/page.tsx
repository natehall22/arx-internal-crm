'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'

interface Appointment {
  id: string
  scheduled_for: string
  duration_minutes: number
  address_text: string | null
  notes: string | null
  status: string
  closer_user_id: string
  canvasser_user_id: string | null
  leads?: {
    homeowner_name: string | null
    phone: string | null
  }
  closer?: {
    id: string
    full_name: string | null
  }
  setter?: {
    id: string
    full_name: string | null
  }
  feedback?: {
    outcome: string
    notes: string | null
    setter_feedback: string | null
    completed_at: string
  } | null
}

interface User {
  id: string
  full_name: string | null
  role: string
}

export default function AppointmentsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [profile, setProfile] = useState<any>(null)
  /** Session token echoed from GET /api/appointments for PATCH when cookies are flaky. */
  const [sessionAccessToken, setSessionAccessToken] = useState<string | null>(null)
  const [canReassign, setCanReassign] = useState(false)
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'past' | 'needs_feedback'>('upcoming')
  const [error, setError] = useState<string | null>(null)

  // Reassignment modal
  const [reassignModal, setReassignModal] = useState<Appointment | null>(null)
  const [newCloserId, setNewCloserId] = useState('')
  const [reassigning, setReassigning] = useState(false)

  useEffect(() => {
    loadData()
  }, [filter])

  const loadData = async () => {
    try {
      const response = await fetch(`/api/appointments?filter=${filter}`)
      
      if (response.status === 401) {
        router.push('/login')
        return
      }

      if (!response.ok) {
        throw new Error('Failed to load appointments')
      }

      const data = await response.json()
      setAppointments(data.appointments || [])
      setUsers(data.users || [])
      setProfile(data.profile)
      setCanReassign(!!data.canReassign)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const handleReassign = async () => {
    if (!reassignModal || !newCloserId) return

    setReassigning(true)
    try {
      const response = await fetch(`/api/appointments/${reassignModal.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionAccessToken ? { Authorization: `Bearer ${sessionAccessToken}` } : {}),
        },
        body: JSON.stringify({ new_closer_id: newCloserId }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to reassign')
      }

      setReassignModal(null)
      setNewCloserId('')
      await loadData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reassign')
    } finally {
      setReassigning(false)
    }
  }

  const isPastDue = (date: string) => new Date(date) < new Date()

  const getStatusBadge = (appointment: Appointment) => {
    const isPast = isPastDue(appointment.scheduled_for)
    
    if (appointment.status === 'completed') {
      return <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">Completed</span>
    }
    if (appointment.status === 'cancelled') {
      return <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full">Cancelled</span>
    }
    if (appointment.status === 'no_show') {
      return <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full">No Show</span>
    }
    if (isPast && appointment.status === 'scheduled') {
      return <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs rounded-full">Needs Feedback</span>
    }
    return <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">Scheduled</span>
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/4 mb-8"></div>
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-24 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Appointments</h1>
            <p className="text-gray-500 mt-1">Manage scheduled inspections and appointments</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-6">
          {(['upcoming', 'past', 'needs_feedback', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100 border'
              }`}
            >
              {f === 'upcoming' && 'Upcoming'}
              {f === 'past' && 'Past'}
              {f === 'needs_feedback' && 'Needs Feedback'}
              {f === 'all' && 'All'}
            </button>
          ))}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {/* Appointments List */}
        {appointments.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center">
            <p className="text-gray-500">No appointments found</p>
          </div>
        ) : (
          <div className="space-y-4">
            {appointments.map((appointment) => {
              const appointmentDate = new Date(appointment.scheduled_for)
              const needsFeedback = isPastDue(appointment.scheduled_for) && appointment.status === 'scheduled'

              return (
                <div
                  key={appointment.id}
                  className={`bg-white rounded-xl shadow-sm border p-6 ${
                    needsFeedback ? 'border-amber-300 bg-amber-50/50' : ''
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-gray-900">
                          {appointment.leads?.homeowner_name || 'Unknown Customer'}
                        </h3>
                        {getStatusBadge(appointment)}
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-gray-500">Date & Time</p>
                          <p className="font-medium text-gray-900">
                            {appointmentDate.toLocaleDateString('en-US', { timeZone: 'America/New_York' })} at {appointmentDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' })}
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-500">Duration</p>
                          <p className="font-medium text-gray-900">{appointment.duration_minutes} min</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Closer</p>
                          <p className="font-medium text-gray-900">{appointment.closer?.full_name || 'Unassigned'}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Set By</p>
                          <p className="font-medium text-gray-900">{appointment.setter?.full_name || 'N/A'}</p>
                        </div>
                      </div>

                      {appointment.address_text && (
                        <p className="text-sm text-gray-500 mt-2">
                          <span className="font-medium">Address:</span> {appointment.address_text}
                        </p>
                      )}
                      
                      {/* Show feedback if available */}
                      {appointment.feedback && (
                        <div className="mt-3 p-3 bg-gray-50 rounded-lg border">
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                              appointment.feedback.outcome === 'sale' ? 'bg-green-100 text-green-700' :
                              appointment.feedback.outcome === 'not_home' ? 'bg-red-100 text-red-700' :
                              appointment.feedback.outcome === 'said_no' ? 'bg-gray-100 text-gray-700' :
                              appointment.feedback.outcome === 'rescheduled' ? 'bg-amber-100 text-amber-700' :
                              'bg-blue-100 text-blue-700'
                            }`}>
                              {appointment.feedback.outcome === 'sale' ? 'Moving Forward' :
                               appointment.feedback.outcome === 'not_home' ? 'No Show' :
                               appointment.feedback.outcome === 'said_no' ? 'Said No' :
                               appointment.feedback.outcome === 'rescheduled' ? 'Rescheduled' :
                               appointment.feedback.outcome}
                            </span>
                            <span className="text-xs text-gray-400">
                              {new Date(appointment.feedback.completed_at).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}
                            </span>
                          </div>
                          {appointment.feedback.setter_feedback && (
                            <p className="text-sm text-gray-700">
                              <span className="font-medium">Feedback:</span> {appointment.feedback.setter_feedback}
                            </p>
                          )}
                          {appointment.feedback.notes && !appointment.feedback.setter_feedback && (
                            <p className="text-sm text-gray-700">
                              <span className="font-medium">Notes:</span> {appointment.feedback.notes}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 ml-4">
                      {needsFeedback && (
                        <Link
                          href={`/appointments/feedback?id=${appointment.id}`}
                          className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700"
                        >
                          Give Feedback
                        </Link>
                      )}
                      
                      {canReassign && appointment.status === 'scheduled' && (
                        <button
                          onClick={() => {
                            setReassignModal(appointment)
                            setNewCloserId(appointment.closer_user_id)
                          }}
                          className="px-3 py-2 text-indigo-600 hover:bg-indigo-50 rounded-lg text-sm font-medium"
                        >
                          Reassign
                        </button>
                      )}

                      <Link
                        href={`/appointments/${appointment.id}`}
                        className="px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm"
                      >
                        View
                      </Link>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Reassignment Modal */}
        {reassignModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Reassign Appointment</h2>
              
              <p className="text-sm text-gray-600 mb-4">
                Reassign the appointment with <strong>{reassignModal.leads?.homeowner_name || 'customer'}</strong> to a different rep.
              </p>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Assign to
                </label>
                <select
                  value={newCloserId}
                  onChange={(e) => setNewCloserId(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  <option value="">Select a rep...</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.full_name || 'Unknown'} ({user.role})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setReassignModal(null)
                    setNewCloserId('')
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReassign}
                  disabled={!newCloserId || newCloserId === reassignModal.closer_user_id || reassigning}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50"
                >
                  {reassigning ? 'Reassigning...' : 'Reassign'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
