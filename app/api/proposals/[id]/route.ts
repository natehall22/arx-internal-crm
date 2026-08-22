import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { PROPOSAL_DELETE_PRIVILEGED_ROLES } from '@/lib/proposal-delete-access'
import { SALE_AGREEMENT_TYPES } from '@/lib/sales-metrics'
import { resolveProposalSoldRoofSquares } from '@/lib/sold-roof-squares'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { createServiceClient } from '@/lib/supabase/service'

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

function normalizeText(value?: string | null) {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

const PRIVILEGED_FINANCING_ROLES = ['admin', 'operations', 'owner']

function stripFinancingSensitiveFields<T extends Record<string, unknown>>(
  proposal: T,
  role: string | undefined
): T {
  if (PRIVILEGED_FINANCING_ROLES.includes(role || '')) return proposal
  const next = { ...proposal }
  delete next.dealer_fee_percent
  delete next.dealer_fee_amount
  return next as T
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

    const adminClient = createServiceClient()

    // Get user profile for org_id and role
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role, custom_role_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    if (await resolveSalesDocAccessBarred(adminClient, user.id, profile)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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

    const proposalForClient = stripFinancingSensitiveFields(
      proposal as Record<string, unknown>,
      profile.role
    )

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
        .maybeSingle()

      measurement = measurementData
    }

    const { data: signedSaleAgreement } = await adminClient
      .from('order_form_contracts')
      .select('id')
      .eq('org_id', profile.org_id)
      .eq('proposal_id', params.id)
      .in('agreement_type', SALE_AGREEMENT_TYPES)
      .eq('status', 'completed')
      .limit(1)
      .maybeSingle()

    return NextResponse.json({
      proposal: proposalForClient,
      lineItems: lineItems || [],
      company,
      rep: proposalForClient.users,
      measurement,
      has_completed_installation_contract: Boolean(signedSaleAgreement),
      role: profile.role,
      current_user_id: user.id,
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

    const adminClient = createServiceClient()

    // Get user profile for org_id
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role, custom_role_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    if (await resolveSalesDocAccessBarred(adminClient, user.id, profile)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rawBody = await request.json()

    // Whitelist updateable fields to prevent mass-assignment
    const ALLOWED_FIELDS = new Set([
      'status', 'sent_at', 'accepted_at', 'declined_at', 'declined_reason',
      'inspection_notes', 'pdf_generated_at', 'cover_image_url',
      'customer_name', 'customer_email', 'customer_phone', 'customer_address',
      'title', 'notes', 'total', 'subtotal', 'tax', 'tax_rate',
      'rep_signature_type', 'rep_signature_typed', 'rep_signature_data',
      'rep_signed_name', 'rep_signed_at',
      'customer_signature_type', 'customer_signature_typed', 'customer_signature_data',
      'customer_signed_name', 'customer_signed_at',
      'expiry_date', 'valid_until',
    ])
    const body: Record<string, unknown> = {}
    for (const key of Object.keys(rawBody)) {
      if (ALLOWED_FIELDS.has(key)) body[key] = rawBody[key]
    }
    if (Object.keys(body).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const { data: signedSaleAgreement } = await adminClient
      .from('order_form_contracts')
      .select('id')
      .eq('org_id', profile.org_id)
      .eq('proposal_id', params.id)
      .in('agreement_type', SALE_AGREEMENT_TYPES)
      .eq('status', 'completed')
      .limit(1)
      .maybeSingle()

    if (signedSaleAgreement) {
      return NextResponse.json(
        { error: 'Cannot edit a proposal after a signed Installation or Repair Agreement exists' },
        { status: 400 }
      )
    }

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
      const { data: proposalLineItems } = await adminClient
        .from('proposal_line_items')
        .select('category, name, description, unit, quantity, is_adder')
        .eq('proposal_id', params.id)
      const soldRoofSquares = resolveProposalSoldRoofSquares(proposal as Record<string, unknown>, proposalLineItems || [])
      
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
          
          // Proposal acceptance can create production prep, but dashboard sales count only
          // completed Installation Agreements from order_form_contracts.
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

      // Customer records are created when a contract is signed — not when a proposal is accepted.
      // customerId above is only from opportunity/lead if already linked (e.g. after signing).

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
        sold_roof_squares: soldRoofSquares,
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

    return NextResponse.json({
      proposal: stripFinancingSensitiveFields(
        proposal as Record<string, unknown>,
        profile.role
      ),
      project_id: projectId,
    })
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

    const adminClient = createServiceClient()

    // Get user profile for org_id and role
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role, custom_role_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    if (await resolveSalesDocAccessBarred(adminClient, user.id, profile)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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

    if (proposal.status === 'accepted' || proposal.status === 'declined') {
      return NextResponse.json(
        { error: 'Cannot delete proposals that have been accepted or declined.' },
        { status: 400 }
      )
    }

    const isPrivileged = PROPOSAL_DELETE_PRIVILEGED_ROLES.includes(profile.role)
    const isOwner = proposal.created_by === user.id

    if (!isOwner && !isPrivileged) {
      return NextResponse.json({ error: 'You can only delete your own proposals' }, { status: 403 })
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
