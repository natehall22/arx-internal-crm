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
      return JSON.parse(singleCookie.value)
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
      return JSON.parse(chunks.join(''))
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

// DELETE - Delete a lead
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const leadId = params.id
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

    // Get the lead to verify ownership and org
    const { data: lead } = await adminClient
      .from('leads')
      .select('id, owner_user_id, org_id')
      .eq('id', leadId)
      .eq('org_id', profile.org_id)
      .single()

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    // Check permissions: admin roles can delete any, others only their own
    const isAdminRole = ['admin', 'regional_manager', 'sales_manager'].includes(profile.role)
    const isLeadOwner = lead.owner_user_id === user.id

    if (!isAdminRole && !isLeadOwner) {
      return NextResponse.json({ error: 'You do not have permission to delete this lead' }, { status: 403 })
    }

    // Check if there's an opportunity linked - prevent deletion if so
    const { data: linkedOpportunity } = await adminClient
      .from('opportunities')
      .select('id')
      .eq('lead_id', leadId)
      .maybeSingle()

    if (linkedOpportunity) {
      return NextResponse.json({ 
        error: 'Cannot delete lead with linked opportunity. Delete the opportunity first.' 
      }, { status: 400 })
    }

    // Delete related records first
    await adminClient.from('activities').delete().eq('lead_id', leadId)
    await adminClient.from('files').delete().eq('lead_id', leadId)
    await adminClient.from('referrals').delete().eq('referred_lead_id', leadId)

    // Delete the lead
    const { error: deleteError } = await adminClient
      .from('leads')
      .delete()
      .eq('id', leadId)
      .eq('org_id', profile.org_id)

    if (deleteError) {
      console.error('Delete lead error:', deleteError)
      return NextResponse.json({ error: 'Failed to delete lead' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete lead API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to delete lead' 
    }, { status: 500 })
  }
}
