'use client'

import { useEffect, useState } from 'react'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { getRoleDisplayName } from '@/lib/permissions'
import type { User, Team, Region, UserRole, CustomRole } from '@/lib/types/database'

type Permission = {
  id: string
  name: string
  display_name: string
  category: string
}

type UserPermission = {
  id: string
  permission_id: string
  granted_at: string
  permissions?: Permission
}

type UserWithDetails = User & {
  team?: Team | null
  region?: Region | null
  custom_role?: CustomRole | null
  manager?: User | null
}

const legacyRoleOptions: UserRole[] = [
  'owner',
  'admin',
  'regional_manager',
  'regional_setter_manager',
  'sales_manager',
  'setter_manager',
  'sales_rep',
  'setter',
  'canvasser',
  'operations',
  'custom',
]

// Permissions that can be granted individually to users
const grantablePermissions = [
  { name: 'pricebook:view', display_name: 'View Pricebook', category: 'Pricebook' },
  { name: 'pricebook:edit', display_name: 'Edit Pricebook', category: 'Pricebook' },
  { name: 'reports:view_all', display_name: 'View All Reports', category: 'Reports' },
  { name: 'reports:export', display_name: 'Export Reports', category: 'Reports' },
  { name: 'admin:access', display_name: 'Access Admin Panel', category: 'Admin' },
]

// Permission preset type from database
type PermissionPreset = {
  id: string
  name: string
  description: string | null
  base_role: string
  color: string
  is_system: boolean
  preset_permissions: {
    permission_id: string
    permissions: Permission
  }[]
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserWithDetails[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([])
  const [allPermissions, setAllPermissions] = useState<Permission[]>([])
  const [permissionPresets, setPermissionPresets] = useState<PermissionPreset[]>([])
  const [loading, setLoading] = useState(true)
  const [editingUser, setEditingUser] = useState<UserWithDetails | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [userPermissions, setUserPermissions] = useState<UserPermission[]>([])
  const [formRole, setFormRole] = useState<UserRole>('sales_rep')
  const [formCustomRoleId, setFormCustomRoleId] = useState('')
  const [formTeamId, setFormTeamId] = useState('')
  const [formRegionId, setFormRegionId] = useState('')
  const [formManagerId, setFormManagerId] = useState('')
  const [formCanvassVisibility, setFormCanvassVisibility] = useState<'own' | 'team' | 'region' | 'org' | 'territory'>('org')
  const [formShowInReports, setFormShowInReports] = useState(true)
  const [formCanReceiveAppointments, setFormCanReceiveAppointments] = useState<boolean | null>(null)
  const [formDashboardView, setFormDashboardView] = useState<'sales' | 'ops'>('sales')
  const [formEmail, setFormEmail] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formFullName, setFormFullName] = useState('')
  const [sendingReset, setSendingReset] = useState(false)
  // Create user form fields
  const [createEmail, setCreateEmail] = useState('')
  const [createFullName, setCreateFullName] = useState('')
  const [createPhone, setCreatePhone] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [selectedPreset, setSelectedPreset] = useState<string>('')
  const [createPermissions, setCreatePermissions] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterRole, setFilterRole] = useState<string>('')
  const [filterTeam, setFilterTeam] = useState<string>('')
  const [viewMode, setViewMode] = useState<'list' | 'hierarchy'>('list')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const response = await fetch('/api/admin/users')
      if (!response.ok) {
        const err = await response.json()
        setError(err.error || 'Failed to load data')
        setLoading(false)
        return
      }
      
      const data = await response.json()
      setUsers(data.users || [])
      setTeams(data.teams || [])
      setRegions(data.regions || [])
      setCustomRoles(data.customRoles || [])
      setAllPermissions(data.permissions || [])
      setPermissionPresets(data.permissionPresets || [])
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
        // Convert permission_ids to UserPermission format for compatibility
        const perms = (data.permission_ids || []).map((permId: string) => {
          const perm = allPermissions.find(p => p.id === permId)
          return {
            id: permId,
            permission_id: permId,
            granted_at: new Date().toISOString(),
            permissions: perm,
          }
        })
        setUserPermissions(perms)
      }
    } catch {
      // Ignore errors
    }
  }

  const togglePermission = async (permissionName: string) => {
    if (!editingUser) return
    
    const permission = allPermissions.find(p => p.name === permissionName)
    if (!permission) return

    const existingPerm = userPermissions.find(
      up => up.permissions?.name === permissionName
    )

    // Build new permission list
    let newPermIds: string[]
    if (existingPerm) {
      // Remove permission
      newPermIds = userPermissions
        .filter(up => up.permission_id !== permission.id)
        .map(up => up.permission_id)
    } else {
      // Add permission
      newPermIds = [...userPermissions.map(up => up.permission_id), permission.id]
    }

    try {
      const response = await fetch('/api/admin/user-permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: editingUser.id,
          permission_ids: newPermIds,
        }),
      })

      if (response.ok) {
        await loadUserPermissions(editingUser.id)
      }
    } catch {
      // Ignore errors
    }
  }

  const hasPermission = (permissionName: string) => {
    return userPermissions.some(up => up.permissions?.name === permissionName)
  }

  const resetCreateForm = () => {
    setCreateEmail('')
    setCreateFullName('')
    setCreatePhone('')
    setCreatePassword('')
    setFormRole('sales_rep')
    setFormCustomRoleId('')
    setFormTeamId('')
    setFormRegionId('')
    setFormManagerId('')
    setFormCanvassVisibility('org')
    setSelectedPreset('')
    setCreatePermissions(new Set())
    setError(null)
  }

  const openCreateModal = () => {
    resetCreateForm()
    setShowCreateModal(true)
  }

  const handlePresetSelect = (presetId: string) => {
    setSelectedPreset(presetId)
    const preset = permissionPresets.find(p => p.id === presetId)
    if (preset) {
      setFormRole(preset.base_role as UserRole)
      // Get permission IDs from preset
      const permIds = new Set<string>()
      preset.preset_permissions.forEach(pp => {
        permIds.add(pp.permission_id)
      })
      setCreatePermissions(permIds)
    } else {
      setCreatePermissions(new Set())
    }
  }

  const toggleCreatePermission = (permId: string) => {
    const newPerms = new Set(createPermissions)
    if (newPerms.has(permId)) {
      newPerms.delete(permId)
    } else {
      newPerms.add(permId)
    }
    setCreatePermissions(newPerms)
    // Clear preset selection since permissions were manually changed
    setSelectedPreset('')
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

  const handleCreateUser = async () => {
    if (!createEmail.trim() || !createFullName.trim()) {
      setError('Email and full name are required')
      return
    }

    if (!createPassword || createPassword.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: createEmail.trim(),
          password: createPassword,
          full_name: createFullName.trim(),
          phone: createPhone.trim() || null,
          role: formRole,
          custom_role_id: formCustomRoleId || null,
          team_id: formTeamId || null,
          region_id: formRegionId || null,
          manager_user_id: formManagerId || null,
          canvass_pin_visibility: formCanvassVisibility,
          permission_ids: Array.from(createPermissions),
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        setError(result.error || 'Failed to create user')
        setSaving(false)
        return
      }

      setShowCreateModal(false)
      resetCreateForm()
      await loadData()
    } catch {
      setError('Failed to create user')
    }
    setSaving(false)
  }

  const handleEdit = async (user: UserWithDetails) => {
    setEditingUser(user)
    setFormRole(user.role as UserRole)
    setFormCustomRoleId(user.custom_role_id || '')
    setFormTeamId(user.team_id || '')
    setFormRegionId(user.region_id || '')
    setFormManagerId(user.manager_user_id || '')
    setFormCanvassVisibility((user as any).canvass_pin_visibility || 'org')
    setFormShowInReports((user as any).show_in_reports !== false) // Default true if not set
    setFormCanReceiveAppointments((user as any).can_receive_appointments ?? null)
    setFormDashboardView((user as any).dashboard_view || 'sales')
    setFormEmail(user.email || '')
    setFormPhone((user as any).phone || '')
    setFormFullName(user.full_name || '')
    setError(null)
    await loadUserPermissions(user.id)
  }

  const handleSave = async () => {
    if (!editingUser) return

    setSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingUser.id,
          email: formEmail !== editingUser.email ? formEmail : undefined,
          phone: formPhone,
          full_name: formFullName !== editingUser.full_name ? formFullName : undefined,
          role: formRole,
          custom_role_id: formCustomRoleId || null,
          team_id: formTeamId || null,
          region_id: formRegionId || null,
          manager_user_id: formManagerId || null,
          canvass_pin_visibility: formCanvassVisibility,
          show_in_reports: formShowInReports,
          can_receive_appointments: formCanReceiveAppointments,
          dashboard_view: formDashboardView,
        }),
      })

      if (!response.ok) {
        const err = await response.json()
        setError(err.error || 'Failed to update user')
      } else {
        setEditingUser(null)
        await loadData()
      }
    } catch {
      setError('Failed to update user')
    }
    setSaving(false)
  }

  const getUserRoleDisplay = (user: UserWithDetails) => {
    if (user.custom_role) {
      return user.custom_role.display_name
    }
    return getRoleDisplayName(user.role as UserRole)
  }

  const handleToggleActive = async (user: UserWithDetails) => {
    const action = user.active ? 'deactivate' : 'activate'
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} ${user.full_name || 'this user'}?`)) return

    try {
      const response = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: user.id,
          active: !user.active,
        }),
      })

      if (response.ok) {
        await loadData()
      }
    } catch {
      // Ignore errors
    }
  }

  const handleDeleteUser = async (user: UserWithDetails) => {
    const confirmMsg = `⚠️ WARNING: Permanently delete ${user.full_name || 'this user'}?\n\n` +
      `This will:\n` +
      `• Remove the user's login access\n` +
      `• Delete their commission records\n` +
      `• Delete their comp plan assignments\n\n` +
      `Their leads, opportunities, and jobs will be preserved but unassigned.\n\n` +
      `💡 TIP: Consider DEACTIVATING instead to preserve all history.\n\n` +
      `Type "DELETE" in the next prompt to confirm permanent deletion.`
    
    if (!confirm(confirmMsg)) return
    
    const typed = prompt('Type DELETE to confirm permanent deletion:')
    if (typed !== 'DELETE') {
      alert('Deletion cancelled - text did not match.')
      return
    }

    try {
      const response = await fetch(`/api/admin/users?id=${user.id}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (response.ok) {
        await loadData()
      } else {
        alert(data.error || 'Failed to delete user')
      }
    } catch {
      alert('Failed to delete user')
    }
  }

  const handleSendPasswordReset = async (user: UserWithDetails) => {
    if (!confirm(`Send a password reset email to ${user.email}?`)) return

    try {
      const response = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          action: 'reset_password',
        }),
      })

      const data = await response.json()

      if (response.ok) {
        alert(`Password reset email sent to ${user.email}`)
      } else {
        alert(data.error || 'Failed to send reset email')
      }
    } catch {
      alert('Failed to send reset email')
    }
  }

  const filteredUsers = users.filter(u => {
    if (filterRole) {
      if (filterRole.startsWith('custom:')) {
        const customRoleId = filterRole.replace('custom:', '')
        if (u.custom_role_id !== customRoleId) return false
      } else {
        if (u.role !== filterRole) return false
      }
    }
    if (filterTeam && u.team_id !== filterTeam) return false
    return true
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <Link href="/admin" className="hover:text-indigo-600">Admin</Link>
              <span>/</span>
              <span>Users</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Users</h1>
            <p className="mt-1 text-sm text-gray-600 hidden sm:block">Manage user accounts and role assignments</p>
          </div>
          <button
            onClick={openCreateModal}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium flex items-center justify-center gap-2 w-full sm:w-auto"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add User
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
            <div className="grid grid-cols-2 sm:flex gap-3 sm:gap-4 flex-1">
              <div className="flex-1 sm:flex-initial">
                <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
                <select
                  value={filterRole}
                  onChange={(e) => setFilterRole(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                >
                  <option value="">All roles</option>
                  <optgroup label="Legacy Roles">
                    {legacyRoleOptions.map((role) => (
                      <option key={role} value={role}>
                        {getRoleDisplayName(role)}
                      </option>
                    ))}
                  </optgroup>
                  {customRoles.length > 0 && (
                    <optgroup label="Custom Roles">
                      {customRoles.map((role) => (
                        <option key={`custom-${role.id}`} value={`custom:${role.id}`}>
                          {role.display_name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
              <div className="flex-1 sm:flex-initial">
                <label className="block text-xs font-medium text-gray-500 mb-1">Team</label>
                <select
                  value={filterTeam}
                  onChange={(e) => setFilterTeam(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                >
                  <option value="">All teams</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-end justify-between sm:justify-end gap-3 sm:gap-4">
              <span className="text-sm text-gray-500 whitespace-nowrap">
                {filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''}
              </span>
              <div className="flex border border-gray-300 rounded-lg overflow-hidden">
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-3 py-1.5 text-sm ${viewMode === 'list' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  List
                </button>
                <button
                  onClick={() => setViewMode('hierarchy')}
                  className={`px-3 py-1.5 text-sm ${viewMode === 'hierarchy' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  Org
                </button>
              </div>
            </div>
          </div>
        </div>

        {error && !editingUser && !showCreateModal && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
            <strong>Error:</strong> {error}
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-500">
            Loading users...
          </div>
        ) : viewMode === 'hierarchy' ? (
          /* Org Chart View */
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="space-y-6">
              {/* Top-level managers (no manager assigned) */}
              {filteredUsers
                .filter(u => !u.manager_user_id && u.active && ['admin', 'regional_manager', 'sales_manager'].includes(u.role))
                .map(topManager => {
                  const directReports = filteredUsers.filter(u => u.manager_user_id === topManager.id && u.active)
                  return (
                    <div key={topManager.id} className="border rounded-xl p-4">
                      {/* Top Manager Card */}
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-lg">
                          {topManager.full_name?.charAt(0) || '?'}
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">{topManager.full_name || 'Unknown'}</p>
                          <p className="text-sm text-indigo-600">{getUserRoleDisplay(topManager)}</p>
                          {topManager.team?.name && <p className="text-xs text-gray-500">{topManager.team.name}</p>}
                        </div>
                        <button
                          onClick={() => handleEdit(topManager)}
                          className="ml-auto p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                      </div>
                      
                      {/* Direct Reports */}
                      {directReports.length > 0 && (
                        <div className="ml-8 border-l-2 border-gray-200 pl-6 space-y-3">
                          {directReports.map(report => {
                            const subReports = filteredUsers.filter(u => u.manager_user_id === report.id && u.active)
                            return (
                              <div key={report.id}>
                                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                                  <div className="w-10 h-10 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center font-medium">
                                    {report.full_name?.charAt(0) || '?'}
                                  </div>
                                  <div className="flex-1">
                                    <p className="font-medium text-gray-900">{report.full_name || 'Unknown'}</p>
                                    <p className="text-xs text-gray-500">{getUserRoleDisplay(report)}</p>
                                  </div>
                                  <span className="text-xs text-gray-400">{report.team?.name || ''}</span>
                                  <button
                                    onClick={() => handleEdit(report)}
                                    className="p-1.5 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-200"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                    </svg>
                                  </button>
                                </div>
                                
                                {/* Sub-reports (third level) */}
                                {subReports.length > 0 && (
                                  <div className="ml-6 mt-2 border-l border-gray-200 pl-4 space-y-2">
                                    {subReports.map(sub => (
                                      <div key={sub.id} className="flex items-center gap-2 p-2 rounded hover:bg-gray-50">
                                        <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-sm">
                                          {sub.full_name?.charAt(0) || '?'}
                                        </div>
                                        <div className="flex-1">
                                          <p className="text-sm text-gray-700">{sub.full_name || 'Unknown'}</p>
                                          <p className="text-xs text-gray-400">{getUserRoleDisplay(sub)}</p>
                                        </div>
                                        <button
                                          onClick={() => handleEdit(sub)}
                                          className="p-1 text-gray-400 hover:text-gray-600"
                                        >
                                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                          </svg>
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              
              {/* Unassigned users section */}
              {filteredUsers.filter(u => !u.manager_user_id && u.active && !['admin', 'regional_manager', 'sales_manager'].includes(u.role)).length > 0 && (
                <div className="border border-dashed border-gray-300 rounded-xl p-4">
                  <h3 className="text-sm font-medium text-gray-500 mb-3">Unassigned (No Manager)</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {filteredUsers
                      .filter(u => !u.manager_user_id && u.active && !['admin', 'regional_manager', 'sales_manager'].includes(u.role))
                      .map(user => (
                        <button
                          key={user.id}
                          onClick={() => handleEdit(user)}
                          className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 text-left"
                        >
                          <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center text-sm">
                            {user.full_name?.charAt(0) || '?'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-700 truncate">{user.full_name || 'Unknown'}</p>
                            <p className="text-xs text-gray-400">{getUserRoleDisplay(user)}</p>
                          </div>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* List View - Cards on mobile, table on desktop */
          <>
            {/* Mobile Card View */}
            <div className="md:hidden space-y-3">
              {filteredUsers.map((user) => (
                <div 
                  key={user.id} 
                  className={`bg-white rounded-xl shadow-sm border p-4 ${!user.active ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-medium text-lg">
                        {user.full_name?.charAt(0) || '?'}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{user.full_name || 'Unknown'}</p>
                        <p className="text-sm text-gray-500">{user.email}</p>
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      user.active 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {user.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                    <div>
                      <span className="text-gray-500">Role:</span>
                      <span className={`ml-1 px-2 py-0.5 rounded text-xs ${
                        user.custom_role 
                          ? 'bg-indigo-100 text-indigo-700' 
                          : 'bg-gray-100 text-gray-700'
                      }`}>
                        {getUserRoleDisplay(user)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Team:</span>
                      <span className="ml-1 text-gray-700">{user.team?.name || '-'}</span>
                    </div>
                    {user.manager && (
                      <div className="col-span-2">
                        <span className="text-gray-500">Reports to:</span>
                        <span className="ml-1 text-gray-700">{user.manager.full_name || user.manager.email}</span>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex items-center justify-end gap-1 pt-2 border-t">
                    <button
                      onClick={() => handleEdit(user)}
                      className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                      title="Edit"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleSendPasswordReset(user)}
                      className="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50"
                      title="Send Password Reset"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleToggleActive(user)}
                      className={`p-2 rounded-lg ${
                        user.active 
                          ? 'text-gray-400 hover:text-amber-600 hover:bg-amber-50' 
                          : 'text-gray-400 hover:text-green-600 hover:bg-green-50'
                      }`}
                      title={user.active ? 'Deactivate' : 'Activate'}
                    >
                      {user.active ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      )}
                    </button>
                    <button
                      onClick={() => handleDeleteUser(user)}
                      className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                      title="Delete User"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block bg-white rounded-xl shadow-sm border overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reports To</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Region</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dashboard</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className={!user.active ? 'bg-gray-50 opacity-60' : ''}>
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
                        <span className={`px-2 py-1 rounded text-sm ${
                          user.custom_role 
                            ? 'bg-indigo-100 text-indigo-700' 
                            : 'bg-gray-100 text-gray-700'
                        }`}>
                          {getUserRoleDisplay(user)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {user.manager ? (
                          <span className="text-sm">{user.manager.full_name || user.manager.email}</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {user.team?.name || '-'}
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {user.region?.name || '-'}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          (user as any).dashboard_view === 'ops'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {(user as any).dashboard_view === 'ops' ? 'Ops' : 'Sales'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          user.active 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-gray-100 text-gray-500'
                        }`}>
                          {user.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleEdit(user)}
                            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                            title="Edit"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleSendPasswordReset(user)}
                            className="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50"
                            title="Send Password Reset"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleToggleActive(user)}
                            className={`p-2 rounded-lg ${
                              user.active 
                                ? 'text-gray-400 hover:text-amber-600 hover:bg-amber-50' 
                                : 'text-gray-400 hover:text-green-600 hover:bg-green-50'
                            }`}
                            title={user.active ? 'Deactivate' : 'Activate'}
                          >
                            {user.active ? (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                              </svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            )}
                          </button>
                          <button
                            onClick={() => handleDeleteUser(user)}
                            className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                            title="Delete User"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Create User Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-semibold text-gray-900">
                    Add New User
                  </h2>
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {error && (
                  <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                    {error}
                  </div>
                )}

                <div className="space-y-4">
                  {/* Basic Info */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Full Name *
                      </label>
                      <input
                        type="text"
                        value={createFullName}
                        onChange={(e) => setCreateFullName(e.target.value)}
                        placeholder="John Smith"
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Email *
                      </label>
                      <input
                        type="email"
                        value={createEmail}
                        onChange={(e) => setCreateEmail(e.target.value)}
                        placeholder="john@company.com"
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Phone
                      </label>
                      <input
                        type="tel"
                        value={createPhone}
                        onChange={(e) => setCreatePhone(e.target.value)}
                        placeholder="(555) 123-4567"
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Temporary Password *
                      </label>
                      <input
                        type="text"
                        value={createPassword}
                        onChange={(e) => setCreatePassword(e.target.value)}
                        placeholder="Min 6 characters"
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        User can change this after first login
                      </p>
                    </div>
                  </div>

                  {/* Role Preset Selection */}
                  <div className="border-t pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-gray-900">Role Preset</h3>
                      <Link
                        href="/admin/presets"
                        className="text-xs text-indigo-600 hover:text-indigo-700"
                      >
                        Manage Presets →
                      </Link>
                    </div>
                    <p className="text-xs text-gray-500 mb-3">
                      Select a preset to automatically configure role and permissions. You can customize after selecting.
                    </p>
                    
                    {permissionPresets.length === 0 ? (
                      <div className="p-4 bg-gray-50 rounded-lg text-center">
                        <p className="text-sm text-gray-500 mb-2">No presets configured yet</p>
                        <Link
                          href="/admin/presets"
                          className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                        >
                          Create your first preset →
                        </Link>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
                        {permissionPresets.map((preset) => {
                          const colorMap: Record<string, string> = {
                            gray: 'border-gray-300 bg-gray-50',
                            red: 'border-red-300 bg-red-50',
                            orange: 'border-orange-300 bg-orange-50',
                            yellow: 'border-yellow-300 bg-yellow-50',
                            green: 'border-green-300 bg-green-50',
                            blue: 'border-blue-300 bg-blue-50',
                            indigo: 'border-indigo-300 bg-indigo-50',
                            purple: 'border-purple-300 bg-purple-50',
                            pink: 'border-pink-300 bg-pink-50',
                          }
                          const selectedColor = selectedPreset === preset.id
                            ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500'
                            : colorMap[preset.color] || 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                          
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => handlePresetSelect(preset.id)}
                              className={`p-3 rounded-lg border text-left transition-all ${selectedColor}`}
                            >
                              <p className={`font-medium text-sm ${
                                selectedPreset === preset.id ? 'text-indigo-700' : 'text-gray-900'
                              }`}>
                                {preset.name}
                              </p>
                              <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                                {preset.description || `${preset.preset_permissions.length} permissions`}
                              </p>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Team & Manager Assignment */}
                  <div className="border-t pt-4">
                    <h3 className="text-sm font-medium text-gray-900 mb-3">Team Assignment</h3>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Team
                        </label>
                        <select
                          value={formTeamId}
                          onChange={(e) => setFormTeamId(e.target.value)}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                        >
                          <option value="">No team</option>
                          {teams.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Region
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
                    </div>

                    <div className="mt-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Reports To (Manager)
                      </label>
                      <select
                        value={formManagerId}
                        onChange={(e) => setFormManagerId(e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                      >
                        <option value="">No manager assigned</option>
                        <optgroup label="Leadership">
                          {users
                            .filter(u => 
                              u.active && 
                              u.id !== editingUser?.id &&
                              ['owner', 'admin', 'regional_manager', 'regional_setter_manager', 'sales_manager', 'setter_manager'].includes(u.role)
                            )
                            .map((manager) => (
                              <option key={manager.id} value={manager.id}>
                                {manager.full_name || manager.email} ({getUserRoleDisplay(manager)})
                              </option>
                            ))}
                        </optgroup>
                        <optgroup label="Other Users">
                          {users
                            .filter(u => 
                              u.active && 
                              u.id !== editingUser?.id &&
                              !['owner', 'admin', 'regional_manager', 'regional_setter_manager', 'sales_manager', 'setter_manager'].includes(u.role)
                            )
                            .map((user) => (
                              <option key={user.id} value={user.id}>
                                {user.full_name || user.email} ({getUserRoleDisplay(user)})
                              </option>
                            ))}
                        </optgroup>
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        Select who this user reports to for commission overrides and team structure.
                      </p>
                    </div>
                  </div>

                  {/* Canvass Pin Visibility */}
                  <div className="border-t pt-4">
                    <h3 className="text-sm font-medium text-gray-900 mb-2">Canvass Map Pin Visibility</h3>
                    <p className="text-xs text-gray-500 mb-3">
                      Control which pins this user can see in the canvassing app. This helps prevent data overload in large organizations.
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {[
                        { value: 'own', label: 'Own Pins Only', desc: 'Only their own pins', icon: '👤' },
                        { value: 'team', label: 'Team Pins', desc: 'Pins from their team', icon: '👥' },
                        { value: 'region', label: 'Region Pins', desc: 'Pins from their region', icon: '🗺️' },
                        { value: 'territory', label: 'Work areas', desc: 'Pins inside assigned map polygons only', icon: '📍' },
                        { value: 'org', label: 'All Company', desc: 'All pins in company', icon: '🏢' },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setFormCanvassVisibility(option.value as any)}
                          className={`p-3 rounded-lg border text-left transition-all ${
                            formCanvassVisibility === option.value
                              ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500'
                              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span>{option.icon}</span>
                            <span className={`font-medium text-sm ${
                              formCanvassVisibility === option.value ? 'text-indigo-700' : 'text-gray-900'
                            }`}>
                              {option.label}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500">{option.desc}</p>
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-amber-600 bg-amber-50 p-2 rounded">
                      Note: Admins and managers always see all pins regardless of this setting.
                    </p>
                    <p className="mt-2 text-xs text-gray-600">
                      <strong>Work areas:</strong> managers draw polygons and assign reps or teams in the{' '}
                      <a href="/canvass/territories" className="text-indigo-600 hover:underline">
                        Canvass app → Work areas
                      </a>
                      , then set visibility to Work areas here.
                    </p>
                  </div>

                  {/* Permissions */}
                  <div className="border-t pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-gray-900">
                        Permissions ({createPermissions.size} selected)
                      </h3>
                      {selectedPreset && (
                        <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-1 rounded">
                          Based on: {permissionPresets.find(p => p.id === selectedPreset)?.name}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mb-3">
                      Customize permissions as needed. Changes will clear the preset selection.
                    </p>
                    
                    <div className="max-h-64 overflow-y-auto border rounded-lg">
                      {Object.entries(permsByCategory).map(([category, perms]) => (
                        <div key={category} className="border-b last:border-b-0">
                          <div className="px-3 py-2 bg-gray-50 sticky top-0">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-gray-700 uppercase">
                                {category}
                              </span>
                              <span className="text-xs text-gray-500">
                                {perms.filter(p => createPermissions.has(p.id)).length}/{perms.length}
                              </span>
                            </div>
                          </div>
                          <div className="p-2 grid grid-cols-1 md:grid-cols-2 gap-1">
                            {perms.map((perm) => (
                              <label
                                key={perm.id}
                                className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={createPermissions.has(perm.id)}
                                  onChange={() => toggleCreatePermission(perm.id)}
                                  className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span className="text-sm text-gray-700">{perm.display_name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Custom Role (Advanced) */}
                  <div className="border-t pt-4">
                    <details className="group">
                      <summary className="text-sm font-medium text-gray-700 cursor-pointer hover:text-gray-900">
                        Advanced: Custom Role Override
                      </summary>
                      <div className="mt-3 space-y-3">
                        <p className="text-xs text-gray-500">
                          Optionally assign a custom role instead of using the preset. Custom roles have their own permission sets defined in Admin → Roles.
                        </p>
                        <select
                          value={formCustomRoleId}
                          onChange={(e) => setFormCustomRoleId(e.target.value)}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                        >
                          <option value="">Use preset permissions instead</option>
                          {customRoles.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.display_name} (Level {role.hierarchy_level})
                            </option>
                          ))}
                        </select>
                      </div>
                    </details>
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateUser}
                    disabled={saving}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50"
                  >
                    {saving ? 'Creating...' : 'Create User'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Edit Modal */}
        {editingUser && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900">
                  Edit User
                </h2>
                <button
                  onClick={() => {
                    setEditingUser(null)
                    setUserPermissions([])
                  }}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-4 mb-6">
                {/* Basic Info Section */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-gray-700 mb-3">Basic Information</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Full Name
                      </label>
                      <input
                        type="text"
                        value={formFullName}
                        onChange={(e) => setFormFullName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Email Address
                      </label>
                      <input
                        type="email"
                        value={formEmail}
                        onChange={(e) => setFormEmail(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                      {formEmail !== editingUser.email && (
                        <p className="mt-1 text-xs text-amber-600">
                          Changing email will update their login credentials
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        value={formPhone}
                        onChange={(e) => setFormPhone(e.target.value)}
                        placeholder="(555) 123-4567"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Password Reset Section */}
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-gray-700">Password Reset</h3>
                      <p className="text-xs text-gray-500 mt-0.5">Send a password reset email to this user</p>
                    </div>
                    <button
                      onClick={async () => {
                        if (!confirm(`Send a password reset email to ${formEmail}?`)) return
                        setSendingReset(true)
                        try {
                          const response = await fetch('/api/admin/users', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              userId: editingUser.id,
                              action: 'reset_password',
                            }),
                          })
                          const data = await response.json()
                          if (response.ok) {
                            alert(`Password reset email sent to ${formEmail}`)
                          } else {
                            alert(data.error || 'Failed to send reset email')
                          }
                        } catch {
                          alert('Failed to send reset email')
                        }
                        setSendingReset(false)
                      }}
                      disabled={sendingReset}
                      className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                      </svg>
                      {sendingReset ? 'Sending...' : 'Send Reset'}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Custom Role (Recommended)
                  </label>
                  <select
                    value={formCustomRoleId}
                    onChange={(e) => setFormCustomRoleId(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                  >
                    <option value="">Use legacy role instead</option>
                    {customRoles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.display_name} (Level {role.hierarchy_level})
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Custom roles have granular permissions. <Link href="/admin/roles" className="text-indigo-600 hover:underline">Manage roles</Link>
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Legacy Role (Fallback)
                  </label>
                  <select
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value as UserRole)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                    disabled={!!formCustomRoleId}
                  >
                    {legacyRoleOptions.map((role) => (
                      <option key={role} value={role}>
                        {getRoleDisplayName(role)}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Used only if no custom role is selected
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Team
                  </label>
                  <select
                    value={formTeamId}
                    onChange={(e) => setFormTeamId(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                  >
                    <option value="">No team</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Region
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
                    Reports To (Manager)
                  </label>
                  <select
                    value={formManagerId}
                    onChange={(e) => setFormManagerId(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                  >
                    <option value="">No manager assigned</option>
                    <optgroup label="Leadership">
                      {users
                        .filter(u => 
                          u.active && 
                          ['owner', 'admin', 'regional_manager', 'regional_setter_manager', 'sales_manager', 'setter_manager'].includes(u.role)
                        )
                        .map((manager) => (
                          <option key={manager.id} value={manager.id}>
                            {manager.full_name || manager.email} ({getUserRoleDisplay(manager)})
                          </option>
                        ))}
                    </optgroup>
                    <optgroup label="Other Users">
                      {users
                        .filter(u => 
                          u.active && 
                          !['owner', 'admin', 'regional_manager', 'regional_setter_manager', 'sales_manager', 'setter_manager'].includes(u.role)
                        )
                        .map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.full_name || user.email} ({getUserRoleDisplay(user)})
                          </option>
                        ))}
                    </optgroup>
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Set who this user reports to for commission overrides and team structure.
                  </p>
                </div>

                {/* Canvass Pin Visibility */}
                <div className="border-t pt-4 mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Canvass Map Pin Visibility
                  </label>
                  <p className="text-xs text-gray-500 mb-3">
                    Control which pins this user can see in the canvassing app.
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {[
                      { value: 'own', label: 'Own Only', icon: '👤' },
                      { value: 'team', label: 'Team', icon: '👥' },
                      { value: 'region', label: 'Region', icon: '🗺️' },
                      { value: 'territory', label: 'Work areas', icon: '📍' },
                      { value: 'org', label: 'All Company', icon: '🏢' },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setFormCanvassVisibility(option.value as any)}
                        className={`p-2 rounded-lg border text-sm font-medium transition-all flex items-center gap-2 ${
                          formCanvassVisibility === option.value
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                            : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <span>{option.icon}</span>
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {['admin', 'regional_manager', 'sales_manager', 'operations'].includes(formRole) && (
                    <p className="mt-2 text-xs text-amber-600 bg-amber-50 p-2 rounded">
                      This user&apos;s role grants them access to all pins regardless of this setting.
                    </p>
                  )}
                </div>

                {/* Show in Reports Toggle */}
                <div className="border-t pt-4 mt-4">
                  <label className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer">
                    <div>
                      <span className="text-sm font-medium text-gray-700">Show in Reports & Leaderboards</span>
                      <p className="text-xs text-gray-500 mt-0.5">
                        When enabled, this user appears in team stats, leaderboards, and reports
                      </p>
                    </div>
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={formShowInReports}
                        onChange={(e) => setFormShowInReports(e.target.checked)}
                        className="sr-only"
                      />
                      <div className={`w-11 h-6 rounded-full transition-colors ${formShowInReports ? 'bg-indigo-600' : 'bg-gray-300'}`}>
                        <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${formShowInReports ? 'translate-x-5' : 'translate-x-0'}`} />
                      </div>
                    </div>
                  </label>

                  {/* Can Receive Appointments Toggle */}
                  <div className="mt-3">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Can Receive Appointments</label>
                    <div className="space-y-2">
                      <label className="flex items-center gap-3 p-2 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer">
                        <input
                          type="radio"
                          name="can_receive_appointments"
                          checked={formCanReceiveAppointments === null}
                          onChange={() => setFormCanReceiveAppointments(null)}
                          className="w-4 h-4 text-indigo-600 border-gray-300"
                        />
                        <div>
                          <span className="text-sm text-gray-700">Use Role Default</span>
                          <p className="text-xs text-gray-500">Sales roles can receive, Admin/Operations cannot</p>
                        </div>
                      </label>
                      <label className="flex items-center gap-3 p-2 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer">
                        <input
                          type="radio"
                          name="can_receive_appointments"
                          checked={formCanReceiveAppointments === true}
                          onChange={() => setFormCanReceiveAppointments(true)}
                          className="w-4 h-4 text-indigo-600 border-gray-300"
                        />
                        <div>
                          <span className="text-sm text-gray-700">Yes - Can Receive Appointments</span>
                          <p className="text-xs text-gray-500">User appears in closer selection and round-robin</p>
                        </div>
                      </label>
                      <label className="flex items-center gap-3 p-2 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer">
                        <input
                          type="radio"
                          name="can_receive_appointments"
                          checked={formCanReceiveAppointments === false}
                          onChange={() => setFormCanReceiveAppointments(false)}
                          className="w-4 h-4 text-indigo-600 border-gray-300"
                        />
                        <div>
                          <span className="text-sm text-gray-700">No - Cannot Receive Appointments</span>
                          <p className="text-xs text-gray-500">User will not appear in closer selection</p>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Dashboard View */}
                <div className="border-t pt-4 mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Dashboard View
                  </label>
                  <p className="text-xs text-gray-500 mb-3">
                    Choose which dashboard this user sees when they log in.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormDashboardView('sales')}
                      className={`p-3 rounded-lg border text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                        formDashboardView === 'sales'
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      Sales Dashboard
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormDashboardView('ops')}
                      className={`p-3 rounded-lg border text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                        formDashboardView === 'ops'
                          ? 'border-purple-500 bg-purple-50 text-purple-700'
                          : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                      Ops Dashboard
                    </button>
                  </div>
                </div>

                {/* Additional Permissions */}
                <div className="border-t pt-4 mt-4">
                  <div className="flex items-center justify-between mb-3">
                    <label className="block text-sm font-medium text-gray-700">
                      Quick Permissions
                    </label>
                    <Link
                      href="/admin/roles"
                      className="text-xs text-indigo-600 hover:underline"
                    >
                      Manage all permissions →
                    </Link>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">
                    Grant specific permissions beyond their role. These are additive to role-based permissions.
                  </p>
                  <div className="space-y-2">
                    {grantablePermissions.map((perm) => (
                      <label
                        key={perm.name}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={hasPermission(perm.name)}
                          onChange={() => togglePermission(perm.name)}
                          className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                        />
                        <div className="flex-1">
                          <span className="text-sm font-medium text-gray-700">
                            {perm.display_name}
                          </span>
                          <span className="ml-2 text-xs text-gray-400">
                            ({perm.category})
                          </span>
                        </div>
                        {hasPermission(perm.name) && (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                            Granted
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setEditingUser(null)
                    setUserPermissions([])
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
