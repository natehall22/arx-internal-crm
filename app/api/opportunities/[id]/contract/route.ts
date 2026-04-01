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

// POST - Upload signed contract
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
    const opportunityId = params.id

    // Get user profile
    const { data: profile, error: profileError } = await adminClient
      .from('users')
      .select('id, org_id, role')
      .eq('id', user.id)
      .single()

    if (profileError || !profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Get the form data
    const formData = await request.formData()
    const file = formData.get('signed_contract') as File | null
    
    if (!file || file.size === 0) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Verify opportunity exists and user has access
    let opportunityQuery = adminClient
      .from('opportunities')
      .select('*, leads(*)')
      .eq('id', opportunityId)
      .eq('org_id', profile.org_id)

    if (profile.role === 'rep') {
      opportunityQuery = opportunityQuery.eq('owner_user_id', profile.id)
    }

    const { data: opportunity, error: oppError } = await opportunityQuery.single()
    
    if (oppError || !opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    // Check for existing project
    const { data: existingProject } = opportunity.lead_id
      ? await adminClient
          .from('projects')
          .select('id')
          .eq('lead_id', opportunity.lead_id)
          .maybeSingle()
      : { data: null }

    // Create or get customer
    let customerId = opportunity.customer_id
    if (!customerId) {
      const lead = opportunity.leads
      const { data: customer } = await adminClient
        .from('customers')
        .insert({
          org_id: profile.org_id,
          name: lead?.homeowner_name ?? null,
          phone: lead?.phone ?? null,
          email: lead?.email ?? null,
          address_text: lead?.address_text ?? null,
        })
        .select('*')
        .single()

      customerId = customer?.id ?? null
    }

    // Create project if needed
    let projectId = existingProject?.id ?? null
    if (!projectId) {
      const { data: createdProject } = await adminClient
        .from('projects')
        .insert({
          org_id: profile.org_id,
          customer_id: customerId,
          lead_id: opportunity.lead_id,
          owner_user_id: opportunity.owner_user_id,
          status: 'open',
          project_type: opportunity.project_type,
          address_text: opportunity.address_text,
          lat: opportunity.lat,
          lng: opportunity.lng,
          roof_squares: opportunity.roof_squares,
          siding_squares: opportunity.siding_squares,
          vents_count: opportunity.vents_count,
          layers: opportunity.layers,
          total_windows: opportunity.total_windows,
          windows_by_type: opportunity.windows_by_type,
          notes: opportunity.notes,
        })
        .select('id')
        .single()

      projectId = createdProject?.id ?? null
    }

    // Upload file to storage
    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const storagePath = `org/${profile.org_id}/opportunities/${opportunityId}/contracts/${Date.now()}_${file.name}`

    const { error: uploadError } = await adminClient.storage
      .from('files')
      .upload(storagePath, fileBuffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      console.error('Contract upload error:', uploadError)
      return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 })
    }

    // Create file record
    await adminClient.from('files').insert({
      org_id: profile.org_id,
      opportunity_id: opportunityId,
      project_id: projectId,
      customer_id: customerId,
      user_id: profile.id,
      storage_path: storagePath,
      file_name: file.name,
      mime_type: file.type,
      tag: 'contract',
    })

    // Only mark won when a project exists (create may have failed silently before).
    if (projectId) {
      await adminClient
        .from('opportunities')
        .update({ status: 'won', customer_id: customerId })
        .eq('id', opportunityId)
        .eq('org_id', profile.org_id)

      // Update lead status if exists
      if (opportunity.lead_id) {
        await adminClient
          .from('leads')
          .update({ status: 'won' })
          .eq('id', opportunity.lead_id)
          .eq('org_id', profile.org_id)
      }
    } else {
      console.error(
        '[Opportunity Contract] No project id after create/lookup; opportunity not marked won. opportunityId=',
        opportunityId
      )
    }

    // Create activity records
    await adminClient.from('activities').insert({
      org_id: profile.org_id,
      opportunity_id: opportunityId,
      user_id: profile.id,
      type: 'status_change',
      body: projectId
        ? 'Signed contract uploaded. Project created.'
        : 'Signed contract uploaded; project was not created — check server logs.',
    })

    if (projectId) {
      await adminClient.from('activities').insert({
        org_id: profile.org_id,
        project_id: projectId,
        user_id: profile.id,
        type: 'status_change',
        body: 'Project created from signed contract.',
      })
    }

    return NextResponse.json({
      success: true,
      projectId,
      message: projectId
        ? 'Contract uploaded successfully. Project created.'
        : 'Contract uploaded but project could not be created. Opportunity was not marked won.',
    })
  } catch (error) {
    console.error('Contract upload API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to upload contract' 
    }, { status: 500 })
  }
}
