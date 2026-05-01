import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  mapLatestInspectionByLeadId,
  mapLatestInspectionByOpportunityId,
  withEffectiveInspectionFields,
} from '@/lib/effective-inspection-state'
import {
  type InspectionOutcomeConfigRow,
  getInspectionOutcomeConfig,
  mergeOrgInspectionOutcomesWithDefaults,
} from '@/lib/inspection-outcomes'
import {
  canViewInsideSalesFollowUp,
  getInsideSalesCallability,
  getInsideSalesFollowUpKind,
  getInsideSalesFollowUpStatus,
  hasActiveInsideSalesFollowUp,
  isInsideSalesRoleLike,
} from '@/lib/inside-sales-follow-up'

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
      .select('id, org_id, role, custom_role:custom_roles(name, display_name)')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const customRole = Array.isArray((profile as any).custom_role)
      ? (profile as any).custom_role[0]
      : (profile as any).custom_role

    if (
      !canViewInsideSalesFollowUp({
        role: profile.role,
        customRoleName: customRole?.name || null,
        customRoleDisplayName: customRole?.display_name || null,
      })
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [{ data: opportunities, error: opportunitiesError }, { data: orgRow, error: orgError }] = await Promise.all([
      adminClient
      .from('opportunities')
      .select(`
        id,
        customer_id,
        lead_id,
        status,
        address_text,
        project_type,
        inspection_outcome,
        inspection_outcome_at,
        inspection_notes,
        created_at,
        updated_at
      `)
      .eq('org_id', profile.org_id)
      .neq('status', 'won')
      .neq('status', 'lost')
      .order('follow_up_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      // PostgREST default max rows (~1000) can omit queue items after sort; raise explicitly (bounded).
      .limit(8000),
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

    const rawOpportunities = (opportunities || []).map((opportunity: any) => ({
      ...opportunity,
      pipeline_stage: opportunity.pipeline_stage ?? null,
      follow_up_at: opportunity.follow_up_at ?? null,
      assigned_user_id: opportunity.assigned_user_id ?? null,
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

    const queueItems = rawOpportunities
      .map((opportunity: any) =>
        withEffectiveInspectionFields(opportunity, inspectionMap, leadInspectionMap)
      )
      .filter((opportunity: any) =>
        hasActiveInsideSalesFollowUp(opportunity, inspectionOutcomeRows)
      )
      .map((opportunity: any) => {
        const lead = opportunity.lead_id ? leadMap.get(opportunity.lead_id) : null
        const customer = opportunity.customer_id ? customerMap.get(opportunity.customer_id) : null
        const kind = getInsideSalesFollowUpKind(opportunity, inspectionOutcomeRows)
        const outcomeCfg =
          kind === 'handoff'
            ? getInspectionOutcomeConfig(inspectionOutcomeRows, opportunity.inspection_outcome)
            : null
        const callability = getInsideSalesCallability(opportunity, inspectionOutcomeRows)
        return {
          id: opportunity.id,
          status: opportunity.status,
          address_text: opportunity.address_text,
          project_type: opportunity.project_type,
          inspection_notes: opportunity.inspection_notes,
          follow_up_at: opportunity.follow_up_at,
          customerName: lead?.homeowner_name || customer?.name || 'Unknown Customer',
          customerPhone: lead?.phone || customer?.phone || null,
          closerUserId: lead?.closer_user_id || null,
          assigned_user_id: opportunity.assigned_user_id,
          followUpKind: kind,
          followUpOutcomeLabel: outcomeCfg?.label ?? null,
          followUpStatus: getInsideSalesFollowUpStatus(opportunity, inspectionOutcomeRows),
          callableNow: callability?.callableNow ?? true,
          eligibleAtIso: callability?.eligibleAtIso ?? null,
          adminHandoffDelayDays: callability?.adminHandoffDelayDays ?? null,
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

    const items = queueItems
      .map((item: any) => ({
        id: item.id,
        status: item.status,
        address_text: item.address_text,
        project_type: item.project_type,
        inspection_notes: item.inspection_notes,
        follow_up_at: item.follow_up_at,
        customerName: item.customerName,
        customerPhone: item.customerPhone,
        followUpKind: item.followUpKind,
        followUpOutcomeLabel: item.followUpOutcomeLabel,
        followUpStatus: item.followUpStatus,
        callableNow: item.callableNow,
        eligibleAtIso: item.eligibleAtIso,
        adminHandoffDelayDays: item.adminHandoffDelayDays,
        assignedToName: item.assigned_user_id
          ? userNameMap.get(item.assigned_user_id) || 'Assigned'
          : null,
        closerName: item.closerUserId ? userNameMap.get(item.closerUserId) || null : null,
        activities: activityMap.get(item.id) || [],
      }))
      .sort((a: any, b: any) => {
        if (a.callableNow !== b.callableNow) return a.callableNow ? -1 : 1
        const ae = a.eligibleAtIso ? new Date(a.eligibleAtIso).getTime() : Number.POSITIVE_INFINITY
        const be = b.eligibleAtIso ? new Date(b.eligibleAtIso).getTime() : Number.POSITIVE_INFINITY
        if (ae !== be) return ae - be
        const af = a.follow_up_at ? new Date(a.follow_up_at).getTime() : Number.POSITIVE_INFINITY
        const bf = b.follow_up_at ? new Date(b.follow_up_at).getTime() : Number.POSITIVE_INFINITY
        return af - bf
      })

    const readyCount = items.filter((item: any) => item.callableNow).length

    return NextResponse.json(
      {
        canView: true,
        canSelfAssign: isInsideSalesRoleLike({
          role: profile.role,
          customRoleName: customRole?.name || null,
          customRoleDisplayName: customRole?.display_name || null,
        }),
        items,
        counts: {
          total: items.length,
          readyToCall: readyCount,
          didntSit: items.filter((item: any) => item.followUpKind === 'didnt_sit').length,
          handoff: items.filter((item: any) => item.followUpKind === 'handoff').length,
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
