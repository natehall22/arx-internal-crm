/**
 * Top KPI strip on /dashboard ("Welcome back…") uses personal-stats API.
 * - Management roles: full org rollup for the user's org (same as empty scope in dashboard RPCs).
 * - Individual contributors: metrics scoped to that user only (team drill-down is below).
 */
export function isDashboardPersonalKpiOrgWide(role: string | null | undefined): boolean {
  const r = role ?? ''
  return (
    r === 'admin' ||
    r === 'owner' ||
    r === 'regional_manager' ||
    r === 'regional_setter_manager' ||
    r === 'sales_manager' ||
    r === 'setter_manager' ||
    r === 'manager'
  )
}
