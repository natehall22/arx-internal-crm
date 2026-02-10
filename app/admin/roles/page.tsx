'use client'

import { useEffect, useState } from 'react'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { permissionCategories, type PermissionCategory } from '@/lib/permissions'
import type { CustomRole, Permission, User } from '@/lib/types/database'

type RoleWithPermissions = CustomRole & {
  permissions: Permission[]
  user_count?: number
}

type UserWithPermissions = User & {
  user_permissions: { permission_id: string; permissions: Permission }[]
}

export default function RolesPage() {
  const [activeTab, setActiveTab] = useState<'roles' | 'users'>('roles')
  const [roles, setRoles] = useState<RoleWithPermissions[]>([])
  const [users, setUsers] = useState<UserWithPermissions[]>([])
  const [dbPermissions, setDbPermissions] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingRole, setEditingRole] = useState<RoleWithPermissions | null>(null)
  const [editingUser, setEditingUser] = useState<UserWithPermissions | null>(null)
  const [userPermissions, setUserPermissions] = useState<Set<string>>(new Set())
  const [formName, setFormName] = useState('')
  const [formDisplayName, setFormDisplayName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formHierarchyLevel, setFormHierarchyLevel] = useState(50)
  const [formParentRoleId, setFormParentRoleId] = useState('')
  const [formPermissions, setFormPermissions] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedCategories, setExpandedCategories] = useState<Set<PermissionCategory>>(new Set())
  const [userExpandedCategories, setUserExpandedCategories] = useState<Set<PermissionCategory>>(new Set())
  const [userSearch, setUserSearch] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const response = await fetch('/api/admin/roles')
      if (!response.ok) {
        const err = await response.json()
        setError(err.error || 'Failed to load data')
        setLoading(false)
        return
      }
      
      const data = await response.json()
      setDbPermissions(data.permissions || [])
      setRoles(data.roles || [])
      setUsers((data.users || []) as UserWithPermissions[])
    } catch (err) {
      setError('Failed to load data')
    }
    setLoading(false)
  }

  const loadUserPermissions = async (userId: string) => {
    try {
      const response = await fetch(`/api/admin/user-permissions?userId=${userId}`)
      if (response.ok) {
        const data = await response.json()
        setUserPermissions(new Set(data.permission_ids || []))
      }
    } catch {
      // Ignore errors
    }
  }

  const saveUserPermissions = async () => {
    if (!editingUser) return
    
    setSaving(true)
    setError(null)
    
    try {
      const response = await fetch('/api/admin/user-permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: editingUser.id,
          permission_ids: Array.from(userPermissions),
        }),
      })

      if (!response.ok) {
        const err = await response.json()
        setError(err.error || 'Failed to save permissions')
        setSaving(false)
        return
      }

      setEditingUser(null)
      setUserPermissions(new Set())
      await loadData()
    } catch {
      setError('Failed to save permissions')
    }
    setSaving(false)
  }

  const openUserPermissionsModal = async (user: UserWithPermissions) => {
    setEditingUser(user)
    await loadUserPermissions(user.id)
    setError(null)
  }

  const toggleUserPermission = (permId: string) => {
    const newPerms = new Set(userPermissions)
    if (newPerms.has(permId)) {
      newPerms.delete(permId)
    } else {
      newPerms.add(permId)
    }
    setUserPermissions(newPerms)
  }

  const toggleUserCategory = (category: PermissionCategory) => {
    const newExpanded = new Set(userExpandedCategories)
    if (newExpanded.has(category)) {
      newExpanded.delete(category)
    } else {
      newExpanded.add(category)
    }
    setUserExpandedCategories(newExpanded)
  }

  const selectAllUserInCategory = (category: PermissionCategory) => {
    const categoryPerms = dbPermissions.filter(p => p.category === category)
    const newPerms = new Set(userPermissions)
    categoryPerms.forEach(p => newPerms.add(p.id))
    setUserPermissions(newPerms)
  }

  const deselectAllUserInCategory = (category: PermissionCategory) => {
    const categoryPerms = dbPermissions.filter(p => p.category === category)
    const newPerms = new Set(userPermissions)
    categoryPerms.forEach(p => newPerms.delete(p.id))
    setUserPermissions(newPerms)
  }

  const filteredUsers = users.filter(u => {
    if (!userSearch) return true
    const search = userSearch.toLowerCase()
    return (
      u.full_name?.toLowerCase().includes(search) ||
      u.email?.toLowerCase().includes(search) ||
      u.role?.toLowerCase().includes(search)
    )
  })

  const handleCreate = async () => {
    if (!formName.trim() || !formDisplayName.trim()) {
      setError('Name and display name are required')
      return
    }

    const nameRegex = /^[a-z][a-z0-9_]*$/
    if (!nameRegex.test(formName)) {
      setError('Name must be lowercase letters, numbers, and underscores only')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName.trim(),
          display_name: formDisplayName.trim(),
          description: formDescription.trim() || null,
          hierarchy_level: formHierarchyLevel,
          parent_role_id: formParentRoleId || null,
          permission_ids: Array.from(formPermissions),
        }),
      })

      if (!response.ok) {
        const err = await response.json()
        setError(err.error || 'Failed to create role')
        setSaving(false)
        return
      }

      setShowCreateModal(false)
      resetForm()
      await loadData()
    } catch {
      setError('Failed to create role')
    }
    setSaving(false)
  }

  const handleUpdate = async () => {
    if (!editingRole || !formDisplayName.trim()) {
      setError('Display name is required')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/roles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingRole.id,
          display_name: formDisplayName.trim(),
          description: formDescription.trim() || null,
          hierarchy_level: formHierarchyLevel,
          parent_role_id: formParentRoleId || null,
          permission_ids: Array.from(formPermissions),
        }),
      })

      if (!response.ok) {
        const err = await response.json()
        setError(err.error || 'Failed to update role')
        setSaving(false)
        return
      }

      setEditingRole(null)
      resetForm()
      await loadData()
    } catch {
      setError('Failed to update role')
    }
    setSaving(false)
  }

  const handleDelete = async (role: RoleWithPermissions) => {
    if (role.is_system_role) {
      setError('System roles cannot be deleted')
      return
    }

    if (role.user_count && role.user_count > 0) {
      if (!confirm(`This role is assigned to ${role.user_count} user(s). They will be unassigned. Continue?`)) {
        return
      }
    } else if (!confirm(`Delete role "${role.display_name}"?`)) {
      return
    }

    try {
      const response = await fetch(`/api/admin/roles?id=${role.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const err = await response.json()
        setError(err.error || 'Failed to delete role')
      } else {
        await loadData()
      }
    } catch {
      setError('Failed to delete role')
    }
  }

  const openEditModal = (role: RoleWithPermissions) => {
    setEditingRole(role)
    setFormName(role.name)
    setFormDisplayName(role.display_name)
    setFormDescription(role.description || '')
    setFormHierarchyLevel(role.hierarchy_level)
    setFormParentRoleId(role.parent_role_id || '')
    setFormPermissions(new Set(role.permissions.map(p => p.id)))
    setError(null)
  }

  const resetForm = () => {
    setFormName('')
    setFormDisplayName('')
    setFormDescription('')
    setFormHierarchyLevel(50)
    setFormParentRoleId('')
    setFormPermissions(new Set())
    setError(null)
  }

  const closeModal = () => {
    setShowCreateModal(false)
    setEditingRole(null)
    resetForm()
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

  const toggleCategory = (category: PermissionCategory) => {
    const newExpanded = new Set(expandedCategories)
    if (newExpanded.has(category)) {
      newExpanded.delete(category)
    } else {
      newExpanded.add(category)
    }
    setExpandedCategories(newExpanded)
  }

  const selectAllInCategory = (category: PermissionCategory) => {
    const categoryPerms = dbPermissions.filter(p => p.category === category)
    const newPerms = new Set(formPermissions)
    categoryPerms.forEach(p => newPerms.add(p.id))
    setFormPermissions(newPerms)
  }

  const deselectAllInCategory = (category: PermissionCategory) => {
    const categoryPerms = dbPermissions.filter(p => p.category === category)
    const newPerms = new Set(formPermissions)
    categoryPerms.forEach(p => newPerms.delete(p.id))
    setFormPermissions(newPerms)
  }

  const getPermissionsByCategory = () => {
    const grouped: Record<string, Permission[]> = {}
    for (const perm of dbPermissions) {
      if (!grouped[perm.category]) {
        grouped[perm.category] = []
      }
      grouped[perm.category].push(perm)
    }
    return grouped
  }

  const permsByCategory = getPermissionsByCategory()

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
              <Link href="/admin" className="hover:text-indigo-600">Admin</Link>
              <span>/</span>
              <span>Roles & Permissions</span>
            </div>
            <h1 className="text-3xl font-bold text-gray-900">Roles & Permissions</h1>
            <p className="mt-1 text-gray-600">Manage role-based and individual user permissions</p>
          </div>
          {activeTab === 'roles' && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
            >
              + New Role
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex gap-8">
            <button
              onClick={() => setActiveTab('roles')}
              className={`pb-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'roles'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Custom Roles
              <span className="ml-2 py-0.5 px-2 rounded-full text-xs bg-gray-100 text-gray-600">
                {roles.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('users')}
              className={`pb-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'users'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Individual User Permissions
              <span className="ml-2 py-0.5 px-2 rounded-full text-xs bg-gray-100 text-gray-600">
                {users.filter(u => u.user_permissions?.length > 0).length}
              </span>
            </button>
          </nav>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-500">
            Loading...
          </div>
        ) : activeTab === 'users' ? (
          /* User Permissions Tab */
          <div>
            {/* Search */}
            <div className="mb-6">
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search users by name, email, or role..."
                className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            {/* Info Banner */}
            <div className="mb-6 p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Individual permissions</strong> are additive to role-based permissions. 
                Use this to grant specific access (like Pricebook) to users without changing their role.
              </p>
            </div>

            {/* Users Table */}
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Additional Permissions</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-medium">
                            {user.full_name?.charAt(0) || '?'}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{user.full_name || 'Unknown'}</p>
                            <p className="text-sm text-gray-500">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 rounded text-sm bg-gray-100 text-gray-700 capitalize">
                          {user.role?.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {user.user_permissions?.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {user.user_permissions.slice(0, 3).map((up) => (
                              <span
                                key={up.permission_id}
                                className="px-2 py-0.5 bg-green-50 text-green-700 text-xs rounded"
                              >
                                {up.permissions?.display_name}
                              </span>
                            ))}
                            {user.user_permissions.length > 3 && (
                              <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">
                                +{user.user_permissions.length - 3} more
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400 text-sm">None</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => openUserPermissionsModal(user)}
                          className="px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg font-medium"
                        >
                          Manage Permissions
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredUsers.length === 0 && (
                <div className="p-8 text-center text-gray-500">
                  No users found matching your search.
                </div>
              )}
            </div>
          </div>
        ) : roles.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center">
            <div className="text-gray-400 mb-4">
              <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-1">No custom roles yet</h3>
            <p className="text-gray-500 mb-4">
              Create custom roles to define specific permissions for different positions.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
            >
              Create First Role
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {roles.map((role) => (
              <div key={role.id} className="bg-white rounded-xl shadow-sm border p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-gray-900">{role.display_name}</h3>
                      {role.is_system_role && (
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">System</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 font-mono">{role.name}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEditModal(role)}
                      className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                      title="Edit"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    {!role.is_system_role && (
                      <button
                        onClick={() => handleDelete(role)}
                        className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                        title="Delete"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                {role.description && (
                  <p className="text-sm text-gray-600 mb-4">{role.description}</p>
                )}

                <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
                  <span className="flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                    Level {role.hierarchy_level}
                  </span>
                  <span className="flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    {role.user_count || 0} user{role.user_count !== 1 ? 's' : ''}
                  </span>
                </div>

                <div className="border-t pt-4">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                    {role.permissions.length} Permission{role.permissions.length !== 1 ? 's' : ''}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {role.permissions.slice(0, 5).map((perm) => (
                      <span
                        key={perm.id}
                        className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded"
                      >
                        {perm.display_name}
                      </span>
                    ))}
                    {role.permissions.length > 5 && (
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">
                        +{role.permissions.length - 5} more
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create/Edit Modal */}
        {(showCreateModal || editingRole) && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">
                  {editingRole ? 'Edit Role' : 'Create New Role'}
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
                      Internal Name *
                    </label>
                    <input
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                      placeholder="e.g., setter_manager"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      disabled={!!editingRole}
                    />
                    <p className="mt-1 text-xs text-gray-500">Lowercase letters, numbers, underscores only</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Display Name *
                    </label>
                    <input
                      type="text"
                      value={formDisplayName}
                      onChange={(e) => setFormDisplayName(e.target.value)}
                      placeholder="e.g., Setter Manager"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Description
                    </label>
                    <textarea
                      value={formDescription}
                      onChange={(e) => setFormDescription(e.target.value)}
                      placeholder="Describe what this role is for..."
                      rows={2}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Hierarchy Level
                    </label>
                    <select
                      value={formHierarchyLevel}
                      onChange={(e) => setFormHierarchyLevel(parseInt(e.target.value) || 50)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                    >
                      <option value={100}>100 - Admin/Owner</option>
                      <option value={90}>90 - Regional Operations</option>
                      <option value={85}>85 - Operations Manager</option>
                      <option value={80}>80 - Regional Sales Manager</option>
                      <option value={75}>75 - Operations</option>
                      <option value={70}>70 - Sales Manager</option>
                      <option value={65}>65 - Regional Setter Manager</option>
                      <option value={60}>60 - Setter Manager</option>
                      <option value={55}>55 - Field Operations</option>
                      <option value={50}>50 - Sales Rep</option>
                      <option value={40}>40 - Setter</option>
                      <option value={30}>30 - Sub Contractor</option>
                    </select>
                    <p className="mt-1 text-xs text-gray-500">Higher levels can manage lower levels</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Inherits From (Optional)
                    </label>
                    <select
                      value={formParentRoleId}
                      onChange={(e) => setFormParentRoleId(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                    >
                      <option value="">No inheritance</option>
                      {roles
                        .filter(r => r.id !== editingRole?.id)
                        .map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.display_name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-4">
                    Permissions ({formPermissions.size} selected)
                  </h3>
                  
                  <div className="space-y-2">
                    {permissionCategories.map((category) => {
                      const categoryPerms = permsByCategory[category] || []
                      if (categoryPerms.length === 0) return null
                      
                      const isExpanded = expandedCategories.has(category)
                      const selectedCount = categoryPerms.filter(p => formPermissions.has(p.id)).length
                      
                      return (
                        <div key={category} className="border rounded-lg">
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
                              <span className="text-sm text-gray-500">
                                {selectedCount}/{categoryPerms.length}
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
                              {categoryPerms.map((perm) => (
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
                  onClick={editingRole ? handleUpdate : handleCreate}
                  disabled={saving}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingRole ? 'Update Role' : 'Create Role'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* User Permissions Modal */}
        {editingUser && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">
                    Manage Permissions
                  </h2>
                  <p className="text-sm text-gray-500">
                    {editingUser.full_name} ({editingUser.email})
                  </p>
                </div>
                <button
                  onClick={() => {
                    setEditingUser(null)
                    setUserPermissions(new Set())
                  }}
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

                {/* User Info */}
                <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-lg">
                      {editingUser.full_name?.charAt(0) || '?'}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{editingUser.full_name}</p>
                      <p className="text-sm text-gray-500">
                        Base Role: <span className="capitalize font-medium">{editingUser.role?.replace('_', ' ')}</span>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-sm text-amber-800">
                    <strong>Note:</strong> These permissions are <em>in addition to</em> the user&apos;s role-based permissions. 
                    Checking a permission here grants it regardless of their role.
                  </p>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-4">
                    Individual Permissions ({userPermissions.size} selected)
                  </h3>
                  
                  <div className="space-y-2">
                    {permissionCategories.map((category) => {
                      const categoryPerms = permsByCategory[category] || []
                      if (categoryPerms.length === 0) return null
                      
                      const isExpanded = userExpandedCategories.has(category)
                      const selectedCount = categoryPerms.filter(p => userPermissions.has(p.id)).length
                      
                      return (
                        <div key={category} className="border rounded-lg">
                          <button
                            type="button"
                            onClick={() => toggleUserCategory(category)}
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
                              <span className="text-sm text-gray-500">
                                {selectedCount}/{categoryPerms.length}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  selectAllUserInCategory(category)
                                }}
                                className="text-xs text-indigo-600 hover:underline"
                              >
                                All
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  deselectAllUserInCategory(category)
                                }}
                                className="text-xs text-gray-500 hover:underline"
                              >
                                None
                              </button>
                            </div>
                          </button>
                          
                          {isExpanded && (
                            <div className="px-4 pb-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                              {categoryPerms.map((perm) => (
                                <label
                                  key={perm.id}
                                  className="flex items-start gap-3 p-2 rounded hover:bg-gray-50 cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={userPermissions.has(perm.id)}
                                    onChange={() => toggleUserPermission(perm.id)}
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
                  onClick={() => {
                    setEditingUser(null)
                    setUserPermissions(new Set())
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={saveUserPermissions}
                  disabled={saving}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Permissions'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Info panel */}
        {activeTab === 'roles' && (
          <div className="mt-8 bg-blue-50 rounded-xl p-6">
            <h3 className="font-semibold text-blue-900 mb-3">Role Hierarchy</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-blue-800 mb-4">
              <div><strong>100</strong> Admin/Owner</div>
              <div><strong>90</strong> Regional Operations</div>
              <div><strong>85</strong> Operations Manager</div>
              <div><strong>80</strong> Regional Sales Manager</div>
              <div><strong>75</strong> Operations</div>
              <div><strong>70</strong> Sales Manager</div>
              <div><strong>65</strong> Regional Setter Manager</div>
              <div><strong>60</strong> Setter Manager</div>
              <div><strong>55</strong> Field Operations</div>
              <div><strong>50</strong> Sales Rep</div>
              <div><strong>40</strong> Setter</div>
              <div><strong>30</strong> Sub Contractor</div>
            </div>
            <ul className="text-sm text-blue-800 space-y-2">
              <li><strong>Hierarchy Level:</strong> Higher levels can manage and view data from lower levels.</li>
              <li><strong>Inheritance:</strong> A role can inherit permissions from a parent role, then add more specific ones.</li>
              <li><strong>System Roles:</strong> Built-in roles that cannot be deleted but can be modified.</li>
            </ul>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="mt-8 bg-blue-50 rounded-xl p-6">
            <h3 className="font-semibold text-blue-900 mb-3">About Individual Permissions</h3>
            <ul className="text-sm text-blue-800 space-y-2">
              <li><strong>Additive:</strong> Individual permissions are added on top of role-based permissions.</li>
              <li><strong>Use Cases:</strong> Grant Pricebook access to specific sales reps, give report access to team leads, etc.</li>
              <li><strong>Priority:</strong> If a user has an individual permission, they have it regardless of their role.</li>
              <li><strong>Revocation:</strong> To remove access, uncheck the permission here. Role-based access cannot be revoked individually.</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
