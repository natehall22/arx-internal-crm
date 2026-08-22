import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { formatReward } from '@/lib/incentive-metrics'
import { countDoorsKnockedForBadgeAward } from '@/lib/sisu-weekly-doors'
import { countClosedSalesForBadgeAward } from '@/lib/sisu-monthly-closed-sales'
import { syncOrgEnrollments } from '@/lib/sync-444-core'
import { INSPECTION_SET_APPOINTMENT_TYPE_OR } from '@/lib/inspection-set-metrics'
import type { SpiffProgram, SpiffTriggerMetric } from '@/lib/types/incentive'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type SyncRequestBody = {
  userId?: unknown
  user_id?: unknown
}

type UserProfile = {
  id: string
  org_id: string
  role: string
}

type ExistingAchievement = {
  id: string
  spiff_program_id: string
  current_value: number | string
  qualified: boolean
  qualified_at: string | null
}

type SyncResult = {
  spiff_program_id: string
  current_value: number
  qualified: boolean
  qualified_at: string | null
}

type EarnedBadgeRow = {
  badge_id: string
}

type OrgBadgeRow = {
  id: string
  name: string
  criteria_type: string
  criteria_value: number | string | null
  is_active: boolean
}

type OpportunityRelation = {
  owner_user_id: string | null
  setter_user_id: string | null
}

type ContractMetricRow = {
  id: string
  opportunity_id: string | null
  project_cost: number | string | null
  scope_roof_repair: boolean | null
  scope_gutters: boolean | null
  scope_siding: boolean | null
  scope_other: string | null
  opportunities: OpportunityRelation | OpportunityRelation[] | null
}

const DOOR_KNOCK_SOURCES = ['door_to_door', 'canvass', 'door_knock']

function requestedUserId(body: SyncRequestBody): string | null {
  if (typeof body.userId === 'string') return body.userId
  if (typeof body.user_id === 'string') return body.user_id
  return null
}

function relationIncludesUser(
  relation: OpportunityRelation | OpportunityRelation[] | null,
  userId: string,
) {
  const opportunity = Array.isArray(relation) ? relation[0] : relation
  return opportunity?.owner_user_id === userId || opportunity?.setter_user_id === userId
}

function isEligibleHeat(spiff: SpiffProgram, profile: UserProfile) {
  return (
    spiff.org_id === profile.org_id &&
    (spiff.eligible_roles.length === 0 || spiff.eligible_roles.includes(profile.role))
  )
}

function hasAttachedUpgrade(contract: ContractMetricRow) {
  return (
    contract.scope_roof_repair === true ||
    contract.scope_gutters === true ||
    contract.scope_siding === true ||
    Boolean(contract.scope_other?.trim())
  )
}

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function uniqueOpportunityCount(contracts: ContractMetricRow[]) {
  return new Set(
    contracts
      .map((contract) => contract.opportunity_id)
      .filter((opportunityId): opportunityId is string => typeof opportunityId === 'string'),
  ).size
}

async function countInspections(
  admin: ReturnType<typeof createServiceClient>,
  userId: string,
  orgId: string,
  startsAt: string,
  endsAt: string,
  completedOnly: boolean,
) {
  let query = admin
    .from('scheduled_appointments')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('canvasser_user_id', userId)
    .gte('created_at', startsAt)
    .lte('created_at', endsAt)
    .or(INSPECTION_SET_APPOINTMENT_TYPE_OR)

  if (completedOnly) {
    query = query.eq('status', 'completed')
  } else {
    query = query.neq('status', 'cancelled')
  }

  const { count, error } = await query
  if (error) throw new Error(error.message)
  return count ?? 0
}

async function countDoorsKnocked(
  admin: ReturnType<typeof createServiceClient>,
  userId: string,
  orgId: string,
  startsAt: string,
  endsAt: string,
) {
  // Match dashboard attribution: pin_attributed_user_id takes precedence over owner_user_id
  const { count, error } = await admin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .or(`pin_attributed_user_id.eq.${userId},and(pin_attributed_user_id.is.null,owner_user_id.eq.${userId})`)
    .in('source', DOOR_KNOCK_SOURCES)
    .gte('created_at', startsAt)
    .lte('created_at', endsAt)

  if (error) throw new Error(error.message)
  return count ?? 0
}

async function getAttributedContracts(
  admin: ReturnType<typeof createServiceClient>,
  userId: string,
  orgId: string,
  startsAt: string,
  endsAt: string,
) {
  const { data, error } = await admin
    .from('order_form_contracts')
    .select(
      [
        'id',
        'opportunity_id',
        'project_cost',
        'scope_roof_repair',
        'scope_gutters',
        'scope_siding',
        'scope_other',
        'opportunities(owner_user_id, setter_user_id)',
      ].join(', '),
    )
    .eq('org_id', orgId)
    .eq('status', 'completed')
    .in('agreement_type', ['installation', 'repair']) // exclude contingency — matches dashboard SALE_AGREEMENT_TYPES
    .not('customer_signed_at', 'is', null)
    .gte('customer_signed_at', startsAt)
    .lte('customer_signed_at', endsAt)

  if (error) throw new Error(error.message)

  const rows = (data ?? []) as unknown as ContractMetricRow[]
  return rows.filter((contract) =>
    relationIncludesUser(contract.opportunities, userId),
  )
}

async function computeCurrentValue(
  admin: ReturnType<typeof createServiceClient>,
  metric: SpiffTriggerMetric,
  userId: string,
  orgId: string,
  startsAt: string,
  endsAt: string,
) {
  if (metric === 'inspections_set') {
    return countInspections(admin, userId, orgId, startsAt, endsAt, false)
  }

  if (metric === 'inspections_sat') {
    return countInspections(admin, userId, orgId, startsAt, endsAt, true)
  }

  if (metric === 'doors_knocked') {
    return countDoorsKnocked(admin, userId, orgId, startsAt, endsAt)
  }

  const contracts = await getAttributedContracts(admin, userId, orgId, startsAt, endsAt)

  if (metric === 'closed_sales') {
    return uniqueOpportunityCount(contracts)
  }

  if (metric === 'closed_revenue') {
    return contracts.reduce((sum, contract) => sum + toNumber(contract.project_cost), 0)
  }

  if (metric === 'upgrade_attached') {
    return contracts.filter(hasAttachedUpgrade).length
  }

  const inspectionsSat = await countInspections(admin, userId, orgId, startsAt, endsAt, true)
  if (inspectionsSat < 1) return 0

  const closedSales = uniqueOpportunityCount(contracts)
  return (closedSales / inspectionsSat) * 100
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rawBody = (await request.json().catch(() => ({}))) as SyncRequestBody
    const bodyUserId = requestedUserId(rawBody)
    const userId = bodyUserId ?? user.id

    if (userId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const admin = createServiceClient()

    const { data: profile, error: profileError } = await admin
      .from('users')
      .select('id, org_id, role')
      .eq('id', userId)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const userProfile = profile as UserProfile
    const nowIso = new Date().toISOString()

    const { data: spiffRows, error: spiffError } = await admin
      .from('spiff_programs')
      .select('*')
      .eq('org_id', userProfile.org_id)
      .eq('status', 'active')
      .lte('starts_at', nowIso)
      .gte('ends_at', nowIso)

    if (spiffError) {
      return NextResponse.json({ error: spiffError.message }, { status: 500 })
    }

    const activeSpiffs = ((spiffRows ?? []) as SpiffProgram[]).filter((spiff) =>
      isEligibleHeat(spiff, userProfile),
    )

    const spiffIds = activeSpiffs.map((spiff) => spiff.id)

    const updated: SyncResult[] = []

    if (spiffIds.length > 0) {
      const { data: existingRows, error: existingError } = await admin
        .from('spiff_achievements')
        .select('id, spiff_program_id, current_value, qualified, qualified_at')
        .eq('user_id', userId)
        .in('spiff_program_id', spiffIds)

      if (existingError) {
        return NextResponse.json({ error: existingError.message }, { status: 500 })
      }

      const existingBySpiff = new Map(
        ((existingRows ?? []) as ExistingAchievement[]).map((row) => [row.spiff_program_id, row]),
      )

      for (const spiff of activeSpiffs) {
        const currentValue = await computeCurrentValue(
          admin,
          spiff.trigger_metric,
          userId,
          userProfile.org_id,
          spiff.starts_at,
          spiff.ends_at,
        )
        const existing = existingBySpiff.get(spiff.id)
        const previouslyQualified = existing?.qualified === true
        const newlyQualified = currentValue >= toNumber(spiff.threshold) && !previouslyQualified
        const qualified = previouslyQualified || newlyQualified
        const qualifiedAt = newlyQualified ? nowIso : existing?.qualified_at ?? null

        // Upsert progress metrics — preserve qualified/qualified_at as-is (don't upgrade here)
        const { data: achievement, error: upsertError } = await admin
          .from('spiff_achievements')
          .upsert(
            {
              org_id: userProfile.org_id,
              spiff_program_id: spiff.id,
              user_id: userId,
              current_value: currentValue,
              qualified: previouslyQualified,
              qualified_at: existing?.qualified_at ?? null,
            },
            { onConflict: 'spiff_program_id,user_id' },
          )
          .select('spiff_program_id, current_value, qualified, qualified_at')
          .single()

        if (upsertError || !achievement) {
          return NextResponse.json(
            { error: upsertError?.message ?? 'Failed to update Heat progress' },
            { status: 500 },
          )
        }

        // Atomic qualification flip — only the sync that actually flips qualified
        // false → true sends the notification (prevents duplicate notifications in
        // concurrent syncs that both read qualified=false before either writes)
        let didQualify = false
        if (newlyQualified) {
          const { data: flipRows, error: flipError } = await admin
            .from('spiff_achievements')
            .update({ qualified: true, qualified_at: nowIso, payout_amount: spiff.reward_amount })
            .eq('spiff_program_id', spiff.id)
            .eq('user_id', userId)
            .eq('qualified', false) // optimistic lock
            .select('id')

          if (flipError) {
            return NextResponse.json({ error: flipError.message }, { status: 500 })
          }
          didQualify = (flipRows?.length ?? 0) > 0
        }

        if (didQualify) {
          const reward = formatReward(spiff)
          // Notification is best-effort — don't 500 on notification failure
          const { error: notificationError } = await admin.from('notifications').insert({
            org_id: userProfile.org_id,
            recipient_user_id: userId,
            actor_user_id: userId,
            type: 'sisu_heat_qualified',
            title: 'You hit it.',
            body: `You qualified for ${spiff.name}. ${reward}`,
          })
          if (notificationError) {
            console.error('[sisu/sync] Failed to insert heat-qualified notification:', notificationError)
          } else {
            // Only push when the in-app notification row landed (keeps channels consistent).
            const { sendPushToUserBackground } = await import('@/lib/push-apns')
            sendPushToUserBackground(
              userId,
              'You hit it.',
              `You qualified for ${spiff.name}. ${reward}`,
              { type: 'spiff' }
            )
          }
        }

        updated.push({
          spiff_program_id: String(achievement.spiff_program_id),
          current_value: toNumber(achievement.current_value),
          qualified: previouslyQualified || didQualify,
          qualified_at: didQualify ? nowIso : (achievement.qualified_at ? String(achievement.qualified_at) : null),
        })
      }
    }

    // ── Auto-award first-event badges ─────────────────────────────────────────
    // Fetch all active org badges for criteria types handled here
    const { data: orgBadgeRows, error: orgBadgeError } = await admin
      .from('incentive_badges')
      .select('id, name, criteria_type, criteria_value, is_active')
      .eq('org_id', userProfile.org_id)
      .eq('is_active', true)
      .in('criteria_type', [
        'first_inspection_set',
        'first_closed_sale',
        'doors_knocked_milestone',
        'closed_sales_milestone',
      ])

    if (orgBadgeError) {
      // Non-fatal: log and continue so spiff results are still returned
      console.error('[sisu/sync] badge fetch error:', orgBadgeError.message)
      return NextResponse.json(updated)
    }

    const eligibleBadges = (orgBadgeRows ?? []) as OrgBadgeRow[]

    if (eligibleBadges.length > 0) {
      // Fetch already-earned badges for this user
      const { data: earnedRows, error: earnedError } = await admin
        .from('user_badges')
        .select('badge_id')
        .eq('user_id', userId)
        .in(
          'badge_id',
          eligibleBadges.map((b) => b.id),
        )

      if (earnedError) {
        console.error('[sisu/sync] earned badge fetch error:', earnedError.message)
        return NextResponse.json(updated)
      }

      const earnedBadgeIds = new Set(
        ((earnedRows ?? []) as EarnedBadgeRow[]).map((r) => r.badge_id),
      )

      const unearnedBadges = eligibleBadges.filter((b) => !earnedBadgeIds.has(b.id))

      if (unearnedBadges.length > 0) {
        // Check first_inspection_set condition once (all-time, no date filter)
        let hasEverSetInspection: boolean | null = null
        const needsInspectionCheck = unearnedBadges.some(
          (b) => b.criteria_type === 'first_inspection_set',
        )
        if (needsInspectionCheck) {
          const { count, error: inspErr } = await admin
            .from('scheduled_appointments')
            .select('id', { count: 'exact', head: true })
            .eq('org_id', userProfile.org_id)
            .eq('canvasser_user_id', userId)
            .or(INSPECTION_SET_APPOINTMENT_TYPE_OR)
            .neq('status', 'cancelled')
          hasEverSetInspection = inspErr ? null : (count ?? 0) > 0
        }

        // Check first_closed_sale condition once (all-time, no date filter)
        let hasEverClosedSale: boolean | null = null
        const needsSaleCheck = unearnedBadges.some(
          (b) => b.criteria_type === 'first_closed_sale',
        )
        if (needsSaleCheck) {
          const { data: saleData, error: saleErr } = await admin
            .from('order_form_contracts')
            .select('id, opportunities!inner(owner_user_id, setter_user_id)')
            .eq('org_id', userProfile.org_id)
            .eq('status', 'completed')
            .in('agreement_type', ['installation', 'repair'])
            .not('customer_signed_at', 'is', null)
            .or(`owner_user_id.eq.${userId},setter_user_id.eq.${userId}`, {
              foreignTable: 'opportunities',
            })
            .limit(1)
          hasEverClosedSale = saleErr ? null : (saleData ?? []).length > 0
        }

        let weeklyDoorsKnocked: number | null = null
        const needsWeeklyDoorsCheck = unearnedBadges.some(
          (b) => b.criteria_type === 'doors_knocked_milestone',
        )
        if (needsWeeklyDoorsCheck) {
          try {
            weeklyDoorsKnocked = await countDoorsKnockedForBadgeAward(
              admin,
              userProfile.org_id,
              userId,
            )
          } catch (doorsErr) {
            console.error('[sisu/sync] weekly doors count error:', doorsErr)
            weeklyDoorsKnocked = null
          }
        }

        let monthlyClosedSales: number | null = null
        const needsMonthlySalesCheck = unearnedBadges.some(
          (b) => b.criteria_type === 'closed_sales_milestone',
        )
        if (needsMonthlySalesCheck) {
          try {
            monthlyClosedSales = await countClosedSalesForBadgeAward(
              admin,
              userProfile.org_id,
              userId,
            )
          } catch (salesErr) {
            console.error('[sisu/sync] monthly closed sales count error:', salesErr)
            monthlyClosedSales = null
          }
        }

        for (const badge of unearnedBadges) {
          let conditionMet = false

          if (badge.criteria_type === 'first_inspection_set') {
            conditionMet = hasEverSetInspection === true
          } else if (badge.criteria_type === 'first_closed_sale') {
            conditionMet = hasEverClosedSale === true
          } else if (badge.criteria_type === 'doors_knocked_milestone') {
            const threshold = toNumber(badge.criteria_value)
            conditionMet =
              weeklyDoorsKnocked !== null && threshold > 0 && weeklyDoorsKnocked >= threshold
          } else if (badge.criteria_type === 'closed_sales_milestone') {
            const threshold = toNumber(badge.criteria_value)
            conditionMet =
              monthlyClosedSales !== null && threshold > 0 && monthlyClosedSales >= threshold
          }

          if (!conditionMet) continue

          const { error: insertBadgeError } = await admin.from('user_badges').insert({
            org_id: userProfile.org_id,
            user_id: userId,
            badge_id: badge.id,
            awarded_by: null,
          })

          if (insertBadgeError) {
            // Duplicate key = already exists (race), skip silently
            if (!insertBadgeError.message.includes('duplicate')) {
              console.error('[sisu/sync] badge insert error:', insertBadgeError.message)
            }
            continue
          }

          const { error: badgeNotifError } = await admin.from('notifications').insert({
            org_id: userProfile.org_id,
            recipient_user_id: userId,
            actor_user_id: userId,
            type: 'sisu_badge_earned',
            title: 'Badge earned.',
            body: `You earned the ${badge.name} badge.`,
          })
          if (badgeNotifError) {
            console.error('[sisu/sync] badge notification error:', badgeNotifError.message)
          }
        }
      }
    }

    // ── 444 Program: finalize THIS rep's own enrollment ───────────────────────
    // Recompute the rep's 444 door/inspection counts and, if they've crossed
    // 400/4, register qualification + the pending bonus line + notification.
    // Scoped to this user (userId) and reusing the exact optimistic-locked,
    // per-period-deduped logic the cron uses — so a rep simply viewing their page
    // finalizes their own bonus even when the org-wide cron isn't running. The
    // bonus line lands as 'pending_approval', so an admin still signs it off.
    // Best-effort: a 444 failure must never break the spiff/badge sync response.
    try {
      await syncOrgEnrollments(admin, userProfile.org_id, userId, { userId })
    } catch (sync444Error) {
      console.error(
        '[sisu/sync] 444 enrollment sync failed:',
        sync444Error instanceof Error ? sync444Error.message : sync444Error,
      )
    }

    return NextResponse.json(updated)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
