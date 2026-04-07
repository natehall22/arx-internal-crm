/**
 * Roles that behave as “setter lane” on the sales dashboard: IC setters/canvassers
 * plus setter managers (still expected to canvass some).
 *
 * Excludes `regional_setter_manager` — they do not canvass; team/region rollups belong elsewhere.
 */
export function isSetterLikeRole(role?: string | null): boolean {
  return role === 'canvasser' || role === 'setter' || role === 'setter_manager'
}
