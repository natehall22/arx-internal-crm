import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { getDateRangeForTimeFrame } from '@/lib/date-ranges'
import { getEasternTodayIso } from '@/lib/eastern-datetime'
import { INSPECTION_SET_APPOINTMENT_TYPE_OR } from '@/lib/inspection-set-metrics'
import { isCanvassDoorLead } from '@/lib/sales-metrics'
import { getAttributedCanvassLeadUserId } from '@/lib/canvass-lead-attribution'
import { countClosedSalesInRange } from '@/lib/sisu-monthly-closed-sales'
import type {
  Heat,
  HeatAchievement,
  HeatWithProgress,
  UserIncentiveGoal,
} from '@/lib/incentive-metrics'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const TIMEZONE = 'America/New_York'

type UserProfile = {
  id: string
  org_id: string
  role: string
}

type IncentivesResponse = {
  liveMetrics: {
    inspectionsSet: number
    doorsKnocked: number
    closedSales: number
  }
  goal: UserIncentiveGoal | null
  activeSpiffs: HeatWithProgress[]
  asOf: string
}

/**
 * Rep-facing SPIFFs + incentive goal + this-week live metrics for the current
 * user only. Mirrors the data app/sisu/page.tsx server-renders for the web
 * Sisu page (spiffs + goal + week-to-date counts), exposed as JSON so the iOS
 * app can render the same "Active SPIFFs" and "Incentive Goals" sections.
 * Always scoped to the authenticated caller — there is no userId param, unlike
 * /api/sisu/badges, since a rep can only ever see their own SPIFF progress and
 * goal targets here (admins manage other reps' goals via /api/admin/sisu/goals).
 */
export async function GET() {
  try {
    let authContext: Awaited<ReturnType<typeof requireAuthApi>>
    try {
      authContext = await requireAuthApi()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createServiceClient()
    const profile: UserProfile = {
      id: authContext.authUser.id,
      org_id: authContext.profile.org_id,
      role: authContext.profile.role,
    }

    const { start: weekStart, end: weekEnd } = getDateRangeForTimeFrame('week', TIMEZONE)
    const today = getEasternTodayIso(TIMEZONE)
    const nowIso = new Date().toISOString()

    // ── Live metrics (this week) ──────────────────────────────────────────────
    const { data: weekAppointments, error: apptError } = await admin
      .from('scheduled_appointments')
      .select('id, canvasser_user_id')
      .eq('org_id', profile.org_id)
      .eq('canvasser_user_id', profile.id)
      .gte('created_at', weekStart.toISOString())
      .lt('created_at', weekEnd.toISOString())
      .or(INSPECTION_SET_APPOINTMENT_TYPE_OR)
      .neq('status', 'cancelled')

    if (apptError) {
      return NextResponse.json({ error: apptError.message }, { status: 500 })
    }
    const inspectionsSet = weekAppointments?.length ?? 0

    const { data: doorLeads, error: doorError } = await admin
      .from('leads')
      .select('id, source, canvass_disposition, pin_attributed_user_id, owner_user_id')
      .eq('org_id', profile.org_id)
      .gte('created_at', weekStart.toISOString())
      .lt('created_at', weekEnd.toISOString())

    if (doorError) {
      return NextResponse.json({ error: doorError.message }, { status: 500 })
    }
    const doorsKnocked = (doorLeads ?? []).filter(
      (l) => isCanvassDoorLead(l) && getAttributedCanvassLeadUserId(l) === profile.id,
    ).length

    let closedSales = 0
    try {
      closedSales = await countClosedSalesInRange(admin, profile.org_id, profile.id, {
        start: weekStart,
        end: weekEnd,
      })
    } catch (salesError) {
      const message = salesError instanceof Error ? salesError.message : 'Failed to count closed sales'
      return NextResponse.json({ error: message }, { status: 500 })
    }

    // ── Current incentive goal ────────────────────────────────────────────────
    const { data: goalRows, error: goalError } = await admin
      .from('user_incentive_goals')
      .select(
        'id, weekly_doors_target, weekly_inspections_target, weekly_sales_target, weekly_revenue_target, effective_from, effective_to',
      )
      .eq('user_id', profile.id)
      .eq('org_id', profile.org_id)
      .lte('effective_from', today)
      .or(`effective_to.is.null,effective_to.gte.${today}`)
      .order('effective_from', { ascending: false })
      .limit(1)

    if (goalError) {
      return NextResponse.json({ error: goalError.message }, { status: 500 })
    }
    const goal = (goalRows?.[0] ?? null) as UserIncentiveGoal | null

    // ── Active SPIFFs ─────────────────────────────────────────────────────────
    const { data: spiffRows, error: spiffError } = await admin
      .from('spiff_programs')
      .select(
        'id, org_id, name, description, trigger_metric, threshold, reward_type, reward_amount, reward_note, eligible_roles, starts_at, ends_at, status',
      )
      .eq('org_id', profile.org_id)
      .eq('status', 'active')
      .lte('starts_at', nowIso)
      .gte('ends_at', nowIso)
      .order('ends_at', { ascending: true })

    if (spiffError) {
      return NextResponse.json({ error: spiffError.message }, { status: 500 })
    }

    const spiffs = (spiffRows ?? []) as Heat[]
    const eligibleSpiffs = spiffs.filter(
      (s) => s.eligible_roles.length === 0 || s.eligible_roles.includes(profile.role),
    )

    const spiffIds = eligibleSpiffs.map((s) => s.id)
    const achievementMap = new Map<string, HeatAchievement>()

    if (spiffIds.length > 0) {
      const { data: achievementRows, error: achError } = await admin
        .from('spiff_achievements')
        .select(
          'id, spiff_program_id, user_id, current_value, qualified, qualified_at, payout_amount, payroll_period_id',
        )
        .eq('user_id', profile.id)
        .in('spiff_program_id', spiffIds)

      if (achError) {
        return NextResponse.json({ error: achError.message }, { status: 500 })
      }

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
      const { data: periodRows } = await admin
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

    return NextResponse.json({
      liveMetrics: { inspectionsSet, doorsKnocked, closedSales },
      goal,
      activeSpiffs,
      asOf: nowIso,
    } satisfies IncentivesResponse)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
