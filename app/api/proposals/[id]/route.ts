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

// GET - Get a single proposal with all details
export async function GET(
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

    // Get user profile for org_id and role
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Get proposal with creator info
    const { data: proposal, error: proposalError } = await adminClient
      .from('proposals')
      .select('*, users:created_by(full_name, email, phone)')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (proposalError || !proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    // Get company info
    const { data: company } = await adminClient
      .from('orgs')
      .select('name, logo_url, phone, email, address, website')
      .eq('id', profile.org_id)
      .single()

    // Get line items
    const { data: lineItems } = await adminClient
      .from('proposal_line_items')
      .select('*')
      .eq('proposal_id', params.id)
      .order('sort_order')

    // Get measurement data if opportunity exists
    let measurement = null
    if (proposal.opportunity_id) {
      const { data: measurementData } = await adminClient
        .from('roof_measurements')
        .select('*')
        .eq('opportunity_id', proposal.opportunity_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      
      measurement = measurementData
    }

    return NextResponse.json({
      proposal,
      lineItems: lineItems || [],
      company,
      rep: proposal.users,
      measurement,
      role: profile.role,
    })
  } catch (error) {
    console.error('Proposal detail API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch proposal' 
    }, { status: 500 })
  }
}

// PATCH - Update proposal (status, send, etc.)
export async function PATCH(
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

    const body = await request.json()

    // Get current proposal state before update
    const { data: currentProposal } = await adminClient
      .from('proposals')
      .select('status, opportunity_id, customer_name, customer_email, customer_phone, customer_address, total, created_by')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (!currentProposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }
    const proposalSnapshot = currentProposal

    // Update proposal
    const { data: proposal, error: updateError } = await adminClient
      .from('proposals')
      .update(body)
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .select()
      .single()

    if (updateError) {
      console.error('Proposal update error:', updateError)
      return NextResponse.json({ error: 'Failed to update proposal' }, { status: 500 })
    }

    // If proposal was just accepted, create a project
    let projectId: string | null = null
    if (body.status === 'accepted' && proposalSnapshot.status !== 'accepted') {
      console.log('Proposal accepted, creating project...')
      
      // Get opportunity details if available
      let opportunityData: any = null
      let leadId: string | null = null
      let customerId: string | null = null
      let leadData: any = null
      
      if (proposalSnapshot.opportunity_id) {
        const { data: opp } = await adminClient
          .from('opportunities')
          .select('*, lead_id, customer_id')
          .eq('id', proposalSnapshot.opportunity_id)
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
          
          // Mark opportunity as won and ensure approval is counted as a sale event.
          await adminClient
            .from('opportunities')
            .update({
              status: 'won',
              inspection_outcome: 'sale',
              inspection_outcome_at: new Date().toISOString(),
            })
            .eq('id', proposalSnapshot.opportunity_id)
        }
      }

      // Guard against stale customer links on lead/opportunity.
      // If the linked customer name conflicts with lead/proposal homeowner name, rebuild customer linkage.
      const expectedCustomerName = leadData?.homeowner_name || proposalSnapshot.customer_name
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
            opportunity_id: proposalSnapshot.opportunity_id,
            customer_id: customerId,
            existing_name: linkedCustomer?.name,
            expected_name: expectedCustomerName,
          })
          customerId = null
        }
      }

      // Create or find customer from lead data first, then proposal as fallback.
      if (!customerId && leadData?.homeowner_name) {
        try {
          const { upsertCustomer } = await import('@/lib/customers')
          const result = await upsertCustomer(adminClient, profile.org_id, {
            name: leadData.homeowner_name,
            email: leadData.email,
            phone: leadData.phone,
            address_text: leadData.address_text || proposalSnapshot.customer_address,
          })
          customerId = result.customer_id
          console.log(`Customer ${result.created ? 'created' : 'found'} from lead:`, customerId)
        } catch (err) {
          console.error('Failed to upsert customer from lead:', err)
        }
      }

      if (!customerId && proposalSnapshot.customer_name) {
        try {
          const { upsertCustomer } = await import('@/lib/customers')
          const result = await upsertCustomer(adminClient, profile.org_id, {
            name: proposalSnapshot.customer_name,
            email: proposalSnapshot.customer_email,
            phone: proposalSnapshot.customer_phone,
            address_text: proposalSnapshot.customer_address,
          })
          customerId = result.customer_id
          console.log(`Customer ${result.created ? 'created' : 'found'}:`, customerId)
        } catch (err) {
          console.error('Failed to upsert customer:', err)
        }
      }

      // Keep opportunity/lead customer link in sync with the resolved customer.
      if (customerId && proposalSnapshot.opportunity_id) {
        await adminClient
          .from('opportunities')
          .update({ customer_id: customerId })
          .eq('id', proposalSnapshot.opportunity_id)
          .eq('org_id', profile.org_id)

        if (leadId) {
          await adminClient
            .from('leads')
            .update({ customer_id: customerId })
            .eq('id', leadId)
            .eq('org_id', profile.org_id)
        }
      }

      // Create the project
      // Valid statuses: 'open', 'in_progress', 'on_hold', 'complete', 'collected'
      const projectPayload: any = {
        org_id: profile.org_id,
        owner_user_id: proposalSnapshot.created_by || user.id,
        status: 'open',
        project_type: opportunityData?.project_type || 'roofing',
        address_text: proposalSnapshot.customer_address || opportunityData?.address_text,
        lat: opportunityData?.lat,
        lng: opportunityData?.lng,
        roof_squares: opportunityData?.roof_squares,
        notes: `Created from accepted proposal. Total: $${proposalSnapshot.total?.toLocaleString() || 0}`,
        lead_id: leadId,
        customer_id: customerId,
      }

      const { data: newProject, error: projectError } = await adminClient
        .from('projects')
        .insert(projectPayload)
        .select()
        .single()

      if (projectError) {
        console.error('Failed to create project:', projectError)
      } else {
        projectId = newProject.id
        console.log('Project created:', projectId)

        // Link proposal to project
        await adminClient
          .from('proposals')
          .update({ project_id: projectId })
          .eq('id', params.id)

        // Create activity log
        await adminClient
          .from('activities')
          .insert({
            org_id: profile.org_id,
            user_id: user.id,
            project_id: projectId,
            type: 'status_change',
            body: `Project created from accepted proposal "${proposal.title || proposal.proposal_number}"`,
          })
      }
    }

    return NextResponse.json({ proposal, project_id: projectId })
  } catch (error) {
    console.error('Proposal update API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to update proposal' 
    }, { status: 500 })
  }
}

// DELETE - Delete a proposal
export async function DELETE(
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

    // Get user profile for org_id and role
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Check if proposal exists and belongs to this org
    const { data: proposal, error: fetchError } = await adminClient
      .from('proposals')
      .select('id, status, created_by')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (fetchError || !proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    // Only allow deletion of draft proposals, or by admins/managers
    const isAdmin = profile.role === 'admin' || profile.role === 'manager'
    const isOwner = proposal.created_by === user.id
    
    if (proposal.status !== 'draft' && !isAdmin) {
      return NextResponse.json({ 
        error: 'Only draft proposals can be deleted. Contact an admin to delete sent proposals.' 
      }, { status: 403 })
    }

    if (!isOwner && !isAdmin) {
      return NextResponse.json({ 
        error: 'You can only delete your own proposals' 
      }, { status: 403 })
    }

    // Delete line items first (should cascade, but being explicit)
    await adminClient
      .from('proposal_line_items')
      .delete()
      .eq('proposal_id', params.id)

    // Delete the proposal
    const { error: deleteError } = await adminClient
      .from('proposals')
      .delete()
      .eq('id', params.id)
      .eq('org_id', profile.org_id)

    if (deleteError) {
      console.error('Proposal delete error:', deleteError)
      return NextResponse.json({ error: 'Failed to delete proposal' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Proposal delete API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to delete proposal' 
    }, { status: 500 })
  }
}
