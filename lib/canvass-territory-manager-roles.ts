/** Same roles enforced by /api/admin/canvass-territories — who may draw work areas and assign reps/teams. */
export const CANVASS_TERRITORY_MANAGER_ROLES = [
  'owner',
  'admin',
  'regional_manager',
  'regional_setter_manager',
  'sales_manager',
  'setter_manager',
  'operations',
] as const

export type CanvassTerritoryManagerRole = (typeof CANVASS_TERRITORY_MANAGER_ROLES)[number]

export function canManageCanvassTerritories(role: string | null | undefined): boolean {
  if (!role) return false
  return (CANVASS_TERRITORY_MANAGER_ROLES as readonly string[]).includes(role)
}
