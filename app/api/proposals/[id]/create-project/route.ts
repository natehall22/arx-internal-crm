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

function normalizeText(value?: string | null) {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// POST - Create a project from an accepted proposal
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    // Get the proposal
    const { data: proposal, error: proposalError } = await adminClient
      .from('proposals')
      .select('*')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (proposalError || !proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    // Check if proposal is accepted
    if (proposal.status !== 'accepted') {
      return NextResponse.json({ error: 'Only accepted proposals can be converted to projects' }, { status: 400 })
    }

    // Check if project already exists
    if (proposal.project_id) {
      return NextResponse.json({ error: 'Project already exists for this proposal', project_id: proposal.project_id }, { status: 400 })
    }

    // Get opportunity details if available
    let opportunityData: any = null
    let leadId: string | null = null
    let customerId: string | null = null
    let leadData: any = null
    
    if (proposal.opportunity_id) {
      const { data: opp } = await adminClient
        .from('opportunities')
        .select('*')
        .eq('id', proposal.opportunity_id)
        .single()
      
      if (opp) {
        opportunityData = opp
        leadId = opp.lead_id
        customerId = opp.customer_id

        if (leadId) {
          const { data: lead } = await adminClient
            .from('leads')
            .select('id, customer_id, homeowner_name, email, phone, address_text')
            .eq('id', leadId)
            .eq('org_id', profile.org_id)
            .maybeSingle()

          if (lead) {
            leadData = lead
            // Prefer lead-linked customer over opportunity customer linkage.
            if (lead.customer_id) {
              customerId = lead.customer_id
            }
          }
        }
        
        // Project creation from a proposal is not a dashboard sale.
        // Sales count only completed Installation Agreements from order_form_contracts.
      }
    }

    // Guard against stale customer links on lead/opportunity.
    // If the linked customer name conflicts with lead/proposal homeowner name, rebuild customer linkage.
    const expectedCustomerName = leadData?.homeowner_name || proposal.customer_name
    if (customerId && expectedCustomerName) {
      const { data: linkedCustomer } = await adminClient
        .from('customers')
        .select('id, name')
        .eq('id', customerId)
        .eq('org_id', profile.org_id)
        .maybeSingle()

      const existingName = normalizeText(linkedCustomer?.name)
      const expectedName = normalizeText(expectedCustomerName)
      if (existingName && expectedName && existingName !== expectedName) {
        console.warn('Resetting stale customer link due to name mismatch:', {
          opportunity_id: proposal.opportunity_id,
          customer_id: customerId,
          existing_name: linkedCustomer?.name,
          expected_name: expectedCustomerName,
        })
        customerId = null
      }
    }

    // Customer records are created when a contract is signed — not when a proposal is accepted.
    // customerId above is only from opportunity/lead if already linked (e.g. after signing).

    // Create the project
    // Valid statuses: 'open', 'in_progress', 'on_hold', 'complete', 'collected'
    const projectPayload: any = {
      org_id: profile.org_id,
      owner_user_id: proposal.created_by || user.id,
      status: 'open',
      project_type: opportunityData?.project_type || 'roofing',
      address_text: proposal.customer_address || opportunityData?.address_text,
      lat: opportunityData?.lat,
      lng: opportunityData?.lng,
      roof_squares: opportunityData?.roof_squares,
      notes: `Created from accepted proposal "${proposal.title || proposal.proposal_number}". Total: $${proposal.total?.toLocaleString() || 0}`,
      lead_id: leadId,
      customer_id: customerId,
      opportunity_id: proposal.opportunity_id || null,
    }

    console.log('Creating project with payload:', projectPayload)

    const { data: newProject, error: projectError } = await adminClient
      .from('projects')
      .insert(projectPayload)
      .select()
      .single()

    if (projectError) {
      console.error('Failed to create project:', projectError)
      return NextResponse.json({ error: `Failed to create project: ${projectError.message}` }, { status: 500 })
    }

    // Link proposal to project
    await adminClient
      .from('proposals')
      .update({ project_id: newProject.id })
      .eq('id', params.id)

    // Create activity log
    await adminClient
      .from('activities')
      .insert({
        org_id: profile.org_id,
        user_id: user.id,
        project_id: newProject.id,
        type: 'status_change',
        body: `Project created from accepted proposal "${proposal.title || proposal.proposal_number}"`,
      })

    console.log('Project created from proposal:', { proposalId: params.id, projectId: newProject.id })

    return NextResponse.json({ 
      success: true, 
      project_id: newProject.id,
      message: 'Project created successfully'
    })
  } catch (error) {
    console.error('Create project from proposal error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to create project' 
    }, { status: 500 })
  }
}
