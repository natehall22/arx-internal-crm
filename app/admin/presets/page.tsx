'use client'

import { useEffect, useState } from 'react'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'

type Permission = {
  id: string
  name: string
  display_name: string
  description?: string
  category: string
}

type PresetPermission = {
  permission_id: string
  permissions: Permission
}

type PermissionPreset = {
  id: string
  name: string
  description: string | null
  base_role: string
  color: string
  is_system: boolean
  sort_order: number
  preset_permissions: PresetPermission[]
}

const colorOptions = [
  { value: 'gray', label: 'Gray', bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-300' },
  { value: 'red', label: 'Red', bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300' },
  { value: 'orange', label: 'Orange', bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300' },
  { value: 'yellow', label: 'Yellow', bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-300' },
  { value: 'green', label: 'Green', bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300' },
  { value: 'blue', label: 'Blue', bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' },
  { value: 'indigo', label: 'Indigo', bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-300' },
  { value: 'purple', label: 'Purple', bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-300' },
  { value: 'pink', label: 'Pink', bg: 'bg-pink-100', text: 'text-pink-700', border: 'border-pink-300' },
]

const roleOptions = [
  { value: 'canvasser', label: 'Canvasser' },
  { value: 'sales_rep', label: 'Sales Rep' },
  { value: 'sales_manager', label: 'Sales Manager' },
  { value: 'regional_manager', label: 'Regional Manager' },
  { value: 'operations', label: 'Operations' },
  { value: 'admin', label: 'Administrator' },
]

export default function PresetsPage() {
  const [presets, setPresets] = useState<PermissionPreset[]>([])
  const [allPermissions, setAllPermissions] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingPreset, setEditingPreset] = useState<PermissionPreset | null>(null)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formBaseRole, setFormBaseRole] = useState('sales_rep')
  const [formColor, setFormColor] = useState('gray')
  const [formPermissions, setFormPermissions] = useState<Set<string>>(new Set())
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    const supabase = createClientBrowser()

    // Load all permissions
    const { data: perms } = await supabase
      .from('permissions')
      .select('*')
      .order('category')
      .order('display_name')

    setAllPermissions(perms || [])

    // Load presets
    const { data: presetsData } = await supabase
      .from('permission_presets')
      .select(`
        *,
        preset_permissions (
          permission_id,
          permissions (
            id,
            name,
            display_name,
            category
          )
        )
      `)
      .order('sort_order')

    setPresets(presetsData || [])
    setLoading(false)
  }

  const getPermissionsByCategory = () => {
    const grouped: Record<string, Permission[]> = {}
    for (const perm of allPermissions) {
      if (!grouped[perm.category]) {
        grouped[perm.category] = []
      }
      grouped[perm.category].push(perm)
    }
    return grouped
  }

  const permsByCategory = getPermissionsByCategory()

  const openCreateModal = () => {
    setEditingPreset(null)
    setFormName('')
    setFormDescription('')
    setFormBaseRole('sales_rep')
    setFormColor('gray')
    setFormPermissions(new Set())
    setExpandedCategories(new Set())
    setError(null)
    setShowModal(true)
  }

  const openEditModal = (preset: PermissionPreset) => {
    setEditingPreset(preset)
    setFormName(preset.name)
    setFormDescription(preset.description || '')
    setFormBaseRole(preset.base_role)
    setFormColor(preset.color)
    setFormPermissions(new Set(preset.preset_permissions.map(pp => pp.permission_id)))
    setExpandedCategories(new Set())
    setError(null)
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingPreset(null)
    setError(null)
  }

  const togglePermission = (permId: string) => {
    const newPerms = new Set(formPermissions)
    if (newPerms.has(permId)) {
      newPerms.delete(permId)
    } else {
      newPerms.add(permId)
    }
    setFormPermissions(newPerms)
  }

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories)
    if (newExpanded.has(category)) {
      newExpanded.delete(category)
    } else {
      newExpanded.add(category)
    }
    setExpandedCategories(newExpanded)
  }

  const selectAllInCategory = (category: string) => {
    const categoryPerms = permsByCategory[category] || []
    const newPerms = new Set(formPermissions)
    categoryPerms.forEach(p => newPerms.add(p.id))
    setFormPermissions(newPerms)
  }

  const deselectAllInCategory = (category: string) => {
    const categoryPerms = permsByCategory[category] || []
    const newPerms = new Set(formPermissions)
    categoryPerms.forEach(p => newPerms.delete(p.id))
    setFormPermissions(newPerms)
  }

  const handleSave = async () => {
    if (!formName.trim()) {
      setError('Name is required')
      return
    }

    setSaving(true)
    setError(null)

    const payload = {
      id: editingPreset?.id,
      name: formName.trim(),
      description: formDescription.trim(),
      base_role: formBaseRole,
      color: formColor,
      permission_ids: Array.from(formPermissions),
    }

    const response = await fetch('/api/admin/presets', {
      method: editingPreset ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const result = await response.json()

    if (!response.ok) {
      setError(result.error || 'Failed to save preset')
      setSaving(false)
      return
    }

    closeModal()
    await loadData()
    setSaving(false)
  }

  const handleDelete = async (preset: PermissionPreset) => {
    if (preset.is_system) {
      alert('System presets cannot be deleted')
      return
    }

    if (!confirm(`Delete "${preset.name}"? This cannot be undone.`)) {
      return
    }

    const response = await fetch(`/api/admin/presets?id=${preset.id}`, {
      method: 'DELETE',
    })

    if (response.ok) {
      await loadData()
    } else {
      const result = await response.json()
      alert(result.error || 'Failed to delete preset')
    }
  }

  const duplicatePreset = (preset: PermissionPreset) => {
    setEditingPreset(null)
    setFormName(`${preset.name} (Copy)`)
    setFormDescription(preset.description || '')
    setFormBaseRole(preset.base_role)
    setFormColor(preset.color)
    setFormPermissions(new Set(preset.preset_permissions.map(pp => pp.permission_id)))
    setExpandedCategories(new Set())
    setError(null)
    setShowModal(true)
  }

  const getColorClasses = (color: string) => {
    return colorOptions.find(c => c.value === color) || colorOptions[0]
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
              <span>Permission Presets</span>
            </div>
            <h1 className="text-3xl font-bold text-gray-900">Permission Presets</h1>
            <p className="mt-1 text-gray-600">Create reusable permission templates for quick user setup</p>
          </div>
          <button
            onClick={openCreateModal}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            New Preset
          </button>
        </div>

        {/* Info Banner */}
        <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <p className="text-sm text-blue-800">
            <strong>Permission Presets</strong> are templates that bundle a base role with specific permissions. 
            When creating a new user, select a preset to quickly configure their access level, then customize as needed.
          </p>
        </div>

        {loading ? (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-500">
            Loading presets...
          </div>
        ) : presets.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center">
            <div className="text-gray-400 mb-4">
              <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-1">No permission presets yet</h3>
            <p className="text-gray-500 mb-4">
              Create presets to quickly assign permissions when adding new users.
            </p>
            <button
              onClick={openCreateModal}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
            >
              Create First Preset
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {presets.map((preset) => {
              const colorClasses = getColorClasses(preset.color)
              return (
                <div key={preset.id} className={`bg-white rounded-xl shadow-sm border-2 ${colorClasses.border} overflow-hidden`}>
                  <div className={`px-4 py-3 ${colorClasses.bg} border-b ${colorClasses.border}`}>
                    <div className="flex items-center justify-between">
                      <h3 className={`font-semibold ${colorClasses.text}`}>{preset.name}</h3>
                      {preset.is_system && (
                        <span className="px-2 py-0.5 bg-white/50 text-xs rounded font-medium">System</span>
                      )}
                    </div>
                  </div>
                  
                  <div className="p-4">
                    {preset.description && (
                      <p className="text-sm text-gray-600 mb-3">{preset.description}</p>
                    )}
                    
                    <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
                      <span className="px-2 py-0.5 bg-gray-100 rounded capitalize">
                        {preset.base_role.replace('_', ' ')}
                      </span>
                      <span>•</span>
                      <span>{preset.preset_permissions.length} permissions</span>
                    </div>

                    {/* Permission summary */}
                    <div className="mb-4">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Permissions</p>
                      <div className="flex flex-wrap gap-1">
                        {preset.preset_permissions.slice(0, 6).map((pp) => (
                          <span
                            key={pp.permission_id}
                            className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded"
                          >
                            {pp.permissions?.display_name}
                          </span>
                        ))}
                        {preset.preset_permissions.length > 6 && (
                          <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">
                            +{preset.preset_permissions.length - 6} more
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-3 border-t">
                      <button
                        onClick={() => openEditModal(preset)}
                        className="flex-1 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg font-medium"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => duplicatePreset(preset)}
                        className="px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-lg"
                        title="Duplicate"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                      {!preset.is_system && (
                        <button
                          onClick={() => handleDelete(preset)}
                          className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg"
                          title="Delete"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Create/Edit Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">
                  {editingPreset ? 'Edit Preset' : 'Create New Preset'}
                </h2>
                <button
                  onClick={closeModal}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                {error && (
                  <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                    {error}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Preset Name *
                    </label>
                    <input
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="e.g., Senior Sales Rep"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Base Role
                    </label>
                    <select
                      value={formBaseRole}
                      onChange={(e) => setFormBaseRole(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                    >
                      {roleOptions.map((role) => (
                        <option key={role.value} value={role.value}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-gray-500">
                      The base role determines hierarchy level and default access
                    </p>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Description
                    </label>
                    <textarea
                      value={formDescription}
                      onChange={(e) => setFormDescription(e.target.value)}
                      placeholder="Describe what this preset is for..."
                      rows={2}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Color
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {colorOptions.map((color) => (
                        <button
                          key={color.value}
                          type="button"
                          onClick={() => setFormColor(color.value)}
                          className={`px-3 py-2 rounded-lg border-2 transition-all ${color.bg} ${color.text} ${
                            formColor === color.value
                              ? `${color.border} ring-2 ring-offset-2 ring-${color.value}-500`
                              : 'border-transparent'
                          }`}
                        >
                          {color.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Permissions */}
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-4">
                    Permissions ({formPermissions.size} selected)
                  </h3>
                  
                  <div className="space-y-2 border rounded-lg max-h-96 overflow-y-auto">
                    {Object.entries(permsByCategory).map(([category, perms]) => {
                      const isExpanded = expandedCategories.has(category)
                      const selectedCount = perms.filter(p => formPermissions.has(p.id)).length
                      
                      return (
                        <div key={category} className="border-b last:border-b-0">
                          <button
                            type="button"
                            onClick={() => toggleCategory(category)}
                            className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50"
                          >
                            <div className="flex items-center gap-3">
                              <svg
                                className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              <span className="font-medium text-gray-900">{category}</span>
                              <span className={`text-sm ${selectedCount > 0 ? 'text-indigo-600 font-medium' : 'text-gray-500'}`}>
                                {selectedCount}/{perms.length}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  selectAllInCategory(category)
                                }}
                                className="text-xs text-indigo-600 hover:underline"
                              >
                                All
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  deselectAllInCategory(category)
                                }}
                                className="text-xs text-gray-500 hover:underline"
                              >
                                None
                              </button>
                            </div>
                          </button>
                          
                          {isExpanded && (
                            <div className="px-4 pb-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                              {perms.map((perm) => (
                                <label
                                  key={perm.id}
                                  className="flex items-start gap-3 p-2 rounded hover:bg-gray-50 cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={formPermissions.has(perm.id)}
                                    onChange={() => togglePermission(perm.id)}
                                    className="mt-0.5 w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                  />
                                  <div>
                                    <p className="text-sm font-medium text-gray-900">{perm.display_name}</p>
                                    {perm.description && (
                                      <p className="text-xs text-gray-500">{perm.description}</p>
                                    )}
                                  </div>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3">
                <button
                  onClick={closeModal}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingPreset ? 'Update Preset' : 'Create Preset'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
