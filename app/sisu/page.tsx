export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchEnrollmentCounts } from '@/lib/sync-444-core'
import Nav from '@/components/Nav'
import IncentivesClient from './IncentivesClient'
import { getDateRangeForTimeFrame } from '@/lib/date-ranges'
import {
  countClosedSalesForBadgeAward,
  countUserClosedSalesFromRows,
} from '@/lib/sisu-monthly-closed-sales'
import { countDoorsKnockedForBadgeAward } from '@/lib/sisu-weekly-doors'
import { isSetterLikeRole } from '@/lib/dashboard-setter-role'
import { SALE_AGREEMENT_TYPES, isCanvassDoorLead } from '@/lib/sales-metrics'
import { getAttributedCanvassLeadUserId } from '@/lib/canvass-lead-attribution'
import type {
  SpiffProgram,
  SpiffAchievement,
  SpiffWithProgress,
  UserIncentiveGoal,
  IncentiveBadge,
  UserBadge,
  BadgeWithEarned,
  LiveMetrics,
} from '@/lib/incentive-metrics'
import type { InstallationSaleContractRow } from '@/lib/sales-metrics'

export default async function IncentivesPage() {
  const { profile } = await requireAuth()
  const supabase = createClient()

  const { start: weekStart, end: weekEnd } = getDateRangeForTimeFrame('week', 'America/New_York')
  // Use ET so goal effective dates match the company's business timezone
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) // YYYY-MM-DD in ET

  const metricsAsOf = new Date().toISOString()

  // ── Live metrics ─────────────────────────────────────────────────────────────

  // Inspections set this week (canvasser_user_id is source of truth)
  const { data: weekAppointments } = await supabase
    .from('scheduled_appointments')
    .select('id, canvasser_user_id')
    .eq('org_id', profile.org_id)
    .eq('canvasser_user_id', profile.id)
    .gte('created_at', weekStart.toISOString())
    .lt('created_at', weekEnd.toISOString())

  const inspectionsSet = weekAppointments?.length ?? 0

  // Doors knocked this week
  const { data: doorLeads } = await supabase
    .from('leads')
    .select('id, source, canvass_disposition, pin_attributed_user_id, owner_user_id')
    .eq('org_id', profile.org_id)
    .gte('created_at', weekStart.toISOString())
    .lt('created_at', weekEnd.toISOString())

  const doorsKnocked = (doorLeads ?? []).filter(
    (l) => isCanvassDoorLead(l) && getAttributedCanvassLeadUserId(l) === profile.id
  ).length

  // Closed sales this week
  const { data: salesContracts } = await supabase
    .from('order_form_contracts')
    .select('id, opportunity_id, customer_signed_at, opportunities(owner_user_id, setter_user_id)')
    .eq('org_id', profile.org_id)
    .in('agreement_type', SALE_AGREEMENT_TYPES)
    .eq('status', 'completed')
    .not('customer_signed_at', 'is', null)
    .gte('customer_signed_at', weekStart.toISOString())
    .lt('customer_signed_at', weekEnd.toISOString())

  const closedSales = countUserClosedSalesFromRows(
    salesContracts as InstallationSaleContractRow[] | null,
    profile.id,
  )

  const [closedSalesMonth, doorsKnockedForBadge] = await Promise.all([
    countClosedSalesForBadgeAward(supabase, profile.org_id, profile.id),
    countDoorsKnockedForBadgeAward(supabase, profile.org_id, profile.id),
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

  const spiffs = (spiffRows ?? []) as SpiffProgram[]

  // Filter by eligible_roles: empty array = all roles
  const eligibleSpiffs = spiffs.filter(
    (s) => s.eligible_roles.length === 0 || s.eligible_roles.includes(profile.role)
  )

  // Fetch this user's achievement rows for these spiffs
  const spiffIds = eligibleSpiffs.map((s) => s.id)
  let achievementMap = new Map<string, SpiffAchievement>()

  if (spiffIds.length > 0) {
    const { data: achievementRows } = await supabase
      .from('spiff_achievements')
      .select('id, spiff_program_id, user_id, current_value, qualified, qualified_at, payout_amount, payroll_period_id')
      .eq('user_id', profile.id)
      .in('spiff_program_id', spiffIds)

    for (const row of achievementRows ?? []) {
      achievementMap.set(row.spiff_program_id, row as SpiffAchievement)
    }
  }

  const { data: enrollment444Row } = await supabase
    .from('program_444_enrollments')
    .select(
      'id, week1_starts_at, week1_ends_at, week2_starts_at, week2_ends_at, week1_doors, week1_inspections, week1_qualified, week2_doors, week2_inspections, week2_qualified, status, week1_payroll_period_id, week2_payroll_period_id, updated_at'
    )
    .eq('user_id', profile.id)
    .eq('org_id', profile.org_id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const payrollPeriodIds = new Set<string>()
  for (const ach of Array.from(achievementMap.values())) {
    if (ach.payroll_period_id) payrollPeriodIds.add(ach.payroll_period_id)
  }
  if (enrollment444Row?.week1_payroll_period_id) {
    payrollPeriodIds.add(enrollment444Row.week1_payroll_period_id)
  }
  if (enrollment444Row?.week2_payroll_period_id) {
    payrollPeriodIds.add(enrollment444Row.week2_payroll_period_id)
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

  const activeSpiffs: SpiffWithProgress[] = eligibleSpiffs.map((s) => {
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

  let enrollment444 = enrollment444Row ?? null

  // ── Live progress overlay (DISPLAY ONLY) ───────────────────────────────────
  // The persisted week*_doors / week*_inspections columns only refresh when the
  // sync runs (hourly cron or the rep-triggered /api/sisu/sync). Recompute the
  // rep's CURRENT counts here so they always see live progress on first paint —
  // mirrors the admin 444 page. Read-only: qualified flags, qualified_at, and
  // payroll links stay exactly as persisted (owned by the sync). On any error we
  // keep the persisted counts so the page can never break.
  if (enrollment444) {
    try {
      const service = createServiceClient()
      const liveCounts = await fetchEnrollmentCounts(service, profile.org_id, [
        {
          id: enrollment444.id,
          user_id: profile.id,
          week1_starts_at: enrollment444.week1_starts_at,
          week1_ends_at: enrollment444.week1_ends_at,
          week2_starts_at: enrollment444.week2_starts_at,
          week2_ends_at: enrollment444.week2_ends_at,
        },
      ])
      const live = liveCounts.get(enrollment444.id)
      if (live) {
        // Stamp updated_at to now so the rep's "as of" recency label matches the
        // freshly recomputed counts instead of the older persisted snapshot.
        enrollment444 = { ...enrollment444, ...live, updated_at: new Date().toISOString() }
      }
    } catch (overlayError) {
      console.error(
        '[sisu/page] 444 live count overlay failed; using persisted counts:',
        overlayError instanceof Error ? overlayError.message : overlayError,
      )
    }
  }

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

  // ── Org 444 bonus label (display string — can be cash, merch, or anything) ────
  const { data: orgRow } = await supabase
    .from('orgs')
    .select('program_444_week_bonus_label')
    .eq('id', profile.org_id)
    .maybeSingle()
  const weekBonusLabel: string = orgRow?.program_444_week_bonus_label ?? '$400'

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
        enrollment444={enrollment444}
        approvedBonuses={approvedBonuses}
        weekBonusLabel={weekBonusLabel}
        metricsAsOf={metricsAsOf}
      />
    </div>
  )
}
