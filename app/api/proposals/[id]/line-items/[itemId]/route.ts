import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { SALE_AGREEMENT_TYPES } from '@/lib/sales-metrics'

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

// PATCH - Update a line item (e.g., visibility)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; itemId: string } }
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

    // Only admins can change visibility
    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can modify line item visibility' }, { status: 403 })
    }

    // Verify the proposal belongs to this org
    const { data: proposal } = await adminClient
      .from('proposals')
      .select('id')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
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

    const body = await request.json()

    // Update the line item
    const { data: lineItem, error: updateError } = await adminClient
      .from('proposal_line_items')
      .update({
        show_to_customer: body.show_to_customer ?? false,
      })
      .eq('id', params.itemId)
      .eq('proposal_id', params.id)
      .eq('org_id', profile.org_id)
      .select()
      .single()

    if (updateError) {
      console.error('Line item update error:', updateError)
      return NextResponse.json({ error: 'Failed to update line item' }, { status: 500 })
    }

    return NextResponse.json({ lineItem })
  } catch (error) {
    console.error('Line item update API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to update line item' 
    }, { status: 500 })
  }
}
