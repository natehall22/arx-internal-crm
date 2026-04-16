/**
 * Canvass work areas are for sales-side field users only.
 * Exclude Admin → Users “Ops” dashboard and the operations role.
 */
export function isCanvassTerritoryAssigneeEligible(u: {
  dashboard_view?: string | null
  role?: string | null
}): boolean {
  if (u.dashboard_view === 'ops') return false
  if (u.role === 'operations') return false
  return true
}
