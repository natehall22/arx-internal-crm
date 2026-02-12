'use client'

import { useEffect, useState } from 'react'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import type { Region, Team, User } from '@/lib/types/database'

type TeamWithDetails = Team & { 
  regions: Region | null
  members: User[]
}

export default function TeamsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const regionFilter = searchParams.get('region')

  const [teams, setTeams] = useState<TeamWithDetails[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingTeam, setEditingTeam] = useState<TeamWithDetails | null>(null)
  const [formName, setFormName] = useState('')
  const [formRegionId, setFormRegionId] = useState('')
  const [formTimezone, setFormTimezone] = useState('America/New_York')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Common US timezones
  const timezones = [
    { value: 'America/New_York', label: 'Eastern Time (ET) - New York, Charlotte' },
    { value: 'America/Chicago', label: 'Central Time (CT) - Chicago, Dallas' },
    { value: 'America/Denver', label: 'Mountain Time (MT) - Denver, Phoenix' },
    { value: 'America/Los_Angeles', label: 'Pacific Time (PT) - Los Angeles, Seattle' },
    { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
    { value: 'Pacific/Honolulu', label: 'Hawaii Time (HT)' },
  ]

  useEffect(() => {
    loadData()
  }, [regionFilter])

  const loadData = async () => {
    try {
      const url = regionFilter 
        ? `/api/admin/data?resource=teams&region_id=${regionFilter}`
        : '/api/admin/data?resource=teams'
      
      const response = await fetch(url)
      
      if (response.status === 401) {
        router.push('/login')
        return
      }
      
      if (response.status === 403) {
        router.push('/dashboard')
        return
      }
      
      if (!response.ok) {
        setError('Failed to load teams')
        setLoading(false)
        return
      }
      
      const data = await response.json()
      setTeams(data.teams || [])
      setRegions(data.regions || [])
    } catch (err) {
      setError('Failed to load teams')
    }
    setLoading(false)
  }

  const handleCreate = async () => {
    if (!formName.trim()) {
      setError('Team name is required')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resource: 'team',
          name: formName.trim(),
          region_id: formRegionId || null,
          timezone: formTimezone,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to create team')
      } else {
        setShowCreateModal(false)
        setFormName('')
        setFormRegionId('')
        setFormTimezone('America/New_York')
        await loadData()
      }
    } catch (err) {
      setError('Failed to create team')
    }
    setSaving(false)
  }

  const handleUpdate = async () => {
    if (!editingTeam || !formName.trim()) {
      setError('Team name is required')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/data', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resource: 'team',
          id: editingTeam.id,
          name: formName.trim(),
          region_id: formRegionId || null,
          timezone: formTimezone,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to update team')
      } else {
        setEditingTeam(null)
        setFormName('')
        setFormRegionId('')
        setFormTimezone('America/New_York')
        await loadData()
      }
    } catch (err) {
      setError('Failed to update team')
    }
    setSaving(false)
  }

  const handleDelete = async (team: TeamWithDetails) => {
    if (team.members.length > 0) {
      if (!confirm(`Delete team "${team.name}"? ${team.members.length} member(s) will be unassigned from this team.`)) {
        return
      }
    } else if (!confirm(`Delete team "${team.name}"?`)) {
      return
    }

    try {
      const response = await fetch(`/api/admin/data?resource=team&id=${team.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to delete team')
      } else {
        await loadData()
      }
    } catch (err) {
      setError('Failed to delete team')
    }
  }

  const openEditModal = (team: TeamWithDetails) => {
    setEditingTeam(team)
    setFormName(team.name)
    setFormRegionId(team.region_id || '')
    setFormTimezone((team as any).timezone || 'America/New_York')
    setError(null)
  }

  const closeModal = () => {
    setShowCreateModal(false)
    setEditingTeam(null)
    setFormName('')
    setFormRegionId('')
    setFormTimezone('America/New_York')
    setError(null)
  }

  const selectedRegion = regionFilter ? regions.find(r => r.id === regionFilter) : null

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
              <Link href="/admin" className="hover:text-indigo-600">Admin</Link>
              <span>/</span>
              <span>Teams</span>
              {selectedRegion && (
                <>
                  <span>/</span>
                  <span>{selectedRegion.name}</span>
                </>
              )}
            </div>
            <h1 className="text-3xl font-bold text-gray-900">Teams</h1>
            <p className="mt-1 text-gray-600">
              {selectedRegion 
                ? `Teams in ${selectedRegion.name}` 
                : 'Manage sales teams within your organization'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {selectedRegion && (
              <Link
                href="/admin/teams"
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium"
              >
                View All Teams
              </Link>
            )}
            <button
              onClick={() => {
                setFormRegionId(regionFilter || '')
                setShowCreateModal(true)
              }}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
            >
              + New Team
            </button>
          </div>
        </div>

        {/* Region filter */}
        {!regionFilter && regions.length > 0 && (
          <div className="mb-6 flex items-center gap-2 flex-wrap">
            <span className="text-sm text-gray-500">Filter by region:</span>
            {regions.map((region) => (
              <Link
                key={region.id}
                href={`/admin/teams?region=${region.id}`}
                className="px-3 py-1 bg-white border border-gray-200 text-gray-700 rounded-full text-sm hover:border-indigo-300 hover:text-indigo-600"
              >
                {region.name}
              </Link>
            ))}
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-500">
            Loading teams...
          </div>
        ) : teams.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center">
            <div className="text-gray-400 mb-4">
              <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-1">No teams yet</h3>
            <p className="text-gray-500 mb-4">
              {selectedRegion 
                ? `Create a team in ${selectedRegion.name}.`
                : 'Create your first team to organize your sales reps.'}
            </p>
            <button
              onClick={() => {
                setFormRegionId(regionFilter || '')
                setShowCreateModal(true)
              }}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
            >
              Create Team
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {teams.map((team) => (
              <div key={team.id} className="bg-white rounded-xl shadow-sm border p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{team.name}</h3>
                    {team.regions && (
                      <p className="text-sm text-indigo-600">{team.regions.name}</p>
                    )}
                    <p className="text-sm text-gray-500">
                      {team.members.length} member{team.members.length !== 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-gray-400">
                      {timezones.find(tz => tz.value === (team as any).timezone)?.label?.split(' - ')[0] || 'Eastern Time (ET)'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/admin/teams/${team.id}/closers`}
                      className="p-2 text-gray-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50"
                      title="Manage Closers"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </Link>
                    <button
                      onClick={() => openEditModal(team)}
                      className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                      title="Edit"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(team)}
                      className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                
                {team.members.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Members</p>
                    <div className="space-y-1">
                      {team.members.slice(0, 5).map((member) => (
                        <div key={member.id} className="flex items-center gap-2 text-sm">
                          <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-medium">
                            {member.full_name?.charAt(0) || '?'}
                          </div>
                          <span className="text-gray-700">{member.full_name || 'Unknown'}</span>
                          <span className="text-gray-400 text-xs">({member.role})</span>
                        </div>
                      ))}
                      {team.members.length > 5 && (
                        <p className="text-xs text-gray-400">
                          +{team.members.length - 5} more
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No members assigned</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Create/Edit Modal */}
        {(showCreateModal || editingTeam) && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                {editingTeam ? 'Edit Team' : 'Create Team'}
              </h2>
              
              {error && (
                <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Team Name
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g., North Dallas Team"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Region (Optional)
                  </label>
                  <select
                    value={formRegionId}
                    onChange={(e) => setFormRegionId(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                  >
                    <option value="">No region</option>
                    {regions.map((region) => (
                      <option key={region.id} value={region.id}>
                        {region.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Timezone
                  </label>
                  <select
                    value={formTimezone}
                    onChange={(e) => setFormTimezone(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                  >
                    {timezones.map((tz) => (
                      <option key={tz.value} value={tz.value}>
                        {tz.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Used for calendar scheduling. Default is Eastern Time (Charlotte, NC).
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={closeModal}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={editingTeam ? handleUpdate : handleCreate}
                  disabled={saving}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingTeam ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
