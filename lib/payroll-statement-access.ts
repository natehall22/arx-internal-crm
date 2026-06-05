import type { SupabaseClient } from '@supabase/supabase-js'
import type { User, UserRole } from '@/lib/types/database'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { legacyRoleHierarchyLevels } from '@/lib/permissions'

const MANAGER_STATEMENT_MIN_LEVEL = 50

function managerHierarchyLevel(role: string | null | undefined): number {
  if (!role) return 0
  return legacyRoleHierarchyLevels[role as UserRole] ?? 0
}

export function canUseManagerStatementView(role: string | null | undefined): boolean {
  return managerHierarchyLevel(role) >= MANAGER_STATEMENT_MIN_LEVEL
}

/**
 * Walk `manager_user_id` chain from target up; true if viewer is an ancestor manager.
 */
export async function isUserInManagerHierarchy(
  supabase: SupabaseClient,
  orgId: string,
  managerId: string,
  targetUserId: string
): Promise<boolean> {
  if (managerId === targetUserId) return true
  let currentId = targetUserId
  const visited = new Set<string>()
  for (let depth = 0; depth < 24; depth++) {
    const { data, error } = await supabase
      .from('users')
      .select('manager_user_id')
      .eq('id', currentId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (error || !data?.manager_user_id) return false
    const parentId = data.manager_user_id as string
    if (parentId === managerId) return true
    if (visited.has(parentId)) return false
    visited.add(parentId)
    currentId = parentId
  }
  return false
}

export async function canViewPayrollStatement(
  supabase: SupabaseClient,
  viewer: Pick<User, 'id' | 'org_id' | 'role'>,
  targetUserId: string
): Promise<boolean> {
  if (viewer.id === targetUserId) return true
  if (isPayrollAdminRole(viewer.role)) return true
  if (!canUseManagerStatementView(viewer.role)) return false
  return isUserInManagerHierarchy(supabase, viewer.org_id, viewer.id, targetUserId)
}

/**
 * Resolve which user's statement may be loaded. Reps may only ever request themselves,
 * even if they tamper with ?user_id= on the statement URL from email links.
 */
export function resolvePayrollStatementTargetUserId(
  viewer: Pick<User, 'id' | 'role'>,
  requestedUserId: string | null | undefined
): { userId: string; viewingOtherUser: boolean } | { error: 'forbidden' } {
  const trimmed = requestedUserId?.trim()
  if (!trimmed || trimmed === viewer.id) {
    return { userId: viewer.id, viewingOtherUser: false }
  }
  if (!isPayrollAdminRole(viewer.role) && !canUseManagerStatementView(viewer.role)) {
    return { error: 'forbidden' }
  }
  return { userId: trimmed, viewingOtherUser: true }
}
