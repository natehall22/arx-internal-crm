import type { PayrollDashboardPay } from '@/lib/payroll-dashboard-pay'

export function payrollHeroTitle(dashboard: PayrollDashboardPay): string {
  switch (dashboard.primaryLabel) {
    case 'estimated':
      return 'Estimated pay'
    case 'official_last':
      return 'Last official'
    default:
      return 'Legacy week total'
  }
}

export function payrollHeroDisclaimer(dashboard: PayrollDashboardPay): string {
  if (dashboard.primaryLabel === 'estimated' && dashboard.estimate) {
    return dashboard.estimate.disclaimer
  }
  if (dashboard.primaryLabel === 'official_last' && dashboard.officialLastLocked) {
    return dashboard.officialLastLocked.disclaimer
  }
  return dashboard.legacy.disclaimer
}

/** In-app path for the primary amount (not full URL). */
export function payrollStatementHref(dashboard: PayrollDashboardPay): string {
  if (dashboard.primaryLabel === 'estimated' && dashboard.estimate) {
    return `/commissions/statement/${dashboard.estimate.periodId}`
  }
  if (dashboard.primaryLabel === 'official_last' && dashboard.officialLastLocked) {
    return `/commissions/statement/${dashboard.officialLastLocked.periodId}`
  }
  return '/commissions/statement'
}

export function payrollHeroPeriodHint(dashboard: PayrollDashboardPay): string | null {
  if (dashboard.primaryLabel === 'estimated' && dashboard.estimate) {
    return dashboard.estimate.periodLabel
  }
  if (dashboard.primaryLabel === 'official_last' && dashboard.officialLastLocked) {
    return dashboard.officialLastLocked.periodLabel
  }
  return null
}

export function showPayrollEstimateDisclaimer(dashboard: PayrollDashboardPay): boolean {
  return dashboard.primaryLabel === 'estimated'
}

export function showLegacyFallbackNote(dashboard: PayrollDashboardPay): boolean {
  return (
    dashboard.primaryLabel === 'legacy' &&
    dashboard.legacy.weeklyTotal > 0 &&
    (dashboard.estimate != null || dashboard.officialLastLocked != null)
  )
}
