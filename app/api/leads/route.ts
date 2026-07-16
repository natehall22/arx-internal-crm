import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { effectiveHasPermission, resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import {
  isInsideSalesRoleLike,
  shouldScopeLeadsToInsideSalesWorker,
  DIDNT_SIT_PIPELINE_PREFIX,
  HANDOFF_INSIDE_SALES_PIPELINE_PREFIX,
  KNOCKBACK_PIPELINE_PREFIX,
  REP_WORKING_HANDOFF_PIPELINE_PREFIX,
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

// POST - Create a new lead
export async function POST(request: NextRequest) {
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

    // Get user profile for org_id
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const body = await request.json()
    
    // Create the lead
    const { data: lead, error: leadError } = await adminClient
      .from('leads')
      .insert({
        org_id: profile.org_id,
        owner_user_id: body.owner_user_id || user.id,
        homeowner_name: body.homeowner_name || null,
        phone: body.phone || null,
        email: body.email || null,
        address_text: body.address_text || null,
        source: body.source || null,
        channel: body.source === 'call_center' ? 'outbound' : (body.channel || null),
        status: body.status || 'new',
        notes: body.notes || null,
        lat: body.lat || null,
        lng: body.lng || null,
      })
      .select('id')
      .single()

    if (leadError) {
      console.error('Lead creation error:', leadError)
      return NextResponse.json({ error: `Failed to create lead: ${leadError.message}` }, { status: 400 })
    }

    return NextResponse.json({ lead_id: lead.id })
  } catch (error) {
    console.error('Leads API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to create lead' 
    }, { status: 500 })
  }
}

// GET - Get leads for the current user's org with pagination and filtering
// Only shows legitimate leads:
// - Web leads (ad_campaign, call_in, referral, web, other)
// - Door-to-door leads that have converted to opportunities (scheduled inspections)
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

    // Get user profile for org_id and role
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role, team_id, custom_role_id, custom_role:custom_roles(name, display_name)')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const customRole = Array.isArray((profile as { custom_role?: unknown }).custom_role)
      ? (profile as { custom_role: Array<{ name?: string; display_name?: string }> }).custom_role[0]
      : (profile as { custom_role?: { name?: string; display_name?: string } | null }).custom_role

    const { fullAccess, permissionNames } = await resolveEffectivePermissionNames(adminClient, user.id, {
      role: profile.role,
      custom_role_id: profile.custom_role_id,
    })

    const canViewLeads =
      fullAccess ||
      ['leads:view', 'leads:create', 'leads:edit', 'leads:view_inbound', 'leads:manage_inbound', 'leads:claim_inbound'].some(
        (permission) => effectiveHasPermission({ fullAccess, permissionNames }, permission)
      )

    if (!canViewLeads) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const insideSalesAccessInput = {
      role: profile.role,
      customRoleName: customRole?.name || null,
      customRoleDisplayName: customRole?.display_name || null,
      permissionNames,
    }

    const insideSalesScoped = shouldScopeLeadsToInsideSalesWorker(insideSalesAccessInput)
    const canViewInboundLeads =
      fullAccess ||
      effectiveHasPermission({ fullAccess, permissionNames }, 'leads:view_inbound') ||
      effectiveHasPermission({ fullAccess, permissionNames }, 'leads:manage_inbound') ||
      effectiveHasPermission({ fullAccess, permissionNames }, 'leads:claim_inbound')

    // Parse query parameters for pagination and filtering
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')))
    const status = searchParams.get('status') || ''
    const search = searchParams.get('search') || ''
    const channel = searchParams.get('channel') || ''
    const campaignId = searchParams.get('campaign_id') || ''
    const sourceId = searchParams.get('source_id') || ''
    const ownerId = searchParams.get('owner_id') || ''

    // Role-based filtering - setters/canvassers only see their own leads
    const isRep = ['rep', 'sales_rep', 'canvasser', 'setter'].includes(profile.role)

    let assignedInsideSalesLeadIds: string[] = []
    if (insideSalesScoped) {
      // Queue items are org-wide/unclaimed (assigned_user_id NULL until claimed) — without the
      // queue fetch the rep can't find her own queue customers when they call back. Mirrors the
      // opportunity detail page's inside-sales scope (app/opportunities/[id]/page.tsx). The
      // assigned fetch intentionally has no status filter (won/lost records she worked stay findable).
      // Cap at 400: these ids feed a PostgREST or(id.in.(...)) querystring, which rejects
      // somewhere between 400 (verified OK) and 1000 ids — most-due-first so truncation drops
      // only the least-urgent queue items.
      const [
        { data: assignedOpps, error: assignedOppsError },
        { data: queueOpps, error: queueOppsError },
      ] = await Promise.all([
        adminClient
          .from('opportunities')
          .select('lead_id')
          .eq('org_id', profile.org_id)
          .eq('assigned_user_id', user.id)
          .not('lead_id', 'is', null),
        adminClient
          .from('opportunities')
          .select('lead_id')
          .eq('org_id', profile.org_id)
          .not('lead_id', 'is', null)
          .not('status', 'in', '(won,lost)')
          .in('pipeline_stage', [
            DIDNT_SIT_PIPELINE_PREFIX,
            HANDOFF_INSIDE_SALES_PIPELINE_PREFIX,
            KNOCKBACK_PIPELINE_PREFIX,
            REP_WORKING_HANDOFF_PIPELINE_PREFIX,
          ])
          .order('follow_up_at', { ascending: true, nullsFirst: false })
          .limit(400),
      ])
      if (assignedOppsError || queueOppsError) {
        console.error(
          'Inside-sales lead scope fetch failed:',
          assignedOppsError || queueOppsError
        )
      }

      const scopedLeadIds = new Set<string>()
      for (const row of [...(assignedOpps || []), ...(queueOpps || [])]) {
        if (row.lead_id) scopedLeadIds.add(row.lead_id)
      }
      assignedInsideSalesLeadIds = Array.from(scopedLeadIds)
    }

    // First, get all lead IDs that have opportunities (for door_to_door filtering)
    const { data: opportunities } = await adminClient
      .from('opportunities')
      .select('lead_id')
      .eq('org_id', profile.org_id)
      .not('lead_id', 'is', null)

    const leadIdsWithOpportunities = new Set(
      opportunities?.map(o => o.lead_id).filter(Boolean) || []
    )

    const { data: scheduledForDoorFilter } = await adminClient
      .from('scheduled_appointments')
      .select('lead_id')
      .eq('org_id', profile.org_id)
      .in('status', ['scheduled', 'confirmed'])
      .not('lead_id', 'is', null)

    const leadIdsWithScheduledAppointment = new Set(
      scheduledForDoorFilter?.map((r: { lead_id: string | null }) => r.lead_id).filter(Boolean) || []
    )

    // Helper to apply common filters to a query
    const applyFilters = (query: any): any => {
      let q = query

      // Role-based filtering
      if (insideSalesScoped) {
        const visibilityFilters = [`owner_user_id.eq.${user.id}`]
        if (assignedInsideSalesLeadIds.length > 0) {
          visibilityFilters.push(`id.in.(${assignedInsideSalesLeadIds.join(',')})`)
        }
        if (canViewInboundLeads) {
          visibilityFilters.push('channel.eq.inbound')
        }
        q = q.or(visibilityFilters.join(','))
      } else if (isRep) {
        q = q.eq('owner_user_id', user.id)
      }

      // Status filter
      if (status) {
        q = q.eq('status', status)
      }

      // Channel filter
      if (channel === 'inbound') {
        q = q.eq('channel', 'inbound')
      } else if (channel === 'outbound') {
        q = q.or('channel.eq.outbound,channel.is.null')
      }

      // Campaign filter
      if (campaignId) {
        q = q.eq('campaign_id', campaignId)
      }

      // Source filter
      if (sourceId) {
        q = q.eq('lead_source_id', sourceId)
      }

      // Owner filter
      if (ownerId === 'unassigned') {
        q = q.is('owner_user_id', null)
      } else if (ownerId) {
        q = q.eq('owner_user_id', ownerId)
      }

      // Search filter - use ilike for case-insensitive search
      if (search) {
        q = q.or(
          `homeowner_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%,address_text.ilike.%${search}%`
        )
      }

      return q
    }

    // Get total count (before pagination)
    const countQuery = applyFilters(
      adminClient
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', profile.org_id)
    )
    const { count: rawCount, error: countError } = await countQuery

    if (countError) {
      console.error('Count error:', countError)
    }

    // Get paginated data
    const offset = (page - 1) * limit
    const dataQuery = applyFilters(
      adminClient
        .from('leads')
        .select(`
          *,
          users:users!leads_owner_user_id_fkey(full_name),
          campaigns(name),
          lead_sources(name)
        `)
        .eq('org_id', profile.org_id)
    )
      // Use updated_at so recently scheduled inspections / canvass touches surface even when
      // the lead row is older (sorting only by created_at hid updated door-to-door leads).
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)

    const { data: rawLeads, error: leadsError } = await dataQuery

    if (leadsError) {
      console.error('Leads fetch error:', leadsError)
      return NextResponse.json({ error: 'Failed to fetch leads' }, { status: 500 })
    }

    // Hide raw door knocks until there is real pipeline activity. Opportunity alone used to
    // be the signal, but opportunities are often created at inspection outcome — so a lead can
    // be in "inspection" with a scheduled time and still have no opportunity row yet.
    // If scheduled_appointments exists (calendar path), always show — avoids hiding when the
    // lead row is stale but the appointment row is not.
    const progressedDoorToDoorStatuses = new Set([
      'appointment',
      'inspection',
      'estimate_sent',
      'won',
      'lost',
    ])

    const filteredLeads = (rawLeads || []).filter(
      (lead: {
        id: string
        source: string | null
        status: string | null
        inspection_scheduled_for: string | null
      }) => {
        if (lead.source !== 'door_to_door') {
          return true
        }
        if (leadIdsWithOpportunities.has(lead.id)) {
          return true
        }
        if (leadIdsWithScheduledAppointment.has(lead.id)) {
          return true
        }
        if (lead.inspection_scheduled_for) {
          return true
        }
        if (lead.status && progressedDoorToDoorStatuses.has(lead.status)) {
          return true
        }
        return false
      }
    )

    // Get opportunity IDs for the filtered leads in a single query
    const filteredLeadIds = filteredLeads.map((l: { id: string }) => l.id)
    let opportunityMap: Record<string, string> = {}
    
    if (filteredLeadIds.length > 0) {
      const { data: opps } = await adminClient
        .from('opportunities')
        .select('id, lead_id')
        .eq('org_id', profile.org_id)
        .in('lead_id', filteredLeadIds)
      
      if (opps) {
        opps.forEach((opp: { id: string; lead_id: string | null }) => {
          if (opp.lead_id) {
            opportunityMap[opp.lead_id] = opp.id
          }
        })
      }
    }

    // Attach opportunity_id to each lead
    const leadsWithOpportunities = filteredLeads.map((lead: { id: string }) => ({
      ...lead,
      opportunity_id: opportunityMap[lead.id] || null,
    }))

    // Calculate accurate total by checking how many door_to_door leads need filtering
    // For simplicity, we'll return the filtered count for this page
    // A more accurate approach would require a separate count query
    const totalCount = rawCount || 0
    const totalPages = Math.ceil(totalCount / limit)

    return NextResponse.json({ 
      leads: leadsWithOpportunities,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages,
        hasMore: page < totalPages,
      }
    })
  } catch (error) {
    console.error('Leads API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch leads' 
    }, { status: 500 })
  }
}
