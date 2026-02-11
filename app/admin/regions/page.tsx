'use client'

import { useEffect, useState } from 'react'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Region, Team } from '@/lib/types/database'

type RegionWithTeams = Region & { teams: Team[] }

export default function RegionsPage() {
  const router = useRouter()
  const [regions, setRegions] = useState<RegionWithTeams[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingRegion, setEditingRegion] = useState<Region | null>(null)
  const [formName, setFormName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadRegions()
  }, [])

  const loadRegions = async () => {
    try {
      const response = await fetch('/api/admin/data?resource=regions')
      
      if (response.status === 401) {
        router.push('/login')
        return
      }
      
      if (response.status === 403) {
        router.push('/dashboard')
        return
      }
      
      if (!response.ok) {
        setError('Failed to load regions')
        setLoading(false)
        return
      }
      
      const data = await response.json()
      setRegions(data.regions || [])
    } catch (err) {
      setError('Failed to load regions')
    }
    setLoading(false)
  }

  const handleCreate = async () => {
    if (!formName.trim()) {
      setError('Region name is required')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resource: 'region',
          name: formName.trim(),
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to create region')
      } else {
        setShowCreateModal(false)
        setFormName('')
        await loadRegions()
      }
    } catch (err) {
      setError('Failed to create region')
    }
    setSaving(false)
  }

  const handleUpdate = async () => {
    if (!editingRegion || !formName.trim()) {
      setError('Region name is required')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/data', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resource: 'region',
          id: editingRegion.id,
          name: formName.trim(),
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to update region')
      } else {
        setEditingRegion(null)
        setFormName('')
        await loadRegions()
      }
    } catch (err) {
      setError('Failed to update region')
    }
    setSaving(false)
  }

  const handleDelete = async (region: Region) => {
    if (!confirm(`Delete region "${region.name}"? Teams in this region will be unassigned.`)) {
      return
    }

    try {
      const response = await fetch(`/api/admin/data?resource=region&id=${region.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to delete region')
      } else {
        await loadRegions()
      }
    } catch (err) {
      setError('Failed to delete region')
    }
  }

  const openEditModal = (region: Region) => {
    setEditingRegion(region)
    setFormName(region.name)
    setError(null)
  }

  const closeModal = () => {
    setShowCreateModal(false)
    setEditingRegion(null)
    setFormName('')
    setError(null)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
              <Link href="/admin" className="hover:text-indigo-600">Admin</Link>
              <span>/</span>
              <span>Regions</span>
            </div>
            <h1 className="text-3xl font-bold text-gray-900">Regions</h1>
            <p className="mt-1 text-gray-600">Manage geographic regions for your organization</p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
          >
            + New Region
          </button>
        </div>

        {loading ? (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-500">
            Loading regions...
          </div>
        ) : regions.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center">
            <div className="text-gray-400 mb-4">
              <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-1">No regions yet</h3>
            <p className="text-gray-500 mb-4">Create your first region to organize teams geographically.</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
            >
              Create Region
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {regions.map((region) => (
              <div key={region.id} className="bg-white rounded-xl shadow-sm border p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{region.name}</h3>
                    <p className="text-sm text-gray-500">
                      {region.teams?.length || 0} team{region.teams?.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEditModal(region)}
                      className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                      title="Edit"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(region)}
                      className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                
                {region.teams && region.teams.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Teams</p>
                    <div className="flex flex-wrap gap-2">
                      {region.teams.map((team) => (
                        <Link
                          key={team.id}
                          href={`/admin/teams?region=${region.id}`}
                          className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm hover:bg-gray-200"
                        >
                          {team.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No teams assigned</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Create/Edit Modal */}
        {(showCreateModal || editingRegion) && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                {editingRegion ? 'Edit Region' : 'Create Region'}
              </h2>
              
              {error && (
                <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Region Name
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g., Dallas-Fort Worth"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={closeModal}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={editingRegion ? handleUpdate : handleCreate}
                  disabled={saving}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingRegion ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
