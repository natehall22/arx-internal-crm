import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

// GET - Get opportunities (optionally filtered by lead_ids)
export async function GET(request: NextRequest) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized - no access token' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    if (userError || !user) {
      console.error('Auth error:', userError)
      return NextResponse.json({ error: 'Unauthorized - invalid token' }, { status: 401 })
    }

    const adminClient = getAdminClient()

    // Get user profile for org_id and role
    const { data: profile, error: profileError } = await adminClient
      .from('users')
      .select('org_id, role, team_id')
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('Profile fetch error:', profileError)
      return NextResponse.json({ error: 'Failed to fetch user profile' }, { status: 500 })
    }

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found - no org_id' }, { status: 404 })
    }

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

    // Role-based filtering for reps (closers see their own, setters see ones they set)
    // Skip if this is an internal API call (for reporting/dashboard)
    const isRep = ['rep', 'sales_rep', 'closer'].includes(profile.role)
    const isSetter = ['canvasser', 'setter'].includes(profile.role)
    
    if (!bypassRoleFilter) {
      if (isSetter) {
        // Setters see opportunities they set (setter_user_id)
        query = query.eq('setter_user_id', user.id)
      } else if (isRep) {
        // Closers see opportunities they own, set, or are assigned on the lead (lead.closer_user_id is source of truth when calendar reassignment syncs the rep)
        const { data: closerLeadRows } = await adminClient
          .from('leads')
          .select('id')
          .eq('org_id', profile.org_id)
          .eq('closer_user_id', user.id)

        const leadIdsWhereCloser = (closerLeadRows || []).map((r: { id: string }) => r.id)

        const orParts = [
          `owner_user_id.eq.${user.id}`,
          `setter_user_id.eq.${user.id}`,
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
      const ownerIdList = enrichedOpportunities.map((o: any) => o.owner_user_id).filter(Boolean)
      const leadIdList = enrichedOpportunities.map((o: any) => o.lead_id).filter(Boolean)
      const customerIdList = enrichedOpportunities.map((o: any) => o.customer_id).filter(Boolean)
      
      // Fetch owners
      if (ownerIdList.length > 0) {
        const { data: owners } = await adminClient
          .from('users')
          .select('id, full_name')
          .in('id', ownerIdList)

        const ownerMap: Record<string, string> = {}
        ;(owners || []).forEach((u: any) => { ownerMap[u.id] = u.full_name })
        
        enrichedOpportunities.forEach((opp: any) => {
          opp.users = opp.owner_user_id ? { full_name: ownerMap[opp.owner_user_id] || null } : null
        })
      }
      
      // Fetch leads with phone/email for search
      if (leadIdList.length > 0) {
        const { data: leads } = await adminClient
          .from('leads')
          .select('id, homeowner_name, phone, email')
          .in('id', leadIdList)

        const leadMap: Record<string, any> = {}
        ;(leads || []).forEach((l: any) => { leadMap[l.id] = l })
        
        enrichedOpportunities.forEach((opp: any) => {
          const lead = opp.lead_id ? leadMap[opp.lead_id] : null
          opp.leads = lead ? { homeowner_name: lead.homeowner_name || null } : null
          opp.lead_phone = lead?.phone || null
          opp.lead_email = lead?.email || null
        })
      }
      
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

      const inspectionMap: Record<string, { outcome: string; notes: string | null; created_at: string }> = {}
      ;(inspectionStatuses || []).forEach((status: any) => {
        if (status.opportunity_id && !inspectionMap[status.opportunity_id]) {
          inspectionMap[status.opportunity_id] = {
            outcome: status.outcome,
            notes: status.notes,
            created_at: status.created_at,
          }
        }
      })

      // Latest inspection per lead (any opportunity_id). Do NOT require opportunity_id IS NULL.
      // Otherwise rows linked to a stale/duplicate opportunity id never merge onto the current opportunity row.
      let leadInspectionMap: Record<string, { outcome: string; notes: string | null; created_at: string }> = {}
      if (leadIdList.length > 0) {
        const { data: leadOnlyStatuses } = await adminClient
          .from('inspection_status_updates')
          .select('lead_id, outcome, notes, created_at')
          .in('lead_id', leadIdList)
          .order('created_at', { ascending: false })

        ;(leadOnlyStatuses || []).forEach((status: any) => {
          if (status.lead_id && !leadInspectionMap[status.lead_id]) {
            leadInspectionMap[status.lead_id] = {
              outcome: status.outcome,
              notes: status.notes,
              created_at: status.created_at,
            }
          }
        })
      }

      const mergeInspectionDisplay = (opp: any) => {
        type Row = { outcome: string; notes: string | null; created_at: string }
        const candidates: Row[] = []
        const byOpp = inspectionMap[opp.id]
        if (byOpp?.outcome) {
          candidates.push({
            outcome: byOpp.outcome,
            notes: byOpp.notes,
            created_at: byOpp.created_at,
          })
        }
        if (opp.lead_id) {
          const byLead = leadInspectionMap[opp.lead_id]
          if (byLead?.outcome) {
            candidates.push({
              outcome: byLead.outcome,
              notes: byLead.notes,
              created_at: byLead.created_at,
            })
          }
        }
        if (opp.inspection_outcome) {
          const at =
            opp.inspection_outcome_at ||
            opp.updated_at ||
            opp.created_at
          candidates.push({
            outcome: opp.inspection_outcome,
            notes: opp.inspection_notes ?? null,
            created_at: at,
          })
        }
        if (candidates.length === 0) {
          return { inspection_outcome: null, inspection_notes: null, inspection_date: null }
        }
        candidates.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        const best = candidates[0]
        return {
          inspection_outcome: best.outcome,
          inspection_notes: best.notes,
          inspection_date: best.created_at,
        }
      }

      enrichedOpportunities.forEach((opp: any) => {
        const merged = mergeInspectionDisplay(opp)
        opp.inspection_outcome = merged.inspection_outcome
        opp.inspection_notes = merged.inspection_notes
        opp.inspection_date = merged.inspection_date
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
