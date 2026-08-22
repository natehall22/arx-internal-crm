import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import {
  mapLatestInspectionByLeadId,
  mapLatestInspectionByOpportunityId,
  mergeEffectiveInspectionFields,
} from '@/lib/effective-inspection-state'
import { effectiveHasPermission, resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

// GET - Get opportunities (optionally filtered by lead_ids)
export async function GET(request: NextRequest) {
  try {
    let authContext: Awaited<ReturnType<typeof requireAuthApi>>
    try {
      authContext = await requireAuthApi()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const profile = authContext.profile
    const adminClient = createServiceClient()

    const searchParams = request.nextUrl.searchParams
    const leadIds = searchParams.get('lead_ids')
    const fullData = searchParams.get('full') === 'true'
    const inspectionOutcome = searchParams.get('inspection_outcome')
    const searchQuery = searchParams.get('q')
    const bypassRoleFilter = searchParams.get('_internal') === 'true' // For internal API calls (reporting, etc.)

    // Build the query - fetch all columns explicitly to avoid join issues
    let query = adminClient
      .from('opportunities')
      .select(`
        id,
        org_id,
        lead_id,
        customer_id,
        owner_user_id,
        setter_user_id,
        address_text,
        project_type,
        status,
        inspection_outcome,
        inspection_outcome_at,
        inspection_notes,
        created_at,
        updated_at
      `)
      .eq('org_id', profile.org_id)
      .order('created_at', { ascending: false })

    // Admin / Roles: gate on effective `opportunities:view` (legacy matrix + custom roles + user overrides).
    // Internal/reporting calls may bypass with _internal=true (existing behavior).
    if (!bypassRoleFilter) {
      const effective = await resolveEffectivePermissionNames(
        adminClient,
        authContext.authUser.id,
        { role: profile.role, custom_role_id: profile.custom_role_id ?? null }
      )
      if (!effectiveHasPermission(effective, 'opportunities:view')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // Role-based filtering for reps (closers see their own; managers see org-wide above)
    const isRep = ['rep', 'sales_rep', 'closer'].includes(profile.role)

    if (!bypassRoleFilter) {
      if (isRep) {
        // Closers see opportunities they own, set, or are assigned on the lead (lead.closer_user_id is source of truth when calendar reassignment syncs the rep)
        const { data: closerLeadRows } = await adminClient
          .from('leads')
          .select('id')
          .eq('org_id', profile.org_id)
          .eq('closer_user_id', authContext.authUser.id)

        const leadIdsWhereCloser = (closerLeadRows || []).map((r: { id: string }) => r.id)

        const orParts = [
          `owner_user_id.eq.${authContext.authUser.id}`,
          `setter_user_id.eq.${authContext.authUser.id}`,
        ]
        if (leadIdsWhereCloser.length > 0) {
          orParts.push(`lead_id.in.(${leadIdsWhereCloser.join(',')})`)
        }
        query = query.or(orParts.join(','))
      }
    }

    if (leadIds) {
      const ids = leadIds.split(',').filter(Boolean)
      if (ids.length > 0) {
        query = query.in('lead_id', ids)
      }
    }

    const { data: opportunities, error: oppsError } = await query

    if (oppsError) {
      console.error('Opportunities fetch error:', oppsError)
      // Handle case where table doesn't exist yet
      if (oppsError.message?.includes('does not exist') || oppsError.message?.includes('schema cache')) {
        return NextResponse.json({ 
          opportunities: [],
          warning: 'Opportunities table not found. Please run database migrations.'
        })
      }
      return NextResponse.json({ error: `Failed to fetch opportunities: ${oppsError.message}` }, { status: 500 })
    }

    // Fetch related data separately to avoid join issues
    let enrichedOpportunities = opportunities || []
    
    if (fullData && enrichedOpportunities.length > 0) {
      // Get unique IDs for related lookups
      const oppIdList = enrichedOpportunities.map((o: any) => o.id)
      const leadIdList = enrichedOpportunities.map((o: any) => o.lead_id).filter(Boolean)
      const customerIdList = enrichedOpportunities.map((o: any) => o.customer_id).filter(Boolean)

      // Leads first — closer_user_id is source of truth for assigned rep (calendar reassignment, etc.)
      const leadMap: Record<string, any> = {}
      if (leadIdList.length > 0) {
        const { data: leads } = await adminClient
          .from('leads')
          .select('id, homeowner_name, phone, email, closer_user_id')
          .in('id', leadIdList)

        ;(leads || []).forEach((l: any) => {
          leadMap[l.id] = l
        })
      }

      const userIdsForDisplay = new Set<string>()
      enrichedOpportunities.forEach((opp: any) => {
        if (opp.owner_user_id) userIdsForDisplay.add(opp.owner_user_id)
        const lead = opp.lead_id ? leadMap[opp.lead_id] : null
        if (lead?.closer_user_id) userIdsForDisplay.add(lead.closer_user_id)
      })

      const userMap: Record<string, string> = {}
      if (userIdsForDisplay.size > 0) {
        const { data: users } = await adminClient
          .from('users')
          .select('id, full_name')
          .in('id', Array.from(userIdsForDisplay))

        ;(users || []).forEach((u: any) => {
          userMap[u.id] = u.full_name
        })
      }

      enrichedOpportunities.forEach((opp: any) => {
        const lead = opp.lead_id ? leadMap[opp.lead_id] : null
        const leadCloserId = lead?.closer_user_id ?? null
        const displayUserId = leadCloserId || opp.owner_user_id || null
        opp.users = displayUserId ? { full_name: userMap[displayUserId] || null } : null
        opp.leads = lead ? { homeowner_name: lead.homeowner_name || null } : null
        opp.lead_phone = lead?.phone || null
        opp.lead_email = lead?.email || null
      })
      
      // Fetch customers
      if (customerIdList.length > 0) {
        const { data: customers } = await adminClient
          .from('customers')
          .select('id, name, phone, email')
          .in('id', customerIdList)

        const customerMap: Record<string, any> = {}
        ;(customers || []).forEach((c: any) => { customerMap[c.id] = c })
        
        enrichedOpportunities.forEach((opp: any) => {
          const customer = opp.customer_id ? customerMap[opp.customer_id] : null
          opp.customers = customer ? { name: customer.name || null } : null
          opp.customer_phone = customer?.phone || null
          opp.customer_email = customer?.email || null
        })
      }
      
      // Latest inspection rows from inspection_status_updates (by opportunity, and by lead when opportunity_id was null)
      const { data: inspectionStatuses } = await adminClient
        .from('inspection_status_updates')
        .select('opportunity_id, lead_id, outcome, notes, created_at')
        .in('opportunity_id', oppIdList)
        .order('created_at', { ascending: false })

      const inspectionMap = mapLatestInspectionByOpportunityId(inspectionStatuses || [])

      // Latest inspection per lead (any opportunity_id). Do NOT require opportunity_id IS NULL.
      // Otherwise rows linked to a stale/duplicate opportunity id never merge onto the current opportunity row.
      let leadInspectionMap = new Map<string, { outcome: string; notes: string | null; created_at: string }>()
      if (leadIdList.length > 0) {
        const { data: leadOnlyStatuses } = await adminClient
          .from('inspection_status_updates')
          .select('lead_id, outcome, notes, created_at')
          .in('lead_id', leadIdList)
          .order('created_at', { ascending: false })

        leadInspectionMap = mapLatestInspectionByLeadId(leadOnlyStatuses || [])
      }

      enrichedOpportunities.forEach((opp: any) => {
        const merged = mergeEffectiveInspectionFields(opp, inspectionMap, leadInspectionMap)
        opp.inspection_outcome = merged.inspection_outcome
        opp.inspection_notes = merged.inspection_notes
        opp.inspection_date = merged.inspection_outcome_at
      })
      
      // Filter by inspection outcome if specified (match merged display outcome; case-insensitive on id)
      if (inspectionOutcome) {
        if (inspectionOutcome === 'none') {
          enrichedOpportunities = enrichedOpportunities.filter((opp: any) => !opp.inspection_outcome)
        } else {
          const want = inspectionOutcome.toLowerCase()
          enrichedOpportunities = enrichedOpportunities.filter(
            (opp: any) =>
              opp.inspection_outcome &&
              String(opp.inspection_outcome).toLowerCase() === want
          )
        }
      }
      
      // Filter by search query if specified
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        enrichedOpportunities = enrichedOpportunities.filter((opp: any) => {
          const name = opp.leads?.homeowner_name || opp.customers?.name || ''
          const address = opp.address_text || ''
          const phone = opp.lead_phone || opp.customer_phone || ''
          const email = opp.lead_email || opp.customer_email || ''
          return (
            name.toLowerCase().includes(q) ||
            address.toLowerCase().includes(q) ||
            phone.includes(q) ||
            email.toLowerCase().includes(q)
          )
        })
      }
    }

    return NextResponse.json({ opportunities: enrichedOpportunities })
  } catch (error) {
    console.error('Opportunities API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch opportunities' 
    }, { status: 500 })
  }
}
