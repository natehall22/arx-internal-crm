import type { SupabaseClient } from '@supabase/supabase-js'
import { roundMoney } from '@/lib/money'
import { isPayrollPeriodEditable, type PayrollPeriodRow } from '@/lib/payroll-period-guards'
import { buildPayrollStatement, type PayrollStatementPayload } from '@/lib/payroll-statement'

export type PayrollDashboardSource =
  | 'payroll_estimate'
  | 'payroll_official'
  | 'legacy_only'
  | 'unavailable'

export type PayrollDashboardEstimate = {
  periodId: string
  periodLabel: string
  scheduledPayDate: string
  cutoffAt: string
  mode: 'estimated'
  netPayout: number
  grossCommission: number
  hourlyEarnings: number
  disclaimer: string
  statementUrl: string
}

export type PayrollDashboardOfficial = {
  periodId: string
  periodLabel: string
  scheduledPayDate: string
  mode: 'final'
  netPayout: number
  disclaimer: string
  statementUrl: string
}

export type PayrollDashboardLegacy = {
  weeklyTotal: number
  weekStart: string
  weekEnd: string
  disclaimer: string
}

export type PayrollDashboardPay = {
  source: PayrollDashboardSource
  /** What the dashboard hero should display */
  primaryLabel: 'estimated' | 'official_last' | 'legacy'
  primaryAmount: number
  estimate: PayrollDashboardEstimate | null
  officialLastLocked: PayrollDashboardOfficial | null
  legacy: PayrollDashboardLegacy
}

export type WeeklyCommissionsApiResponse = {
  /** @deprecated Use payrollDashboard.primaryAmount — kept for legacy clients */
  weeklyTotal: number
  hasCompPlan: boolean
  weekStart: string
  weekEnd: string
  /** Top-level label for widget consumers */
  label: 'payroll_estimate' | 'official_last' | 'legacy_commissions'
  source: 'payroll_estimate' | 'payroll_official' | 'legacy_commissions'
  payrollDashboard: PayrollDashboardPay
}

const ESTIMATE_DISCLAIMER =
  'Estimated pay for the current open payroll period — not official until payroll locks the period.'
const OFFICIAL_DISCLAIMER = 'Last locked pay period — official statement amount.'
const LEGACY_DISCLAIMER =
  'Legacy commission records (calendar week) — may not match payroll statements or emailed pay.'

function formatLocalDateYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function calendarWeekBounds(now = new Date()): { weekStart: string; weekEnd: string } {
  const dayOfWeek = now.getDay()
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - dayOfWeek)
  weekStart.setHours(0, 0, 0, 0)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  return {
    weekStart: formatLocalDateYmd(weekStart),
    weekEnd: formatLocalDateYmd(weekEnd),
  }
}

export function pickPrimaryPayDisplay(input: {
  estimate: { netPayout: number } | null
  officialLast: { netPayout: number } | null
  legacyTotal: number
}): Pick<PayrollDashboardPay, 'source' | 'primaryLabel' | 'primaryAmount'> {
  if (input.estimate) {
    return {
      source: 'payroll_estimate',
      primaryLabel: 'estimated',
      primaryAmount: roundMoney(input.estimate.netPayout),
    }
  }
  if (input.officialLast) {
    return {
      source: 'payroll_official',
      primaryLabel: 'official_last',
      primaryAmount: roundMoney(input.officialLast.netPayout),
    }
  }
  return {
    source: input.legacyTotal > 0 ? 'legacy_only' : 'unavailable',
    primaryLabel: 'legacy',
    primaryAmount: roundMoney(input.legacyTotal),
  }
}

export function statementPathForPeriod(periodId: string): string {
  return `/commissions/statement/${periodId}`
}

function slimEstimateFromStatement(
  statement: PayrollStatementPayload,
  appUrl: string
): PayrollDashboardEstimate {
  const path = statementPathForPeriod(statement.period.id)
  return {
    periodId: statement.period.id,
    periodLabel: statement.period.label,
    scheduledPayDate: statement.period.payDate,
    cutoffAt: statement.period.cutoffAt,
    mode: 'estimated',
    netPayout: roundMoney(statement.totals.netPayout),
    grossCommission: roundMoney(statement.totals.grossCommission),
    hourlyEarnings: roundMoney(statement.totals.hourlyEarnings),
    disclaimer: ESTIMATE_DISCLAIMER,
    statementUrl: appUrl ? `${appUrl.replace(/\/$/, '')}${path}` : path,
  }
}

function slimOfficialFromStatement(
  statement: PayrollStatementPayload,
  appUrl: string
): PayrollDashboardOfficial {
  const path = statementPathForPeriod(statement.period.id)
  return {
    periodId: statement.period.id,
    periodLabel: statement.period.label,
    scheduledPayDate: statement.period.payDate,
    mode: 'final',
    netPayout: roundMoney(statement.totals.netPayout),
    disclaimer: OFFICIAL_DISCLAIMER,
    statementUrl: appUrl ? `${appUrl.replace(/\/$/, '')}${path}` : path,
  }
}

export async function resolveOpenPayrollPeriod(
  supabase: SupabaseClient,
  orgId: string
): Promise<PayrollPeriodRow | null> {
  const { data } = await supabase
    .from('payroll_periods')
    .select('id, status, locked_at, cutoff_at, period_label, scheduled_pay_date')
    .eq('org_id', orgId)
    .eq('status', 'open')
    .is('locked_at', null)
    .order('cutoff_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (data as PayrollPeriodRow) || null
}

export async function resolveLastLockedPayrollPeriod(
  supabase: SupabaseClient,
  orgId: string
): Promise<PayrollPeriodRow | null> {
  const { data } = await supabase
    .from('payroll_periods')
    .select('id, status, locked_at, cutoff_at, period_label, scheduled_pay_date')
    .eq('org_id', orgId)
    .in('status', ['locked', 'paid'])
    .not('locked_at', 'is', null)
    .order('cutoff_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (data as PayrollPeriodRow) || null
}

export async function computeLegacyWeeklyCommissionsTotal(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  weekStart: string,
  weekEnd: string
): Promise<number> {
  const { data: commissions } = await supabase
    .from('commissions')
    .select('total_amount')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .gte('commission_period', weekStart)
    .lte('commission_period', weekEnd)

  return roundMoney(
    commissions?.reduce((sum, c) => sum + (Number(c.total_amount) || 0), 0) ?? 0
  )
}

export async function buildPayrollDashboardPay(input: {
  supabase: SupabaseClient
  orgId: string
  userId: string
  appUrl?: string
  now?: Date
}): Promise<{ dashboard: PayrollDashboardPay; weekStart: string; weekEnd: string }> {
  const { supabase, orgId, userId } = input
  const appUrl = input.appUrl || ''
  const { weekStart, weekEnd } = calendarWeekBounds(input.now)

  const legacyTotal = await computeLegacyWeeklyCommissionsTotal(
    supabase,
    orgId,
    userId,
    weekStart,
    weekEnd
  )

  const legacy: PayrollDashboardLegacy = {
    weeklyTotal: legacyTotal,
    weekStart,
    weekEnd,
    disclaimer: LEGACY_DISCLAIMER,
  }

  let estimate: PayrollDashboardEstimate | null = null
  const openPeriod = await resolveOpenPayrollPeriod(supabase, orgId)
  if (openPeriod && isPayrollPeriodEditable(openPeriod)) {
    const statement = await buildPayrollStatement(supabase, orgId, openPeriod.id, userId)
    if (statement && statement.mode === 'estimated') {
      estimate = slimEstimateFromStatement(statement, appUrl)
    }
  }

  let officialLastLocked: PayrollDashboardOfficial | null = null
  const lockedPeriod = await resolveLastLockedPayrollPeriod(supabase, orgId)
  if (lockedPeriod && lockedPeriod.id !== openPeriod?.id) {
    const statement = await buildPayrollStatement(supabase, orgId, lockedPeriod.id, userId)
    if (statement && statement.mode === 'final') {
      officialLastLocked = slimOfficialFromStatement(statement, appUrl)
    }
  }

  const primary = pickPrimaryPayDisplay({
    estimate,
    officialLast: officialLastLocked,
    legacyTotal,
  })

  const dashboard: PayrollDashboardPay = {
    ...primary,
    estimate,
    officialLastLocked,
    legacy,
  }

  return { dashboard, weekStart, weekEnd }
}

export async function buildWeeklyCommissionsResponse(input: {
  supabase: SupabaseClient
  orgId: string
  userId: string
  hasCompPlan: boolean
  appUrl?: string
}): Promise<WeeklyCommissionsApiResponse> {
  const { dashboard, weekStart, weekEnd } = await buildPayrollDashboardPay(input)

  const label =
    dashboard.primaryLabel === 'estimated'
      ? 'payroll_estimate'
      : dashboard.primaryLabel === 'official_last'
        ? 'official_last'
        : 'legacy_commissions'

  const source =
    dashboard.primaryLabel === 'legacy'
      ? 'legacy_commissions'
      : dashboard.primaryLabel === 'official_last'
        ? 'payroll_official'
        : 'payroll_estimate'

  return {
    weeklyTotal: dashboard.legacy.weeklyTotal,
    hasCompPlan: input.hasCompPlan,
    weekStart,
    weekEnd,
    label,
    source,
    payrollDashboard: dashboard,
  }
}
