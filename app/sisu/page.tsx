export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
import IncentivesClient from './IncentivesClient'
import { getDateRangeForTimeFrame } from '@/lib/date-ranges'
import { isSetterLikeRole } from '@/lib/dashboard-setter-role'
import { SALE_AGREEMENT_TYPES, getAttributedInstallationSales, isCanvassDoorLead } from '@/lib/sales-metrics'
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
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

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

  const salesOpportunities = getAttributedInstallationSales(
    salesContracts as InstallationSaleContractRow[] | null
  )
  const closedSales = new Set(
    (salesOpportunities ?? [])
      .filter(
        (o) => o.setter_user_id === profile.id || o.owner_user_id === profile.id
      )
      .map((o) => o.opportunity_id || o.id)
  ).size

  const liveMetrics: LiveMetrics = { inspectionsSet, doorsKnocked, closedSales }

  // ── Current incentive goal ────────────────────────────────────────────────────
  const { data: goalRows } = await supabase
    .from('user_incentive_goals')
    .select(
      'id, weekly_doors_target, weekly_inspections_target, weekly_sales_target, weekly_revenue_target, effective_from, effective_to'
    )
    .eq('user_id', profile.id)
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
      .select('id, spiff_program_id, user_id, current_value, qualified, qualified_at, payout_amount')
      .eq('user_id', profile.id)
      .in('spiff_program_id', spiffIds)

    for (const row of achievementRows ?? []) {
      achievementMap.set(row.spiff_program_id, row as SpiffAchievement)
    }
  }

  const activeSpiffs: SpiffWithProgress[] = eligibleSpiffs.map((s) => {
    const ach = achievementMap.get(s.id)
    return {
      ...s,
      currentValue: ach ? Number(ach.current_value) : 0,
      qualified: ach?.qualified ?? false,
    }
  })

  // ── Badges ────────────────────────────────────────────────────────────────────
  // Fetch all org badges + which ones this user has earned
  const { data: allBadgeRows } = await supabase
    .from('incentive_badges')
    .select(
      'id, org_id, name, description, icon_key, color_hex, criteria_type, criteria_value, is_active, sort_order'
    )
    .eq('org_id', profile.org_id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  const { data: userBadgeRows } = await supabase
    .from('user_badges')
    .select('id, badge_id, awarded_at, note')
    .eq('user_id', profile.id)

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
      />
    </div>
  )
}
