'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'

interface Crew {
  id: string
  name: string
  crew_type: string
  foreman_user_id: string | null
  members: string[]
  color: string
  phone: string | null
  daily_capacity: number
  active: boolean
  notes: string | null
  created_at: string
}

interface User {
  id: string
  full_name: string
  role: string
}

const crewTypeOptions = [
  { value: 'roofing', label: 'Roofing' },
  { value: 'siding', label: 'Siding' },
  { value: 'gutters', label: 'Gutters' },
  { value: 'windows', label: 'Windows' },
  { value: 'general', label: 'General' },
]

const colorOptions = [
  '#3B82F6', // Blue
  '#10B981', // Green
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#F97316', // Orange
]

export default function CrewsPage() {
  const router = useRouter()
  const [crews, setCrews] = useState<Crew[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingCrew, setEditingCrew] = useState<Crew | null>(null)
  const [saving, setSaving] = useState(false)
  const [orgId, setOrgId] = useState('')

  const [formData, setFormData] = useState({
    name: '',
    crew_type: 'roofing',
    foreman_user_id: '',
    members: [] as string[],
    color: '#3B82F6',
    phone: '',
    daily_capacity: 1,
    notes: '',
  })

  const supabase = createClientBrowser()

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { data: profile } = await supabase
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile || !['admin', 'regional_manager', 'operations', 'manager'].includes(profile.role)) {
      router.push('/dashboard')
      return
    }

    setOrgId(profile.org_id)

    // Load crews and users in parallel
    const [crewsRes, usersRes] = await Promise.all([
      supabase
        .from('crews')
        .select('*')
        .eq('org_id', profile.org_id)
        .order('name'),
      supabase
        .from('users')
        .select('id, full_name, role')
        .eq('org_id', profile.org_id)
        .eq('active', true)
        .order('full_name'),
    ])

    setCrews(crewsRes.data || [])
    setUsers(usersRes.data || [])
    setLoading(false)
  }

  const openModal = (crew?: Crew) => {
    if (crew) {
      setEditingCrew(crew)
      setFormData({
        name: crew.name,
        crew_type: crew.crew_type,
        foreman_user_id: crew.foreman_user_id || '',
        members: crew.members || [],
        color: crew.color,
        phone: crew.phone || '',
        daily_capacity: crew.daily_capacity,
        notes: crew.notes || '',
      })
    } else {
      setEditingCrew(null)
      setFormData({
        name: '',
        crew_type: 'roofing',
        foreman_user_id: '',
        members: [],
        color: colorOptions[crews.length % colorOptions.length],
        phone: '',
        daily_capacity: 1,
        notes: '',
      })
    }
    setShowModal(true)
  }

  const toggleMember = (userId: string) => {
    setFormData(prev => ({
      ...prev,
      members: prev.members.includes(userId)
        ? prev.members.filter(id => id !== userId)
        : [...prev.members, userId],
    }))
  }

  const saveCrew = async () => {
    if (!formData.name) {
      alert('Crew name is required')
      return
    }

    setSaving(true)

    try {
      const crewData: any = {
        name: formData.name,
        crew_type: formData.crew_type,
        foreman_user_id: formData.foreman_user_id || null,
        members: formData.members,
        color: formData.color,
        phone: formData.phone || null,
        daily_capacity: formData.daily_capacity,
        notes: formData.notes || null,
      }

      if (editingCrew) {
        await supabase
          .from('crews')
          .update(crewData)
          .eq('id', editingCrew.id)
      } else {
        crewData.org_id = orgId
        crewData.active = true
        await supabase.from('crews').insert(crewData)
      }

      setShowModal(false)
      await loadData()
    } catch (error) {
      console.error('Error saving crew:', error)
      alert('Failed to save crew')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (crew: Crew) => {
    await supabase
      .from('crews')
      .update({ active: !crew.active })
      .eq('id', crew.id)

    await loadData()
  }

  const getUserName = (userId: string) => {
    const user = users.find(u => u.id === userId)
    return user?.full_name || 'Unknown'
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Link href="/admin" className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
            ← Back to Admin
          </Link>
        </div>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Crews</h1>
            <p className="text-gray-500 mt-1">Manage your in-house installation crews</p>
          </div>
          <button
            onClick={() => openModal()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Crew
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="text-2xl font-bold text-gray-900">{crews.length}</div>
            <div className="text-sm text-gray-500">Total Crews</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="text-2xl font-bold text-green-600">
              {crews.filter(c => c.active).length}
            </div>
            <div className="text-sm text-gray-500">Active</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="text-2xl font-bold text-blue-600">
              {crews.reduce((sum, c) => sum + c.daily_capacity, 0)}
            </div>
            <div className="text-sm text-gray-500">Daily Capacity</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="text-2xl font-bold text-indigo-600">
              {crews.reduce((sum, c) => sum + (c.members?.length || 0), 0)}
            </div>
            <div className="text-sm text-gray-500">Total Members</div>
          </div>
        </div>

        {/* Crews Grid */}
        {crews.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No crews yet</h3>
            <p className="text-gray-500 mb-4">Create your first crew to start scheduling jobs</p>
            <button
              onClick={() => openModal()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              Add Crew
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {crews.map((crew) => (
              <div
                key={crew.id}
                className={`bg-white rounded-xl shadow-sm border overflow-hidden ${!crew.active ? 'opacity-60' : ''}`}
              >
                {/* Crew Header with Color */}
                <div 
                  className="h-2" 
                  style={{ backgroundColor: crew.color }}
                />
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div 
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                        style={{ backgroundColor: crew.color }}
                      >
                        {crew.name.charAt(0)}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{crew.name}</h3>
                        <span className="text-xs text-gray-500 capitalize">{crew.crew_type}</span>
                      </div>
                    </div>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      crew.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {crew.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  {/* Foreman */}
                  {crew.foreman_user_id && (
                    <div className="mb-3">
                      <span className="text-xs text-gray-500">Foreman:</span>
                      <span className="text-sm text-gray-900 ml-2">{getUserName(crew.foreman_user_id)}</span>
                    </div>
                  )}

                  {/* Members */}
                  <div className="mb-3">
                    <span className="text-xs text-gray-500">Members:</span>
                    {crew.members && crew.members.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {crew.members.slice(0, 4).map(memberId => (
                          <span 
                            key={memberId}
                            className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded"
                          >
                            {getUserName(memberId)}
                          </span>
                        ))}
                        {crew.members.length > 4 && (
                          <span className="text-xs text-gray-500">+{crew.members.length - 4} more</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400 ml-2">No members assigned</span>
                    )}
                  </div>

                  {/* Stats Row */}
                  <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
                    <span>📊 {crew.daily_capacity} jobs/day</span>
                    {crew.phone && <span>📞 {crew.phone}</span>}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-3 border-t">
                    <button
                      onClick={() => openModal(crew)}
                      className="flex-1 text-sm py-2 px-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => toggleActive(crew)}
                      className={`flex-1 text-sm py-2 px-3 rounded-lg ${
                        crew.active 
                          ? 'bg-red-50 text-red-600 hover:bg-red-100' 
                          : 'bg-green-50 text-green-600 hover:bg-green-100'
                      }`}
                    >
                      {crew.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b">
                <h2 className="text-xl font-bold text-gray-900">
                  {editingCrew ? 'Edit Crew' : 'Add Crew'}
                </h2>
              </div>
              <div className="p-6 space-y-5">
                {/* Name & Type */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Crew Name *</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      placeholder="e.g., Alpha Crew"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Crew Type</label>
                    <select
                      value={formData.crew_type}
                      onChange={(e) => setFormData(prev => ({ ...prev, crew_type: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    >
                      {crewTypeOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Color Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Color (for calendar)</label>
                  <div className="flex gap-2">
                    {colorOptions.map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, color }))}
                        className={`w-8 h-8 rounded-full transition ${
                          formData.color === color ? 'ring-2 ring-offset-2 ring-gray-400' : ''
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                {/* Phone & Capacity */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      placeholder="Contact number"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Daily Capacity</label>
                    <select
                      value={formData.daily_capacity}
                      onChange={(e) => setFormData(prev => ({ ...prev, daily_capacity: parseInt(e.target.value) }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    >
                      <option value={1}>1 job per day</option>
                      <option value={2}>2 jobs per day</option>
                      <option value={3}>3 jobs per day</option>
                      <option value={4}>4 jobs per day</option>
                    </select>
                  </div>
                </div>

                {/* Foreman */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Foreman</label>
                  <select
                    value={formData.foreman_user_id}
                    onChange={(e) => setFormData(prev => ({ ...prev, foreman_user_id: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="">Select foreman...</option>
                    {users.map(user => (
                      <option key={user.id} value={user.id}>{user.full_name}</option>
                    ))}
                  </select>
                </div>

                {/* Members */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Crew Members</label>
                  <div className="border border-gray-300 rounded-lg p-3 max-h-48 overflow-y-auto">
                    {users.length === 0 ? (
                      <p className="text-gray-500 text-sm">No users available</p>
                    ) : (
                      <div className="space-y-2">
                        {users.map(user => (
                          <label
                            key={user.id}
                            className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={formData.members.includes(user.id)}
                              onChange={() => toggleMember(user.id)}
                              className="w-4 h-4 text-indigo-600 rounded"
                            />
                            <span className="text-sm text-gray-900">{user.full_name}</span>
                            <span className="text-xs text-gray-500 capitalize">({user.role})</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  {formData.members.length > 0 && (
                    <p className="text-xs text-gray-500 mt-1">{formData.members.length} member(s) selected</p>
                  )}
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="Internal notes about this crew..."
                  />
                </div>
              </div>
              <div className="p-6 border-t flex justify-end gap-3">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
                >
                  Cancel
                </button>
                <button
                  onClick={saveCrew}
                  disabled={saving}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
