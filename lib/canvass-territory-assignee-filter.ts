/**
 * Canvass work areas are for sales-side field users only.
 * Exclude Admin → Users “Ops” dashboard, the operations role, and deactivated users
 * (`users.active = false`) — a departed rep must not be offered or assigned a work area.
 */
export function isCanvassTerritoryAssigneeEligible(u: {
  dashboard_view?: string | null
  role?: string | null
  active?: boolean | null
}): boolean {
  if (u.active === false) return false
  if (u.dashboard_view === 'ops') return false
  if (u.role === 'operations') return false
  return true
}
