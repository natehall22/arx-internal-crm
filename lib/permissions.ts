import type { SupabaseClient } from '@supabase/supabase-js'

import type { UserRole, CustomRoleWithPermissions, UserWithCustomRole } from './types/database'

// Permission definitions for each feature area
export type PermissionName =
  // Canvassing
  | 'canvass:view'
  | 'canvass:create'
  | 'canvass:edit'
  | 'canvass:delete'
  | 'canvass:import'
  | 'canvass:export'
  // Leads
  | 'leads:view'
  | 'leads:create'
  | 'leads:edit'
  | 'leads:delete'
  | 'leads:assign'
  | 'leads:view_inbound'
  | 'leads:manage_inbound'
  | 'leads:claim_inbound'
  // Campaigns
  | 'campaigns:view'
  | 'campaigns:create'
  | 'campaigns:edit'
  | 'campaigns:delete'
  | 'campaigns:view_reports'
  // Lead Sources
  | 'lead_sources:view'
  | 'lead_sources:manage'
  // Opportunities
  | 'opportunities:view'
  | 'opportunities:edit'
  | 'opportunities:delete'
  // Proposals
  | 'proposals:view'
  | 'proposals:create'
  | 'proposals:edit'
  | 'proposals:send'
  // Contracts
  | 'contracts:view'
  | 'contracts:create'
  | 'contracts:send'
  // Projects
  | 'projects:view'
  | 'projects:edit'
  | 'projects:delete'
  | 'projects:complete'
  // Reports
  | 'reports:view_own'
  | 'reports:view_team'
  | 'reports:view_region'
  | 'reports:view_all'
  | 'reports:export'
  | 'reports:create'
  // Teams
  | 'teams:view'
  | 'teams:create'
  | 'teams:edit'
  | 'teams:delete'
  | 'teams:manage_members'
  | 'teams:manage' // Legacy alias
  // Regions
  | 'regions:view'
  | 'regions:create'
  | 'regions:edit'
  | 'regions:delete'
  | 'regions:manage' // Legacy alias
  // Users
  | 'users:view'
  | 'users:create'
  | 'users:edit'
  | 'users:edit_roles'
  | 'users:deactivate'
  | 'users:manage_team'
  | 'users:manage_region'
  | 'users:manage_all'
  // Scheduling
  | 'scheduling:view'
  | 'scheduling:create'
  | 'scheduling:edit'
  | 'scheduling:manage_team'
  | 'scheduling:manage_region'
  | 'scheduling:manage_queue'
  // Pricebook
  | 'pricebook:view'
  | 'pricebook:edit'
  // Admin
  | 'admin:access'
  | 'admin:roles'
  | 'admin:permissions'
  | 'admin:settings'
  | 'admin:full'

// Keep legacy type alias for backward compatibility
export type Permission = PermissionName

// Role hierarchy - higher index = more permissions (legacy roles)
const roleHierarchy: UserRole[] = [
  'canvasser',
  'setter',
  'rep',
  'sales_rep',
  'operations',
  'setter_manager',
  'sales_manager',
  'regional_setter_manager',
  'regional_manager',
  'admin',
  'owner',
  'custom'
]

// Hierarchy levels for legacy roles
export const legacyRoleHierarchyLevels: Record<UserRole, number> = {
  canvasser: 10,
  setter: 20,
  rep: 30,
  sales_rep: 30,
  operations: 40,
  setter_manager: 50,
  sales_manager: 60,
  regional_setter_manager: 70,
  regional_manager: 80,
  admin: 90,
  owner: 100,
  custom: 30, // Default to rep level for custom roles
}

// Permission matrix by role (legacy - for backward compatibility)
const rolePermissions: Record<UserRole, Permission[]> = {
  admin: [
    'admin:full',
    'canvass:view', 'canvass:create', 'canvass:edit',
    'leads:view', 'leads:create', 'leads:edit',
    'opportunities:view', 'opportunities:edit',
    'proposals:view', 'proposals:edit',
    'contracts:view', 'contracts:send',
    'projects:view', 'projects:edit',
    'reports:view_own', 'reports:view_team', 'reports:view_region', 'reports:view_all', 'reports:export',
    'teams:view', 'teams:manage',
    'regions:view', 'regions:manage',
    'users:view', 'users:manage_team', 'users:manage_region', 'users:manage_all',
    'pricebook:view', 'pricebook:edit',
    'scheduling:view', 'scheduling:manage_team', 'scheduling:manage_region',
  ],
  
  regional_manager: [
    'canvass:view',
    'leads:view',
    'opportunities:view', 'opportunities:edit',
    'proposals:view', 'proposals:edit',
    'contracts:view', 'contracts:send',
    'projects:view', 'projects:edit',
    'reports:view_own', 'reports:view_team', 'reports:view_region', 'reports:export',
    'teams:view', 'teams:manage',
    'regions:view', 'regions:manage',
    'users:view', 'users:manage_team', 'users:manage_region',
    'pricebook:view',
    'scheduling:view', 'scheduling:manage_team', 'scheduling:manage_region',
  ],
  
  sales_manager: [
    'canvass:view',
    'leads:view',
    'opportunities:view', 'opportunities:edit',
    'proposals:view', 'proposals:edit',
    'contracts:view', 'contracts:send',
    'projects:view',
    'reports:view_own', 'reports:view_team', 'reports:export',
    'teams:view', 'teams:manage',
    'users:view', 'users:manage_team',
    'pricebook:view',
    'scheduling:view', 'scheduling:manage_team',
  ],
  
  sales_rep: [
    'canvass:view',
    'leads:view',
    'opportunities:view', 'opportunities:edit',
    'proposals:view', 'proposals:edit',
    'contracts:view', 'contracts:send',
    'projects:view',
    'reports:view_own',
    'teams:view',
    'users:view',
    'pricebook:view',
    'scheduling:view',
  ],

  rep: [
    'canvass:view',
    'leads:view',
    'opportunities:view', 'opportunities:edit',
    'proposals:view', 'proposals:edit',
    'contracts:view', 'contracts:send',
    'projects:view',
    'reports:view_own',
    'teams:view',
    'users:view',
    'pricebook:view',
    'scheduling:view',
  ],
  
  canvasser: [
    'canvass:view', 'canvass:create', 'canvass:edit',
    'leads:view', 'leads:create', 'leads:edit',
    'opportunities:view',
    'reports:view_own',
    'teams:view',
    'users:view',
    'scheduling:view',
  ],
  
  operations: [
    'canvass:view',
    'leads:view',
    'opportunities:view', 'opportunities:edit',
    'proposals:view',
    'contracts:view',
    'projects:view', 'projects:edit',
    'reports:view_own', 'reports:view_all', 'reports:export',
    'teams:view',
    'users:view',
    'pricebook:view',
    'scheduling:view',
  ],
  
  // New roles
  owner: [
    'admin:full',
    'canvass:view', 'canvass:create', 'canvass:edit',
    'leads:view', 'leads:create', 'leads:edit',
    'opportunities:view', 'opportunities:edit',
    'proposals:view', 'proposals:edit',
    'contracts:view', 'contracts:send',
    'projects:view', 'projects:edit',
    'reports:view_own', 'reports:view_team', 'reports:view_region', 'reports:view_all', 'reports:export',
    'teams:view', 'teams:manage',
    'regions:view', 'regions:manage',
    'users:view', 'users:manage_team', 'users:manage_region', 'users:manage_all',
    'pricebook:view', 'pricebook:edit',
    'scheduling:view', 'scheduling:manage_team', 'scheduling:manage_region',
  ],
  
  regional_setter_manager: [
    'canvass:view', 'canvass:create', 'canvass:edit',
    'leads:view', 'leads:create', 'leads:edit',
    'opportunities:view',
    'reports:view_own', 'reports:view_team', 'reports:view_region', 'reports:export',
    'teams:view', 'teams:manage',
    'regions:view',
    'users:view', 'users:manage_team', 'users:manage_region',
    'scheduling:view', 'scheduling:manage_team', 'scheduling:manage_region',
  ],
  
  setter_manager: [
    'canvass:view', 'canvass:create', 'canvass:edit',
    'leads:view', 'leads:create', 'leads:edit',
    'opportunities:view',
    'reports:view_own', 'reports:view_team', 'reports:export',
    'teams:view', 'teams:manage',
    'users:view', 'users:manage_team',
    'scheduling:view', 'scheduling:manage_team',
  ],
  
  setter: [
    'canvass:view', 'canvass:create', 'canvass:edit',
    'leads:view', 'leads:create', 'leads:edit',
    'opportunities:view',
    'reports:view_own',
    'teams:view',
    'users:view',
    'scheduling:view',
  ],
  
  custom: [
    // Custom roles get minimal permissions by default
    // Actual permissions should be defined via custom_roles table
    'canvass:view',
    'leads:view',
    'opportunities:view',
    'reports:view_own',
    'teams:view',
    'users:view',
    'scheduling:view',
  ],
}

/** Roles that may access the Production Job Board (`/ops`) and job detail routes under `/ops/jobs/*`. */
const JOB_BOARD_ACCESS_ROLES = new Set(['admin', 'operations', 'owner'])

/**
 * Whether the user may open the job board and ops job detail pages (server + nav should match).
 */
export function canAccessJobBoard(role: string | null | undefined): boolean {
  if (!role) return false
  return JOB_BOARD_ACCESS_ROLES.has(String(role).toLowerCase())
}

/**
 * Custom role slugs from default org hierarchy (034) that are operations / production-facing,
 * not sales reps — they do not need the in-app “how load roof works” blurbs on `/tools/roof-measure`.
 */
const ROOF_MEASURE_DRAWING_HINTS_SUPPRESSED_CUSTOM_ROLE_SLUGS = new Set([
  'regional_operations',
  'operations_manager',
  'operations',
  'field_operations',
])

function looksLikeProductionRepCustomRole(slug: string, display: string): boolean {
  const normalized = `${slug} ${display}`.toLowerCase().replace(/[\s_-]+/g, ' ').trim()
  if (!normalized.includes('production')) return false
  return (
    normalized.includes(' rep') ||
    normalized.endsWith(' rep') ||
    normalized.includes('representative')
  )
}

/**
 * Whether to show helper text under “Load roof (Google Solar)” and “AI trace roof” on the roof measure tool.
 * Hidden for legacy `operations` users and operations-team custom roles (including “Production Rep”-style labels).
 */
export function shouldShowRoofMeasureDrawingHintsForUser(args: {
  role?: string | null
  customRoleName?: string | null
  customRoleDisplayName?: string | null
}): boolean {
  const baseRole = String(args.role || '').toLowerCase()
  if (baseRole === 'operations') return false

  const slug = String(args.customRoleName || '').toLowerCase()
  const display = String(args.customRoleDisplayName || '').toLowerCase()

  if (ROOF_MEASURE_DRAWING_HINTS_SUPPRESSED_CUSTOM_ROLE_SLUGS.has(slug)) return false
  if (looksLikeProductionRepCustomRole(slug, display)) return false

  return true
}

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  // Owner and Admin have all permissions (normalize casing from DB / imports)
  const r = String(role || '').toLowerCase() as UserRole
  if (r === 'admin' || r === 'owner') return true

  return rolePermissions[r]?.includes(permission) ?? false
}

/**
 * Check if a role has any of the specified permissions
 */
export function hasAnyPermission(role: UserRole, permissions: Permission[]): boolean {
  return permissions.some(p => hasPermission(role, p))
}

/**
 * Check if a role has all of the specified permissions
 */
export function hasAllPermissions(role: UserRole, permissions: Permission[]): boolean {
  return permissions.every(p => hasPermission(role, p))
}

/**
 * Get all permissions for a role
 */
export function getPermissions(role: UserRole): Permission[] {
  return rolePermissions[role] || []
}

/**
 * Check if roleA is higher or equal in hierarchy than roleB
 */
export function isRoleHigherOrEqual(roleA: UserRole, roleB: UserRole): boolean {
  const indexA = roleHierarchy.indexOf(roleA)
  const indexB = roleHierarchy.indexOf(roleB)
  return indexA >= indexB
}

/**
 * Check if user can view reports for a specific scope
 */
export function canViewReports(role: UserRole, scope: 'own' | 'team' | 'region' | 'all'): boolean {
  switch (scope) {
    case 'own':
      return hasPermission(role, 'reports:view_own')
    case 'team':
      return hasPermission(role, 'reports:view_team')
    case 'region':
      return hasPermission(role, 'reports:view_region')
    case 'all':
      return hasPermission(role, 'reports:view_all')
    default:
      return false
  }
}

/**
 * Check if user can manage users at a specific scope
 */
export function canManageUsers(role: UserRole, scope: 'team' | 'region' | 'all'): boolean {
  switch (scope) {
    case 'team':
      return hasPermission(role, 'users:manage_team')
    case 'region':
      return hasPermission(role, 'users:manage_region')
    case 'all':
      return hasPermission(role, 'users:manage_all')
    default:
      return false
  }
}

/**
 * Get the report scope a user can access
 */
export function getReportScope(role: UserRole): 'own' | 'team' | 'region' | 'all' {
  if (hasPermission(role, 'reports:view_all')) return 'all'
  if (hasPermission(role, 'reports:view_region')) return 'region'
  if (hasPermission(role, 'reports:view_team')) return 'team'
  return 'own'
}

/**
 * Role display names
 */
export const roleDisplayNames: Record<UserRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  regional_manager: 'Regional Manager',
  regional_setter_manager: 'Regional Setter Manager',
  sales_manager: 'Sales Manager',
  setter_manager: 'Setter Manager',
  sales_rep: 'Sales Rep',
  setter: 'Setter',
  rep: 'Rep',
  canvasser: 'Canvasser',
  operations: 'Operations',
  custom: 'Custom',
}

/**
 * Get display name for a role
 */
export function getRoleDisplayName(role: UserRole): string {
  return roleDisplayNames[role] || role
}

/**
 * Feature access checks - convenience functions for common checks
 */
export const can = {
  // Canvassing
  viewCanvass: (role: UserRole) => hasPermission(role, 'canvass:view'),
  editCanvass: (role: UserRole) => hasPermission(role, 'canvass:edit'),
  createCanvass: (role: UserRole) => hasPermission(role, 'canvass:create'),
  
  // Leads
  viewLeads: (role: UserRole) => hasPermission(role, 'leads:view'),
  editLeads: (role: UserRole) => hasPermission(role, 'leads:edit'),
  createLeads: (role: UserRole) => hasPermission(role, 'leads:create'),
  
  // Opportunities
  viewOpportunities: (role: UserRole) => hasPermission(role, 'opportunities:view'),
  editOpportunities: (role: UserRole) => hasPermission(role, 'opportunities:edit'),
  
  // Proposals & Contracts
  viewProposals: (role: UserRole) => hasPermission(role, 'proposals:view'),
  editProposals: (role: UserRole) => hasPermission(role, 'proposals:edit'),
  viewContracts: (role: UserRole) => hasPermission(role, 'contracts:view'),
  sendContracts: (role: UserRole) => hasPermission(role, 'contracts:send'),
  
  // Projects
  viewProjects: (role: UserRole) => hasPermission(role, 'projects:view'),
  editProjects: (role: UserRole) => hasPermission(role, 'projects:edit'),
  
  // Teams & Regions
  viewTeams: (role: UserRole) => hasPermission(role, 'teams:view'),
  manageTeams: (role: UserRole) => hasPermission(role, 'teams:manage'),
  viewRegions: (role: UserRole) => hasPermission(role, 'regions:view'),
  manageRegions: (role: UserRole) => hasPermission(role, 'regions:manage'),
  
  // Pricebook
  viewPricebook: (role: UserRole) => hasPermission(role, 'pricebook:view'),
  editPricebook: (role: UserRole) => hasPermission(role, 'pricebook:edit'),
  
  // Reports
  exportReports: (role: UserRole) => hasPermission(role, 'reports:export'),
  
  // Scheduling
  viewScheduling: (role: UserRole) => hasPermission(role, 'scheduling:view'),
  manageTeamScheduling: (role: UserRole) => hasPermission(role, 'scheduling:manage_team'),
  manageRegionScheduling: (role: UserRole) => hasPermission(role, 'scheduling:manage_region'),
  
  // Admin
  isAdmin: (role: UserRole) => role === 'admin',
}

// ============================================
// Dynamic Role Permission System
// ============================================

/**
 * Check if a user with a custom role has a specific permission
 */
export function userHasPermission(
  user: UserWithCustomRole | null | undefined,
  permission: PermissionName
): boolean {
  if (!user) return false

  // If user has a custom role, check its permissions
  if (user.custom_role) {
    // Check for admin:full permission (grants all)
    const hasFullAdmin = user.custom_role.permissions.some(p => p.name === 'admin:full')
    if (hasFullAdmin) return true

    // Check for the specific permission
    return user.custom_role.permissions.some(p => p.name === permission)
  }

  // Fall back to legacy role-based check
  return hasPermission(user.role as UserRole, permission)
}

/**
 * Check if a user has any of the specified permissions
 */
export function userHasAnyPermission(
  user: UserWithCustomRole | null | undefined,
  permissions: PermissionName[]
): boolean {
  return permissions.some(p => userHasPermission(user, p))
}

/**
 * Check if a user has all of the specified permissions
 */
export function userHasAllPermissions(
  user: UserWithCustomRole | null | undefined,
  permissions: PermissionName[]
): boolean {
  return permissions.every(p => userHasPermission(user, p))
}

/**
 * Get the hierarchy level for a user (custom role or legacy)
 */
export function getUserHierarchyLevel(user: UserWithCustomRole | null | undefined): number {
  if (!user) return 0

  // If user has a custom role, use its hierarchy level
  if (user.custom_role) {
    return user.custom_role.hierarchy_level
  }

  // Fall back to legacy role hierarchy
  return legacyRoleHierarchyLevels[user.role as UserRole] || 0
}

/**
 * Check if userA can manage userB based on hierarchy
 */
export function canManageUser(
  manager: UserWithCustomRole | null | undefined,
  target: UserWithCustomRole | null | undefined
): boolean {
  if (!manager || !target) return false
  return getUserHierarchyLevel(manager) > getUserHierarchyLevel(target)
}

/**
 * Get the display name for a user's role (custom or legacy)
 */
export function getUserRoleDisplayName(user: UserWithCustomRole | null | undefined): string {
  if (!user) return 'Unknown'

  if (user.custom_role) {
    return user.custom_role.display_name
  }

  return getRoleDisplayName(user.role as UserRole)
}

/**
 * Get all permissions for a user (custom role or legacy)
 */
export function getUserPermissions(user: UserWithCustomRole | null | undefined): PermissionName[] {
  if (!user) return []

  if (user.custom_role) {
    return user.custom_role.permissions.map(p => p.name as PermissionName)
  }

  return getPermissions(user.role as UserRole)
}

/**
 * Get the report scope a user can access (custom role aware)
 */
export function getUserReportScope(user: UserWithCustomRole | null | undefined): 'own' | 'team' | 'region' | 'all' {
  if (userHasPermission(user, 'reports:view_all')) return 'all'
  if (userHasPermission(user, 'reports:view_region')) return 'region'
  if (userHasPermission(user, 'reports:view_team')) return 'team'
  return 'own'
}

/** Permission names that allow reassigning appointments (legacy matrix + custom-role grants). */
const APPOINTMENT_REASSIGN_CUSTOM_PERMISSIONS = [
  'admin:full',
  'scheduling:edit',
  'scheduling:manage_team',
  'scheduling:manage_region',
] as const satisfies readonly PermissionName[]

/** Legacy role matrix: team/region scheduling managers may reassign. */
export function hasLegacyReassignSchedulingPermission(role: UserRole): boolean {
  return hasPermission(role, 'scheduling:manage_team') || hasPermission(role, 'scheduling:manage_region')
}

function customPermissionNamesAllowAppointmentReassign(permNames: Set<string>): boolean {
  return APPOINTMENT_REASSIGN_CUSTOM_PERMISSIONS.some((name) => permNames.has(name))
}

type ProfileWithNestedCustomRole = {
  custom_role?: {
    permissions?: Array<{ name?: string }>
    role_permissions?: Array<{ permission?: { name?: string } | null }>
  } | null
}

function extractCustomPermissionNamesFromProfile(profile: ProfileWithNestedCustomRole): Set<string> {
  const customRole = Array.isArray(profile?.custom_role) ? profile.custom_role[0] : profile?.custom_role
  if (!customRole) return new Set()
  if (Array.isArray(customRole.permissions) && customRole.permissions.length > 0) {
    return new Set(
      customRole.permissions.map((p: { name?: string }) => p?.name).filter(Boolean) as string[]
    )
  }
  const rolePermissions = Array.isArray(customRole.role_permissions) ? customRole.role_permissions : []
  return new Set(
    rolePermissions
      .map((rp: { permission?: { name?: string } | null }) => rp?.permission?.name)
      .filter(Boolean) as string[]
  )
}

/**
 * Whether the user may reassign appointments (team/region scheduling managers, or custom role with scheduling grants).
 * Accepts client-loaded profiles with nested `custom_role.role_permissions` or typed `UserWithCustomRole`.
 */
export function canReassignAppointmentsFromProfile(profile: unknown): boolean {
  if (!profile || typeof profile !== 'object') return false
  const p = profile as { role?: string } & ProfileWithNestedCustomRole
  const role = (p.role || '') as UserRole
  if (hasLegacyReassignSchedulingPermission(role)) {
    return true
  }
  const permNames = extractCustomPermissionNamesFromProfile(p)
  return customPermissionNamesAllowAppointmentReassign(permNames)
}

/**
 * Calendar "All Team Members" loads org-wide scheduled_appointments (not only the current user).
 * Aligns with reassignment + scheduling coordination: managers, operations, queue admins, etc.
 */
export function canViewOrgWideScheduledAppointments(profile: unknown): boolean {
  if (!profile || typeof profile !== 'object') return false
  const p = profile as { role?: string } & ProfileWithNestedCustomRole
  const roleNorm = String(p.role || '').toLowerCase()

  if (canReassignAppointmentsFromProfile(profile)) return true
  if (roleNorm === 'operations') return true

  const permNames = extractCustomPermissionNamesFromProfile(p)
  if (permNames.has('scheduling:manage_queue')) return true

  // Explicit org-wide calendar (matches deriveCalendarAccess tiers when custom_role load fails)
  if (['admin', 'owner'].includes(roleNorm)) return true
  if (
    ['regional_manager', 'regional_setter_manager', 'sales_manager', 'setter_manager'].includes(roleNorm)
  ) {
    return true
  }

  return false
}

/** Calendar UI tiers (team / regional / admin) for filters and Team lane scope. */
export type CalendarAccessLevel = 'none' | 'team' | 'regional' | 'admin'

/**
 * Which scheduling "lane" the user belongs to (legacy role + custom_role permissions).
 * Used by the calendar page and should match server-side profile loads with nested `custom_role.role_permissions`.
 */
export function deriveCalendarAccess(profile: unknown): CalendarAccessLevel {
  if (!profile || typeof profile !== 'object') return 'none'
  const p = profile as { role?: string } & ProfileWithNestedCustomRole
  const role = String(p.role || '').toLowerCase()
  const customRole = Array.isArray(p.custom_role) ? p.custom_role[0] : p.custom_role
  const rolePermissions = Array.isArray(customRole?.role_permissions) ? customRole.role_permissions : []
  const customPermissionNames = new Set(
    rolePermissions
      .map((rp: { permission?: { name?: string } | null }) => rp?.permission?.name)
      .filter(Boolean) as string[]
  )

  const hasAdminAccess =
    // Current roles
    ['admin', 'owner'].includes(role) ||
    // Legacy role names used in older DB environments
    ['manager', 'admin_owner'].includes(role) ||
    customPermissionNames.has('admin:full')
  if (hasAdminAccess) return 'admin'

  if (role === 'operations' || customPermissionNames.has('scheduling:manage_queue')) return 'admin'

  const hasRegionalAccess =
    ['regional_manager', 'regional_setter_manager'].includes(role) ||
    customPermissionNames.has('scheduling:manage_region')
  if (hasRegionalAccess) return 'regional'

  const hasTeamAccess =
    ['sales_manager', 'setter_manager'].includes(role) || customPermissionNames.has('scheduling:manage_team')
  if (hasTeamAccess) return 'team'

  return 'none'
}

/**
 * Server-side: resolve reassign permission using legacy role matrix plus `role_permissions` when `custom_role_id` is set.
 */
export async function resolveCanReassignAppointment(
  adminClient: SupabaseClient,
  profile: { role: string; custom_role_id?: string | null }
): Promise<boolean> {
  const role = profile.role as UserRole
  if (hasLegacyReassignSchedulingPermission(role)) {
    return true
  }
  if (!profile.custom_role_id) return false

  const { data: rolePerms } = await adminClient
    .from('role_permissions')
    .select('permission:permissions(name)')
    .eq('role_id', profile.custom_role_id)

  const rows = (rolePerms ?? []) as Array<{ permission?: { name?: string } | { name?: string }[] | null }>
  const permNames = new Set<string>()
  for (const rp of rows) {
    const perm = rp.permission
    const name = Array.isArray(perm) ? perm[0]?.name : perm?.name
    if (name) permNames.add(name)
  }
  return customPermissionNamesAllowAppointmentReassign(permNames)
}

// ============================================
// Permission Categories and Metadata
// ============================================

export const permissionCategories = [
  'Canvassing',
  'Leads',
  'Opportunities',
  'Proposals',
  'Contracts',
  'Projects',
  'Reports',
  'Teams',
  'Regions',
  'Users',
  'Scheduling',
  'Pricebook',
  'Admin',
] as const

export type PermissionCategory = typeof permissionCategories[number]

// All available permissions with metadata
export const allPermissions: Array<{
  name: PermissionName
  displayName: string
  description: string
  category: PermissionCategory
}> = [
  // Canvassing
  { name: 'canvass:view', displayName: 'View Canvass Map', description: 'Access the canvassing map interface', category: 'Canvassing' },
  { name: 'canvass:create', displayName: 'Create Canvass Pins', description: 'Drop new pins on the canvass map', category: 'Canvassing' },
  { name: 'canvass:edit', displayName: 'Edit Canvass Pins', description: 'Modify existing canvass pins', category: 'Canvassing' },
  { name: 'canvass:delete', displayName: 'Delete Canvass Pins', description: 'Remove canvass pins', category: 'Canvassing' },
  { name: 'canvass:import', displayName: 'Import Leads CSV', description: 'Bulk import leads from CSV', category: 'Canvassing' },
  { name: 'canvass:export', displayName: 'Export Leads CSV', description: 'Export leads to CSV', category: 'Canvassing' },
  
  // Leads
  { name: 'leads:view', displayName: 'View Leads', description: 'Access lead records', category: 'Leads' },
  { name: 'leads:create', displayName: 'Create Leads', description: 'Create new lead records', category: 'Leads' },
  { name: 'leads:edit', displayName: 'Edit Leads', description: 'Modify lead information', category: 'Leads' },
  { name: 'leads:delete', displayName: 'Delete Leads', description: 'Remove lead records', category: 'Leads' },
  { name: 'leads:assign', displayName: 'Assign Leads', description: 'Assign leads to other users', category: 'Leads' },
  
  // Opportunities
  { name: 'opportunities:view', displayName: 'View Opportunities', description: 'Access opportunity records', category: 'Opportunities' },
  { name: 'opportunities:edit', displayName: 'Edit Opportunities', description: 'Modify opportunity information', category: 'Opportunities' },
  { name: 'opportunities:delete', displayName: 'Delete Opportunities', description: 'Remove opportunity records', category: 'Opportunities' },
  
  // Proposals
  { name: 'proposals:view', displayName: 'View Proposals', description: 'Access proposal documents', category: 'Proposals' },
  { name: 'proposals:create', displayName: 'Create Proposals', description: 'Generate new proposals', category: 'Proposals' },
  { name: 'proposals:edit', displayName: 'Edit Proposals', description: 'Modify proposal content', category: 'Proposals' },
  { name: 'proposals:send', displayName: 'Send Proposals', description: 'Send proposals to customers', category: 'Proposals' },
  
  // Contracts
  { name: 'contracts:view', displayName: 'View Contracts', description: 'Access contract documents', category: 'Contracts' },
  { name: 'contracts:create', displayName: 'Create Contracts', description: 'Generate new contracts', category: 'Contracts' },
  { name: 'contracts:send', displayName: 'Send Contracts', description: 'Send contracts for signature', category: 'Contracts' },
  
  // Projects
  { name: 'projects:view', displayName: 'View Projects', description: 'Access project records', category: 'Projects' },
  { name: 'projects:edit', displayName: 'Edit Projects', description: 'Modify project information', category: 'Projects' },
  { name: 'projects:delete', displayName: 'Delete Projects', description: 'Remove project records', category: 'Projects' },
  { name: 'projects:complete', displayName: 'Complete Projects', description: 'Mark projects as complete', category: 'Projects' },
  
  // Reports
  { name: 'reports:view_own', displayName: 'View Own Reports', description: 'See personal performance metrics', category: 'Reports' },
  { name: 'reports:view_team', displayName: 'View Team Reports', description: 'See team performance metrics', category: 'Reports' },
  { name: 'reports:view_region', displayName: 'View Region Reports', description: 'See regional performance metrics', category: 'Reports' },
  { name: 'reports:view_all', displayName: 'View All Reports', description: 'See organization-wide metrics', category: 'Reports' },
  { name: 'reports:export', displayName: 'Export Reports', description: 'Download reports as Excel/CSV', category: 'Reports' },
  { name: 'reports:create', displayName: 'Create Custom Reports', description: 'Build custom report templates', category: 'Reports' },
  
  // Teams
  { name: 'teams:view', displayName: 'View Teams', description: 'See team information', category: 'Teams' },
  { name: 'teams:create', displayName: 'Create Teams', description: 'Create new teams', category: 'Teams' },
  { name: 'teams:edit', displayName: 'Edit Teams', description: 'Modify team settings', category: 'Teams' },
  { name: 'teams:delete', displayName: 'Delete Teams', description: 'Remove teams', category: 'Teams' },
  { name: 'teams:manage_members', displayName: 'Manage Team Members', description: 'Add/remove team members', category: 'Teams' },
  
  // Regions
  { name: 'regions:view', displayName: 'View Regions', description: 'See region information', category: 'Regions' },
  { name: 'regions:create', displayName: 'Create Regions', description: 'Create new regions', category: 'Regions' },
  { name: 'regions:edit', displayName: 'Edit Regions', description: 'Modify region settings', category: 'Regions' },
  { name: 'regions:delete', displayName: 'Delete Regions', description: 'Remove regions', category: 'Regions' },
  
  // Users
  { name: 'users:view', displayName: 'View Users', description: 'See user profiles', category: 'Users' },
  { name: 'users:create', displayName: 'Create Users', description: 'Add new user accounts', category: 'Users' },
  { name: 'users:edit', displayName: 'Edit Users', description: 'Modify user information', category: 'Users' },
  { name: 'users:edit_roles', displayName: 'Edit User Roles', description: 'Change user role assignments', category: 'Users' },
  { name: 'users:deactivate', displayName: 'Deactivate Users', description: 'Disable user accounts', category: 'Users' },
  { name: 'users:manage_team', displayName: 'Manage Team Users', description: 'Manage users in own team', category: 'Users' },
  { name: 'users:manage_region', displayName: 'Manage Region Users', description: 'Manage users in own region', category: 'Users' },
  { name: 'users:manage_all', displayName: 'Manage All Users', description: 'Full user management access', category: 'Users' },
  
  // Scheduling
  { name: 'scheduling:view', displayName: 'View Schedule', description: 'See appointment calendar', category: 'Scheduling' },
  { name: 'scheduling:create', displayName: 'Create Appointments', description: 'Schedule new appointments', category: 'Scheduling' },
  { name: 'scheduling:edit', displayName: 'Edit Appointments', description: 'Modify appointments', category: 'Scheduling' },
  { name: 'scheduling:manage_team', displayName: 'Manage Team Schedule', description: 'Configure team scheduling', category: 'Scheduling' },
  { name: 'scheduling:manage_region', displayName: 'Manage Region Schedule', description: 'Configure regional scheduling', category: 'Scheduling' },
  { name: 'scheduling:manage_queue', displayName: 'Manage Closer Queue', description: 'Configure round-robin queue', category: 'Scheduling' },
  
  // Pricebook
  { name: 'pricebook:view', displayName: 'View Pricebook', description: 'Access pricing information', category: 'Pricebook' },
  { name: 'pricebook:edit', displayName: 'Edit Pricebook', description: 'Modify pricing and items', category: 'Pricebook' },
  
  // Admin
  { name: 'admin:access', displayName: 'Access Admin Panel', description: 'Enter admin settings area', category: 'Admin' },
  { name: 'admin:roles', displayName: 'Manage Roles', description: 'Create and edit roles', category: 'Admin' },
  { name: 'admin:permissions', displayName: 'Manage Permissions', description: 'Assign permissions to roles', category: 'Admin' },
  { name: 'admin:settings', displayName: 'Manage Settings', description: 'Configure system settings', category: 'Admin' },
  { name: 'admin:full', displayName: 'Full Admin Access', description: 'Complete administrative control', category: 'Admin' },
]

/**
 * Get permissions grouped by category
 */
export function getPermissionsByCategory(): Record<PermissionCategory, typeof allPermissions> {
  const grouped = {} as Record<PermissionCategory, typeof allPermissions>
  
  for (const category of permissionCategories) {
    grouped[category] = allPermissions.filter(p => p.category === category)
  }
  
  return grouped
}
