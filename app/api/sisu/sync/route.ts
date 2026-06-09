import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { formatReward } from '@/lib/incentive-metrics'
import type { SpiffProgram, SpiffTriggerMetric } from '@/lib/types/incentive'

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

function getAdminClient() {
  return createSupabaseAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

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
  admin: ReturnType<typeof getAdminClient>,
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

  if (completedOnly) {
    query = query.eq('status', 'completed')
  }

  const { count, error } = await query
  if (error) throw new Error(error.message)
  return count ?? 0
}

async function countDoorsKnocked(
  admin: ReturnType<typeof getAdminClient>,
  userId: string,
  orgId: string,
  startsAt: string,
  endsAt: string,
) {
  const { count, error } = await admin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('owner_user_id', userId)
    .in('source', DOOR_KNOCK_SOURCES)
    .gte('created_at', startsAt)
    .lte('created_at', endsAt)

  if (error) throw new Error(error.message)
  return count ?? 0
}

async function getAttributedContracts(
  admin: ReturnType<typeof getAdminClient>,
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
  admin: ReturnType<typeof getAdminClient>,
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

    const admin = getAdminClient()

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

    if (activeSpiffs.length === 0) {
      return NextResponse.json([] satisfies SyncResult[])
    }

    const spiffIds = activeSpiffs.map((spiff) => spiff.id)
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

    const updated: SyncResult[] = []

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

      const { data: achievement, error: upsertError } = await admin
        .from('spiff_achievements')
        .upsert(
          {
            org_id: userProfile.org_id,
            spiff_program_id: spiff.id,
            user_id: userId,
            current_value: currentValue,
            qualified,
            qualified_at: qualifiedAt,
            payout_amount: newlyQualified ? spiff.reward_amount : undefined,
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

      if (newlyQualified) {
        const reward = formatReward(spiff)
        const { error: notificationError } = await admin.from('notifications').insert({
          org_id: userProfile.org_id,
          recipient_user_id: userId,
          actor_user_id: userId,
          type: 'sisu_heat_qualified',
          title: 'You hit it.',
          body: `You qualified for ${spiff.name}. ${reward}`,
        })

        if (notificationError) {
          return NextResponse.json({ error: notificationError.message }, { status: 500 })
        }
      }

      updated.push({
        spiff_program_id: String(achievement.spiff_program_id),
        current_value: toNumber(achievement.current_value),
        qualified: Boolean(achievement.qualified),
        qualified_at: achievement.qualified_at ? String(achievement.qualified_at) : null,
      })
    }

    return NextResponse.json(updated)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
