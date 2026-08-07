import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ADJUSTER_MEETING_APPOINTMENT_TYPE } from '@/lib/adjuster-meeting'
import {
  mapLatestInspectionByLeadId,
  mapLatestInspectionByOpportunityId,
  withEffectiveInspectionFields,
} from '@/lib/effective-inspection-state'
import {
  type InspectionOutcomeConfigRow,
  getInspectionOutcomeConfig,
  mergeOrgInspectionOutcomesWithDefaults,
  normalizeInspectionOutcomeId,
} from '@/lib/inspection-outcomes'
import {
  canViewInsideSalesFollowUp,
  getInsideSalesQueueState,
  isInsideSalesRoleLike,
} from '@/lib/inside-sales-follow-up'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import {
  getCloseOutcomeConfig,
  normalizeCloseOutcomeRows,
} from '@/lib/close-outcomes'
import {
  comparePriority,
  getQueuePriority,
  getQueueStory,
  type HandoffContext,
} from '@/lib/inside-sales-priority'

export const dynamic = 'force-dynamic'

function getSessionFromRequest(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
  const cookieName = `sb-${projectRef}-auth-token`

  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      const decoded = decodeURIComponent(singleCookie.value)
      return JSON.parse(decoded)
    } catch {
      return null
    }
  }

  const chunks: string[] = []
  let i = 0
  while (true) {
    const chunk = req.cookies.get(`${cookieName}.${i}`)
    if (!chunk?.value) break
    chunks.push(chunk.value)
    i++
  }

  if (chunks.length > 0) {
    try {
      const decoded = decodeURIComponent(chunks.join(''))
      return JSON.parse(decoded)
    } catch {
      return null
    }
  }

  return null
}

function getAuthClient(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const sessionData = getSessionFromRequest(req)

  return {
    client: createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: sessionData?.access_token
        ? { headers: { Authorization: `Bearer ${sessionData.access_token}` } }
        : undefined,
    }),
    accessToken: sessionData?.access_token,
  }
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function getInspectionOutcomeSettings(settings: any): InspectionOutcomeConfigRow[] | null {
  const raw = settings?.inspection_outcomes
  if (Array.isArray(raw)) return raw
  if (Array.isArray(raw?.outcomes)) return raw.outcomes
  return null
}

function getCloseOutcomeSettings(settings: any) {
  const raw = settings?.close_outcomes
  if (Array.isArray(raw)) return raw
  if (Array.isArray(raw?.outcomes)) return raw.outcomes
  return null
}

const BASE_OPPORTUNITY_SELECT_FIELDS = [
  'id',
  'customer_id',
  'lead_id',
  'status',
  'address_text',
  'project_type',
  'inspection_outcome',
  'inspection_outcome_at',
  'inspection_notes',
  'created_at',
  'updated_at',
]

const OPTIONAL_OPPORTUNITY_SELECT_FIELDS = [
  'pipeline_stage',
  'follow_up_at',
  'assigned_user_id',
  'knockback_reason',
  'handoff_context',
]

function isMissingColumnError(error: any) {
  return error?.code === '42703' || String(error?.message || '').includes('does not exist')
}

async function fetchInsideSalesOpportunities(adminClient: ReturnType<typeof getAdminClient>, orgId: string) {
  const optionalFields = [...OPTIONAL_OPPORTUNITY_SELECT_FIELDS]
  let lastError: any = null

  while (true) {
    const selectFields = [...BASE_OPPORTUNITY_SELECT_FIELDS, ...optionalFields].join(',\n        ')
    const { data, error } = await adminClient
      .from('opportunities')
      .select(selectFields)
      .eq('org_id', orgId)
      .neq('status', 'won')
      .neq('status', 'lost')
      .order('created_at', { ascending: false })
      // PostgREST default max rows (~1000) can omit queue items after sort; raise explicitly (bounded).
      .limit(8000)

    if (!error) return { data, error: null }
    lastError = error

    if (!isMissingColumnError(error) || optionalFields.length === 0) {
      return { data: null, error: lastError }
    }

    const missingFieldIndex = optionalFields.findIndex((field) =>
      String(error.message || '').includes(`'${field}'`) ||
      String(error.message || '').includes(`.${field}`) ||
      String(error.message || '').includes(` ${field} `)
    )

    if (missingFieldIndex >= 0) {
      optionalFields.splice(missingFieldIndex, 1)
    } else {
      optionalFields.pop()
    }
  }
}

export async function GET(request: NextRequest) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)

    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = getAdminClient()
    const { data: profile } = await adminClient
      .from('users')
      .select('id, org_id, role, custom_role_id, custom_role:custom_roles(name, display_name)')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const customRole = Array.isArray((profile as any).custom_role)
      ? (profile as any).custom_role[0]
      : (profile as any).custom_role

    const { permissionNames } = await resolveEffectivePermissionNames(adminClient, user.id, {
      role: profile.role,
      custom_role_id: profile.custom_role_id,
    })

    const insideSalesAccessInput = {
      role: profile.role,
      customRoleName: customRole?.name || null,
      customRoleDisplayName: customRole?.display_name || null,
      permissionNames,
    }

    if (!canViewInsideSalesFollowUp(insideSalesAccessInput)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [{ data: opportunities, error: opportunitiesError }, { data: orgRow, error: orgError }] = await Promise.all([
      fetchInsideSalesOpportunities(adminClient, profile.org_id),
      adminClient.from('orgs').select('settings').eq('id', profile.org_id).maybeSingle(),
    ])

    if (opportunitiesError) {
      console.error('Inside sales opportunities fetch error:', opportunitiesError)
      return NextResponse.json(
        { error: `Failed to fetch inside sales opportunities: ${opportunitiesError.message}` },
        { status: 500 }
      )
    }

    if (orgError) {
      console.error('Inside sales org settings fetch error:', orgError)
      return NextResponse.json(
        { error: `Failed to fetch inside sales settings: ${orgError.message}` },
        { status: 500 }
      )
    }

    const inspectionOutcomeSettings = getInspectionOutcomeSettings(orgRow?.settings)
    const inspectionOutcomeRows = mergeOrgInspectionOutcomesWithDefaults(inspectionOutcomeSettings)
    const closeOutcomeRows = normalizeCloseOutcomeRows(getCloseOutcomeSettings(orgRow?.settings))

    const rawOpportunities = (opportunities || []).map((opportunity: any) => ({
      ...opportunity,
      pipeline_stage: opportunity.pipeline_stage ?? null,
      follow_up_at: opportunity.follow_up_at ?? null,
      assigned_user_id: opportunity.assigned_user_id ?? null,
      knockback_reason: opportunity.knockback_reason ?? null,
      handoff_context: opportunity.handoff_context ?? null,
    }))
    const opportunityIds = rawOpportunities.map((opportunity: any) => opportunity.id)
    const leadIds = rawOpportunities.map((opportunity: any) => opportunity.lead_id).filter(Boolean)
    const customerIds = rawOpportunities.map((opportunity: any) => opportunity.customer_id).filter(Boolean)

    const leadMap = new Map<string, any>()
    if (leadIds.length > 0) {
      const { data: leads, error: leadsError } = await adminClient
        .from('leads')
        .select('id, homeowner_name, phone, closer_user_id')
        .in('id', leadIds)

      if (leadsError) {
        console.error('Inside sales leads fetch error:', leadsError)
        return NextResponse.json(
          { error: `Failed to fetch inside sales leads: ${leadsError.message}` },
          { status: 500 }
        )
      }

      for (const lead of leads || []) {
        leadMap.set(lead.id, lead)
      }
    }

    const customerMap = new Map<string, any>()
    if (customerIds.length > 0) {
      const { data: customers, error: customersError } = await adminClient
        .from('customers')
        .select('id, name, phone')
        .in('id', customerIds)

      if (customersError) {
        console.error('Inside sales customers fetch error:', customersError)
        return NextResponse.json(
          { error: `Failed to fetch inside sales customers: ${customersError.message}` },
          { status: 500 }
        )
      }

      for (const customer of customers || []) {
        customerMap.set(customer.id, customer)
      }
    }

    let inspectionMap = new Map<string, { outcome: string; notes: string | null; created_at: string }>()
    if (opportunityIds.length > 0) {
      const { data: inspectionStatuses } = await adminClient
        .from('inspection_status_updates')
        .select('opportunity_id, outcome, notes, created_at')
        .in('opportunity_id', opportunityIds)
        .order('created_at', { ascending: false })

      inspectionMap = mapLatestInspectionByOpportunityId(inspectionStatuses || [])
    }

    let leadInspectionMap = new Map<string, { outcome: string; notes: string | null; created_at: string }>()
    if (leadIds.length > 0) {
      const { data: leadStatuses } = await adminClient
        .from('inspection_status_updates')
        .select('lead_id, outcome, notes, created_at')
        .in('lead_id', leadIds)
        .order('created_at', { ascending: false })

      leadInspectionMap = mapLatestInspectionByLeadId(leadStatuses || [])
    }

    const closeOutcomeMap = new Map<string, { outcome: string; created_at: string }>()
    if (opportunityIds.length > 0) {
      const { data: closeRows } = await adminClient
        .from('close_appointments')
        .select('opportunity_id, outcome, outcome_submitted_at, created_at')
        .in('opportunity_id', opportunityIds)
        .order('outcome_submitted_at', { ascending: false })
        .order('created_at', { ascending: false })

      for (const closeRow of closeRows || []) {
        if (!closeRow.opportunity_id || closeOutcomeMap.has(closeRow.opportunity_id)) continue
        closeOutcomeMap.set(closeRow.opportunity_id, {
          outcome: closeRow.outcome,
          created_at: closeRow.outcome_submitted_at || closeRow.created_at,
        })
      }
    }

    const queueItems = rawOpportunities
      .map((opportunity: any) =>
        withEffectiveInspectionFields(opportunity, inspectionMap, leadInspectionMap)
      )
      .filter((opportunity: any) =>
        getInsideSalesQueueState(opportunity, inspectionOutcomeRows).active
      )
      .map((opportunity: any) => {
        const lead = opportunity.lead_id ? leadMap.get(opportunity.lead_id) : null
        const customer = opportunity.customer_id ? customerMap.get(opportunity.customer_id) : null
        const queueState = getInsideSalesQueueState(opportunity, inspectionOutcomeRows)
        const kind = queueState.kind
        const closeOutcome = closeOutcomeMap.get(opportunity.id)
        const closeOutcomeCfg =
          kind === 'handoff' && closeOutcome?.outcome
            ? getCloseOutcomeConfig(closeOutcomeRows, closeOutcome.outcome)
            : null
        const outcomeCfg =
          kind === 'handoff'
            ? getInspectionOutcomeConfig(inspectionOutcomeRows, opportunity.inspection_outcome)
            : null
        return {
          id: opportunity.id,
          status: opportunity.status,
          address_text: opportunity.address_text,
          project_type: opportunity.project_type,
          inspection_notes: opportunity.inspection_notes,
          follow_up_at: opportunity.follow_up_at,
          created_at: opportunity.created_at,
          inspection_outcome: opportunity.inspection_outcome ?? null,
          inspection_outcome_at: opportunity.inspection_outcome_at ?? null,
          handoff_context: opportunity.handoff_context ?? null,
          customerName: lead?.homeowner_name || customer?.name || 'Unknown Customer',
          customerPhone: lead?.phone || customer?.phone || null,
          closerUserId: lead?.closer_user_id || null,
          assigned_user_id: opportunity.assigned_user_id,
          followUpKind: kind,
          followUpOutcomeLabel: outcomeCfg?.label ?? closeOutcomeCfg?.label ?? null,
          followUpStatus: queueState.status,
          callableNow: queueState.callability?.callableNow ?? true,
          eligibleAtIso: queueState.callability?.eligibleAtIso ?? null,
          adminHandoffDelayDays:
            queueState.callability?.adminHandoffDelayDays ??
            (typeof closeOutcomeCfg?.inside_sales_handoff_delay_days === 'number'
              ? closeOutcomeCfg.inside_sales_handoff_delay_days
              : null),
          knockback_reason: opportunity.knockback_reason ?? null,
        }
      })
      .filter((opportunity: any) => opportunity.followUpKind)

    const userIds = Array.from(
      new Set(
        queueItems.flatMap((opportunity: any) =>
          [opportunity.assigned_user_id, opportunity.closerUserId].filter(Boolean)
        )
      )
    )

    const userNameMap = new Map<string, string | null>()
    if (userIds.length > 0) {
      const { data: users } = await adminClient
        .from('users')
        .select('id, full_name')
        .in('id', userIds)

      for (const userRow of users || []) {
        userNameMap.set(userRow.id, userRow.full_name || null)
      }
    }

    const queuedOpportunityIds = queueItems.map((item: any) => item.id)
    const activityMap = new Map<string, any[]>()
    if (queuedOpportunityIds.length > 0) {
      const { data: activities } = await adminClient
        .from('activities')
        .select('id, opportunity_id, type, body, created_at, users(full_name)')
        .in('opportunity_id', queuedOpportunityIds)
        .order('created_at', { ascending: false })

      for (const activity of activities || []) {
        const key = activity.opportunity_id
        if (!key) continue
        const current = activityMap.get(key) || []
        current.push({
          id: activity.id,
          type: activity.type,
          body: activity.body,
          created_at: activity.created_at,
          users: activity.users,
        })
        activityMap.set(key, current)
      }
    }

    const nowMs = Date.now()
    // Adjuster meetings whose Google Calendar push failed, so the inside rep who
    // booked one can see it never reached the attending rep's phone and retry it.
    //
    // Tolerant on purpose: the columns arrive in a hand-applied migration
    // (202608050006). Until it runs, PostgREST errors here — that must degrade to
    // "no known failures" rather than taking down the whole queue, which is the
    // rep's primary work surface.
    const adjusterSyncByOpportunity = new Map<
      string,
      { failedAt: string; error: string | null }
    >()
    if (queuedOpportunityIds.length > 0) {
      const { data: syncRows, error: syncError } = await adminClient
        .from('scheduled_appointments')
        .select('opportunity_id, google_sync_failed_at, google_sync_error, scheduled_for')
        .eq('org_id', profile.org_id)
        .eq('appointment_type', ADJUSTER_MEETING_APPOINTMENT_TYPE)
        .in('opportunity_id', queuedOpportunityIds)
        .not('google_sync_failed_at', 'is', null)
        .neq('status', 'cancelled')

      if (syncError) {
        console.warn('Inside sales queue: adjuster meeting sync state unavailable', syncError.message)
      } else {
        for (const row of syncRows || []) {
          const oppId = row.opportunity_id as string | null
          if (!oppId) continue
          adjusterSyncByOpportunity.set(oppId, {
            failedAt: row.google_sync_failed_at as string,
            error: (row.google_sync_error as string | null) ?? null,
          })
        }
      }
    }

    const items = queueItems
      .map((item: any) => {
        const activities = activityMap.get(item.id) || []
        const attempts = activities.filter(
          (activity: any) => activity.type === 'call' || activity.type === 'text'
        )
        // activities are ordered created_at desc, so the first attempt is the latest.
        const lastAttempt = attempts[0] || null
        const enteredQueueAt = item.inspection_outcome_at || item.created_at || null
        const handoffContext = (item.handoff_context as HandoffContext | null) ?? null
        const { story, objective } = getQueueStory({
          followUpKind: item.followUpKind,
          outcomeId: normalizeInspectionOutcomeId(item.inspection_outcome) || null,
          outcomeLabel: item.followUpOutcomeLabel,
          knockbackReason: item.knockback_reason ?? null,
          enteredQueueAt,
          handoffContext,
        })
        const priority = getQueuePriority(
          {
            followUpKind: item.followUpKind,
            callableNow: item.callableNow,
            followUpAt: item.follow_up_at,
            eligibleAtIso: item.eligibleAtIso,
            enteredQueueAt,
            attemptCount: attempts.length,
            lastAttemptAt: lastAttempt?.created_at ?? null,
          },
          nowMs
        )
        const followUpMs = item.follow_up_at ? new Date(item.follow_up_at).getTime() : NaN
        const overdueDays =
          Number.isFinite(followUpMs) && followUpMs < nowMs
            ? Math.floor((nowMs - followUpMs) / (24 * 60 * 60 * 1000))
            : null
        const enteredMs = enteredQueueAt ? new Date(enteredQueueAt).getTime() : NaN
        const daysInQueue = Number.isFinite(enteredMs)
          ? Math.max(0, Math.floor((nowMs - enteredMs) / (24 * 60 * 60 * 1000)))
          : null

        return {
          id: item.id,
          status: item.status,
          address_text: item.address_text,
          project_type: item.project_type,
          inspection_notes: item.inspection_notes,
          follow_up_at: item.follow_up_at,
          created_at: item.created_at ?? null,
          customerName: item.customerName,
          customerPhone: item.customerPhone,
          followUpKind: item.followUpKind,
          followUpOutcomeLabel: item.followUpOutcomeLabel,
          followUpStatus: item.followUpStatus,
          callableNow: item.callableNow,
          eligibleAtIso: item.eligibleAtIso,
          adminHandoffDelayDays: item.adminHandoffDelayDays,
          knockback_reason: item.knockback_reason ?? null,
          assignedToName: item.assigned_user_id
            ? userNameMap.get(item.assigned_user_id) || 'Assigned'
            : null,
          closerName: item.closerUserId ? userNameMap.get(item.closerUserId) || null : null,
          activities,
          story,
          objective,
          handoffContext,
          attemptCount: attempts.length,
          lastAttemptAt: lastAttempt?.created_at ?? null,
          lastAttemptSummary: lastAttempt?.body ?? null,
          daysInQueue,
          overdueDays,
          adjusterMeetingSync: adjusterSyncByOpportunity.get(item.id) ?? null,
          priorityTier: priority.tier,
          _priority: priority,
        }
      })
      .sort((a: any, b: any) => comparePriority(a._priority, b._priority))
      .map(({ _priority, ...item }: any) => item)

    const readyCount = items.filter((item: any) => item.callableNow).length

    return NextResponse.json(
      {
        canView: true,
        canSelfAssign: isInsideSalesRoleLike(insideSalesAccessInput),
        items,
        counts: {
          total: items.length,
          readyToCall: readyCount,
          didntSit: items.filter((item: any) => item.followUpKind === 'didnt_sit').length,
          handoff: items.filter((item: any) => item.followUpKind === 'handoff').length,
          knockback: items.filter((item: any) => item.followUpKind === 'knockback').length,
          storm: items.filter((item: any) => item.followUpKind === 'storm').length,
          dueNow: items.filter((item: any) => item.priorityTier === 1).length,
          neverAttempted: items.filter(
            (item: any) => item.callableNow && item.attemptCount === 0
          ).length,
          overdue: items.filter(
            (item: any) => typeof item.overdueDays === 'number' && item.overdueDays > 0
          ).length,
        },
      },
      {
        headers: {
          'Cache-Control': 'private, no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        },
      }
    )
  } catch (error) {
    console.error('Inside sales queue API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load inside sales queue' },
      {
        status: 500,
        headers: {
          'Cache-Control': 'private, no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        },
      }
    )
  }
}
