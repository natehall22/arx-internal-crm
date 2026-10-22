export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
import IncentivesClient from './IncentivesClient'
import { getDateRangeForTimeFrame } from '@/lib/date-ranges'
import {
  countClosedSalesForBadgeAward,
} from '@/lib/sisu-monthly-closed-sales'
import { countDoorsKnockedForBadgeAward } from '@/lib/sisu-weekly-doors'
import { isSetterLikeRole } from '@/lib/dashboard-setter-role'
import { countUserDoors, countUserInspectionsSet, countUserSales } from '@/lib/reporting/period-metrics'
import { createServiceClient } from '@/lib/supabase/service'
import type {
  Heat,
  HeatAchievement,
  HeatWithProgress,
  UserIncentiveGoal,
  IncentiveBadge,
  UserBadge,
  BadgeWithEarned,
  LiveMetrics,
} from '@/lib/incentive-metrics'

export default async function IncentivesPage() {
  const { profile } = await requireAuth()
  const supabase = createClient()

  const { start: weekStart, end: weekEnd } = getDateRangeForTimeFrame('week', 'America/New_York')
  // Use ET so goal effective dates match the company's business timezone
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) // YYYY-MM-DD in ET

  const metricsAsOf = new Date().toISOString()

  // ── Live metrics ─────────────────────────────────────────────────────────────

  // This week's inspections set, doors and closed sales — the reporting views, like the dashboard and /reports.
  const admin = createServiceClient()
  const weekRange = { start: weekStart, end: weekEnd }
  const [inspectionsSet, doorsKnocked, closedSales] = await Promise.all([
    countUserInspectionsSet(admin, profile.org_id, profile.id, weekRange),
    countUserDoors(admin, profile.org_id, profile.id, weekRange),
    countUserSales(admin, profile.org_id, profile.id, weekRange),
  ])

  const [closedSalesMonth, doorsKnockedForBadge] = await Promise.all([
    countClosedSalesForBadgeAward(admin, profile.org_id, profile.id),
    countDoorsKnockedForBadgeAward(admin, profile.org_id, profile.id),
  ])

  const liveMetrics: LiveMetrics = {
    inspectionsSet,
    doorsKnocked,
    doorsKnockedForBadge,
    closedSales,
    closedSalesMonth,
  }

  // ── Current incentive goal ────────────────────────────────────────────────────
  const { data: goalRows } = await supabase
    .from('user_incentive_goals')
    .select(
      'id, weekly_doors_target, weekly_inspections_target, weekly_sales_target, weekly_revenue_target, effective_from, effective_to'
    )
    .eq('user_id', profile.id)
    .eq('org_id', profile.org_id)
    .lte('effective_from', today)
    .or(`effective_to.is.null,effective_to.gte.${today}`)
    .order('effective_from', { ascending: false })
    .limit(1)

  const goal = (goalRows?.[0] ?? null) as UserIncentiveGoal | null

  // ── Active SPIFFs ─────────────────────────────────────────────────────────────
  const { data: spiffRows } = await supabase
    .from('spiff_programs')
    .select(
      'id, org_id, name, description, trigger_metric, threshold, reward_type, reward_amount, reward_note, eligible_roles, starts_at, ends_at, status'
    )
    .eq('org_id', profile.org_id)
    .eq('status', 'active')
    .lte('starts_at', new Date().toISOString())
    .gte('ends_at', new Date().toISOString())
    .order('ends_at', { ascending: true })

  const spiffs = (spiffRows ?? []) as Heat[]

  // Filter by eligible_roles: empty array = all roles
  const eligibleSpiffs = spiffs.filter(
    (s) => s.eligible_roles.length === 0 || s.eligible_roles.includes(profile.role)
  )

  // Fetch this user's achievement rows for these spiffs
  const spiffIds = eligibleSpiffs.map((s) => s.id)
  let achievementMap = new Map<string, HeatAchievement>()

  if (spiffIds.length > 0) {
    const { data: achievementRows } = await supabase
      .from('spiff_achievements')
      .select('id, spiff_program_id, user_id, current_value, qualified, qualified_at, payout_amount, payroll_period_id')
      .eq('user_id', profile.id)
      .in('spiff_program_id', spiffIds)

    for (const row of achievementRows ?? []) {
      achievementMap.set(row.spiff_program_id, row as HeatAchievement)
    }
  }

  const payrollPeriodIds = new Set<string>()
  for (const ach of Array.from(achievementMap.values())) {
    if (ach.payroll_period_id) payrollPeriodIds.add(ach.payroll_period_id)
  }

  const payDateByPeriodId = new Map<string, string>()
  if (payrollPeriodIds.size > 0) {
    const { data: periodRows } = await supabase
      .from('payroll_periods')
      .select('id, scheduled_pay_date')
      .in('id', Array.from(payrollPeriodIds))

    for (const period of periodRows ?? []) {
      if (period.scheduled_pay_date) {
        payDateByPeriodId.set(period.id, period.scheduled_pay_date)
      }
    }
  }

  const activeSpiffs: HeatWithProgress[] = eligibleSpiffs.map((s) => {
    const ach = achievementMap.get(s.id)
    const periodId = ach?.payroll_period_id ?? null
    return {
      ...s,
      currentValue: ach ? Number(ach.current_value) : 0,
      qualified: ach?.qualified ?? false,
      payout_amount: ach?.payout_amount != null ? Number(ach.payout_amount) : null,
      payroll_pay_date: periodId ? payDateByPeriodId.get(periodId) ?? null : null,
    }
  })

  // ── Approved/paid bonus lines (rep-visible pay confirmations) ────────────────
  // Pending/rejected are invisible to reps; paid rows stay visible after payroll.
  type ApprovedBonus = {
    id: string
    bonus_type: string
    amount: number
    source_id: string | null
    status: string
    scheduled_pay_date: string | null
  }

  // Supabase returns joined rows as an array when using !fkey syntax; normalize to first element.
  function pickScheduledPayDate(period: unknown): string | null {
    if (!period) return null
    const row = Array.isArray(period) ? period[0] : period
    if (!row || typeof row !== 'object') return null
    const p = row as Record<string, unknown>
    return typeof p.scheduled_pay_date === 'string' ? p.scheduled_pay_date : null
  }

  const { data: approvedBonusRows, error: bonusError } = await supabase
    .from('payroll_bonus_lines')
    .select(`
      id,
      bonus_type,
      amount,
      source_id,
      status,
      period:payroll_periods!payroll_bonus_lines_payroll_period_id_fkey (
        scheduled_pay_date
      )
    `)
    .eq('user_id', profile.id)
    .eq('org_id', profile.org_id)
    .in('status', ['approved', 'paid'])

  if (bonusError) {
    console.error('[sisu/page] Failed to fetch approved bonus lines:', bonusError)
  }

  const approvedBonuses: ApprovedBonus[] = (approvedBonusRows ?? [])
    .filter((row): row is NonNullable<typeof row> => row != null)
    .map((row) => ({
      id: row.id as string,
      bonus_type: row.bonus_type as string,
      amount: Number(row.amount),
      source_id: (row.source_id as string | null) ?? null,
      status: (row.status as string) ?? 'approved',
      scheduled_pay_date: pickScheduledPayDate(row.period),
    }))

  // ── Badges ────────────────────────────────────────────────────────────────────
  // Fetch all org badges + which ones this user has earned
  const { data: allBadgeRows } = await supabase
    .from('incentive_badges')
    .select(
      'id, org_id, name, description, icon_key, color_hex, criteria_type, criteria_value, is_active, sort_order, image_url'
    )
    .eq('org_id', profile.org_id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  const { data: userBadgeRows } = await supabase
    .from('user_badges')
    .select('id, badge_id, awarded_at, note')
    .eq('user_id', profile.id)
    .eq('org_id', profile.org_id)

  const userBadgeMap = new Map<string, UserBadge>(
    (userBadgeRows ?? []).map((ub) => [ub.badge_id, ub as UserBadge])
  )

  const earnedBadges: BadgeWithEarned[] = (allBadgeRows ?? []).map((b) => {
    const ub = userBadgeMap.get(b.id)
    return {
      ...(b as IncentiveBadge),
      earned: !!ub,
      awarded_at: ub?.awarded_at ?? null,
    }
  })

  return (
    <div className="min-h-screen bg-gray-950">
      <Nav />
      <IncentivesClient
        profile={profile}
        liveMetrics={liveMetrics}
        goal={goal}
        activeSpiffs={activeSpiffs}
        earnedBadges={earnedBadges}
        isSetterLike={isSetterLikeRole(profile.role)}
        approvedBonuses={approvedBonuses}
        metricsAsOf={metricsAsOf}
      />
    </div>
  )
}
