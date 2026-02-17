'use client'

import { useEffect, useState, useCallback } from 'react'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'
import type { Team, User, TeamCloserQueue } from '@/lib/types/database'

type CloserWithQueue = User & {
  queue?: TeamCloserQueue
}

export default function CloserQueuePage({ params }: { params: { id: string } }) {
  const teamId = params.id

  const [team, setTeam] = useState<Team | null>(null)
  const [closers, setClosers] = useState<CloserWithQueue[]>([])
  const [availableUsers, setAvailableUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

  useEffect(() => {
    loadData()
  }, [teamId])

  const loadData = async () => {
    const supabase = createClientBrowser()

    // Use API to load team (bypasses RLS issues)
    try {
      const response = await fetch(`/api/admin/data?resource=teams`)
      console.log('Closer queue - API response status:', response.status)
      
      if (!response.ok) {
        console.error('Closer queue - API response not ok:', response.status)
        setError('Failed to load teams')
        setLoading(false)
        return
      }
      
      const data = await response.json()
      console.log('Closer queue - API returned teams:', data.teams?.length, 'teams')
      console.log('Closer queue - Looking for team ID:', teamId)
      
      const team = data.teams?.find((t: any) => t.id === teamId)
      console.log('Closer queue - Found team:', team ? team.name : 'NOT FOUND')
      
      if (!team) {
        setError('Team not found')
        setLoading(false)
        return
      }
      
      setTeam(team)
      await loadQueueData(supabase, teamId)
    } catch (e) {
      console.error('Closer queue - Failed to load team:', e)
      setError('Failed to load team')
      setLoading(false)
    }
  }
  
  const loadQueueData = async (_supabase: any, teamIdToLoad: string) => {
    try {
      console.log('Closer queue - Loading queue data for team:', teamIdToLoad)
      
      // Load closer queue via API to bypass RLS
      const queueResponse = await fetch(`/api/admin/team-closer-queue?team_id=${teamIdToLoad}`)
      
      if (!queueResponse.ok) {
        console.error('Closer queue - Failed to fetch queue:', queueResponse.status)
        setLoading(false)
        return
      }
      
      const queueApiData = await queueResponse.json()
      const queueData = queueApiData.queue || []
      
      console.log('Closer queue - Queue from API:', queueData.length, 'closers')

      const closersWithQueue: CloserWithQueue[] = queueData.map((q: any) => ({
        ...q.users,
        queue: {
          id: q.id,
          org_id: q.org_id,
          team_id: q.team_id,
          user_id: q.user_id,
          priority: q.priority,
          buffer_minutes: q.buffer_minutes,
          buffer_before: q.buffer_before ?? 0,
          buffer_after: q.buffer_after ?? q.buffer_minutes ?? 15,
          active: q.active,
          last_assigned_at: q.last_assigned_at,
          created_at: q.created_at,
          updated_at: q.updated_at,
        }
      }))

      setClosers(closersWithQueue)

      // Load available users via API to bypass RLS
      console.log('Closer queue - Fetching users via API')
      const usersResponse = await fetch('/api/admin/data?resource=users')
      
      if (!usersResponse.ok) {
        console.error('Closer queue - Failed to fetch users:', usersResponse.status)
        setLoading(false)
        return
      }
      
      const usersApiData = await usersResponse.json()
      const usersData = usersApiData.users || []
      
      console.log('Closer queue - Users from API:', usersData.length)

      // Filter to users who can receive appointments:
      // - Users with can_receive_appointments = true (explicitly enabled)
      // - Users with can_receive_appointments = null AND sales roles (default behavior)
      const queueUserIds = closersWithQueue.map(c => c.id)
      const appointmentEligibleRoles = ['sales_rep', 'rep', 'closer', 'sales_manager', 'regional_manager', 'admin']
      const available = (usersData || []).filter((u: any) => {
        if (queueUserIds.includes(u.id)) return false
        if (u.can_receive_appointments === false) return false
        if (u.can_receive_appointments === true) return true
        return appointmentEligibleRoles.includes(u.role)
      })
      
      console.log('Closer queue - Available users after filtering:', available.map((u: any) => ({ name: u.full_name, role: u.role, can_receive: u.can_receive_appointments })))
      setAvailableUsers(available)

      setLoading(false)
    } catch (e) {
      console.error('Closer queue - loadQueueData error:', e)
      setLoading(false)
    }
  }

  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedIndex === null || draggedIndex === index) return

    const newClosers = [...closers]
    const draggedItem = newClosers[draggedIndex]
    newClosers.splice(draggedIndex, 1)
    newClosers.splice(index, 0, draggedItem)
    
    setClosers(newClosers)
    setDraggedIndex(index)
  }

  const handleDragEnd = async () => {
    if (draggedIndex === null) return
    setDraggedIndex(null)

    // Save new priorities
    setSaving(true)
    const supabase = createClientBrowser()

    for (let i = 0; i < closers.length; i++) {
      const closer = closers[i]
      if (closer.queue && closer.queue.priority !== i) {
        await supabase
          .from('team_closer_queue')
          .update({ priority: i })
          .eq('id', closer.queue.id)
      }
    }

    setSaving(false)
  }

  const handleAddCloser = async () => {
    if (!selectedUserId) {
      setError('Select a user to add')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/team-closer-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_id: teamId,
          user_id: selectedUserId,
          buffer_minutes: 30, // Default 30 min buffer
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to add closer')
      } else {
        setShowAddModal(false)
        setSelectedUserId('')
        await loadData()
      }
    } catch (e) {
      setError('Failed to add closer')
    }
    setSaving(false)
  }

  const handleRemoveCloser = async (closer: CloserWithQueue) => {
    if (!closer.queue) return
    if (!confirm(`Remove ${closer.full_name || 'this user'} from the closer queue?`)) return

    try {
      const response = await fetch(`/api/admin/team-closer-queue?id=${closer.queue.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        setError('Failed to remove closer')
      } else {
        await loadData()
      }
    } catch (e) {
      setError('Failed to remove closer')
    }
  }

  const handleToggleActive = async (closer: CloserWithQueue) => {
    if (!closer.queue) return

    try {
      const response = await fetch('/api/admin/team-closer-queue', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: closer.queue.id,
          active: !closer.queue.active,
        }),
      })

      if (!response.ok) {
        setError('Failed to update closer')
      } else {
        await loadData()
      }
    } catch (e) {
      setError('Failed to update closer')
    }
  }

  const handleUpdateBuffer = async (closer: CloserWithQueue, field: 'buffer_before' | 'buffer_after', minutes: number) => {
    if (!closer.queue) return

    try {
      await fetch('/api/admin/team-closer-queue', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: closer.queue.id,
          [field]: minutes,
        }),
      })
      await loadData()
    } catch (e) {
      console.error('Failed to update buffer:', e)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-500">
            Loading...
          </div>
        </div>
      </div>
    )
  }

  if (!team) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center">
            <p className="text-red-600 mb-4">Team not found</p>
            <Link href="/admin/teams" className="text-indigo-600 hover:underline">
              Back to Teams
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
              <Link href="/admin" className="hover:text-indigo-600">Admin</Link>
              <span>/</span>
              <Link href="/admin/teams" className="hover:text-indigo-600">Teams</Link>
              <span>/</span>
              <span>{team.name}</span>
              <span>/</span>
              <span>Closer Queue</span>
            </div>
            <h1 className="text-3xl font-bold text-gray-900">Closer Queue</h1>
            <p className="mt-1 text-gray-600">
              Drag to reorder priority. Higher position = assigned first.
            </p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            disabled={availableUsers.length === 0}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            + Add Closer
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg">
            {error}
          </div>
        )}

        {saving && (
          <div className="mb-6 p-4 bg-blue-50 text-blue-700 rounded-lg">
            Saving changes...
          </div>
        )}

        {closers.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center">
            <div className="text-gray-400 mb-4">
              <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-1">No closers in queue</h3>
            <p className="text-gray-500 mb-4">
              Add sales reps to the round-robin queue for automatic appointment assignment.
            </p>
            {availableUsers.length > 0 && (
              <button
                onClick={() => setShowAddModal(true)}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
              >
                Add First Closer
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="px-6 py-4 border-b bg-gray-50">
              <div className="grid grid-cols-12 gap-4 text-xs font-medium text-gray-500 uppercase tracking-wide">
                <div className="col-span-1">#</div>
                <div className="col-span-3">Closer</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2">Buffer Before</div>
                <div className="col-span-2">Buffer After</div>
                <div className="col-span-2">Actions</div>
              </div>
            </div>
            <div className="divide-y">
              {closers.map((closer, index) => (
                <div
                  key={closer.id}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`px-6 py-4 cursor-move hover:bg-gray-50 transition-colors ${
                    draggedIndex === index ? 'bg-indigo-50' : ''
                  } ${!closer.queue?.active ? 'opacity-50' : ''}`}
                >
                  <div className="grid grid-cols-12 gap-4 items-center">
                    <div className="col-span-1">
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-medium text-gray-600">
                        {index + 1}
                      </div>
                    </div>
                    <div className="col-span-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-medium">
                          {closer.full_name?.charAt(0) || '?'}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{closer.full_name || 'Unknown'}</p>
                          <p className="text-sm text-gray-500 truncate max-w-[120px]">{closer.email}</p>
                        </div>
                      </div>
                    </div>
                    <div className="col-span-2">
                      <button
                        onClick={() => handleToggleActive(closer)}
                        className={`px-3 py-1 rounded-full text-xs font-medium ${
                          closer.queue?.active
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {closer.queue?.active ? 'Active' : 'Paused'}
                      </button>
                    </div>
                    <div className="col-span-2">
                      <select
                        value={closer.queue?.buffer_before ?? 0}
                        onChange={(e) => handleUpdateBuffer(closer, 'buffer_before', parseInt(e.target.value))}
                        className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                      >
                        <option value={0}>None</option>
                        <option value={15}>15 min</option>
                        <option value={30}>30 min</option>
                        <option value={45}>45 min</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <select
                        value={closer.queue?.buffer_after ?? 15}
                        onChange={(e) => handleUpdateBuffer(closer, 'buffer_after', parseInt(e.target.value))}
                        className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                      >
                        <option value={0}>None</option>
                        <option value={15}>15 min</option>
                        <option value={30}>30 min</option>
                        <option value={45}>45 min</option>
                      </select>
                    </div>
                    <div className="col-span-2 flex items-center gap-2">
                      <button
                        onClick={() => handleRemoveCloser(closer)}
                        className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                        title="Remove from queue"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                      <div className="text-gray-300 cursor-move" title="Drag to reorder">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <h3 className="font-medium text-blue-900 mb-2">How Round-Robin Works</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>1. When a canvasser schedules an inspection, the system checks this queue</li>
            <li>2. The first active closer with availability (based on Google Calendar) is assigned</li>
            <li>3. Buffer time ensures gaps between appointments</li>
            <li>4. Drag closers to adjust priority based on close rate</li>
          </ul>
        </div>

        {/* Add Closer Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Add Closer to Queue
              </h2>

              {availableUsers.length === 0 ? (
                <p className="text-gray-500 mb-4">
                  All eligible users are already in the queue.
                </p>
              ) : (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select User
                  </label>
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                  >
                    <option value="">Choose a sales rep...</option>
                    {availableUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.full_name || 'Unknown'} ({user.role})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowAddModal(false)
                    setSelectedUserId('')
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium"
                >
                  Cancel
                </button>
                {availableUsers.length > 0 && (
                  <button
                    onClick={handleAddCloser}
                    disabled={saving || !selectedUserId}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50"
                  >
                    {saving ? 'Adding...' : 'Add to Queue'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
