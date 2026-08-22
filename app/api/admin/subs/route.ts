import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
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

export async function GET(request: NextRequest) {
  try {
    const sessionData = getSessionFromRequest(request)
    if (!sessionData?.access_token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createServiceClient()

    // Verify user
    const authClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: { user }, error: authError } = await authClient.auth.getUser(sessionData.access_token)
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get profile
    const { data: profile } = await supabase
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Check role
    const adminRoles = ['admin', 'regional_manager', 'operations', 'manager', 'sales_manager', 'owner']
    if (!adminRoles.includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get subs
    const { data: subs, error } = await supabase
      .from('sub_contractors')
      .select('*')
      .eq('org_id', profile.org_id)
      .order('company_name')

    if (error) {
      console.error('Error fetching subs:', error)
    }

    return NextResponse.json({
      subs: subs || [],
      orgId: profile.org_id,
    })
  } catch (error) {
    console.error('Subs API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const sessionData = getSessionFromRequest(request)
    if (!sessionData?.access_token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createServiceClient()

    // Verify user
    const authClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: { user }, error: authError } = await authClient.auth.getUser(sessionData.access_token)
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get profile
    const { data: profile } = await supabase
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const adminRoles = ['admin', 'regional_manager', 'operations', 'manager', 'sales_manager', 'owner']
    if (!adminRoles.includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    
    const subData = {
      org_id: profile.org_id,
      company_name: body.company_name,
      contact_name: body.contact_name || null,
      phone: body.phone || null,
      email: body.email || null,
      address: body.address || null,
      city: body.city || null,
      state: body.state || null,
      zip: body.zip || null,
      license_number: body.license_number || null,
      services: body.services || [],
      internal_notes: body.internal_notes || null,
      portal_access_enabled: body.portal_access_enabled || false,
      active: true,
    }

    const { data, error } = await supabase
      .from('sub_contractors')
      .insert(subData)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ sub: data })
  } catch (error) {
    console.error('Subs POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const sessionData = getSessionFromRequest(request)
    if (!sessionData?.access_token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createServiceClient()

    // Verify user
    const authClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: { user }, error: authError } = await authClient.auth.getUser(sessionData.access_token)
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get profile
    const { data: profile } = await supabase
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const adminRoles = ['admin', 'regional_manager', 'operations', 'manager', 'sales_manager', 'owner']
    if (!adminRoles.includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json({ error: 'Sub ID required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('sub_contractors')
      .update(updates)
      .eq('id', id)
      .eq('org_id', profile.org_id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ sub: data })
  } catch (error) {
    console.error('Subs PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const sessionData = getSessionFromRequest(request)
    if (!sessionData?.access_token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createServiceClient()

    // Verify user
    const authClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: { user }, error: authError } = await authClient.auth.getUser(sessionData.access_token)
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get profile
    const { data: profile } = await supabase
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Only admin can delete
    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can delete subcontractors' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Sub ID required' }, { status: 400 })
    }

    // Check if sub has any assigned jobs or work orders
    const [{ data: assignedJobs }, { data: assignedWorkOrders }] = await Promise.all([
      supabase
        .from('production_jobs')
        .select('id')
        .eq('assigned_sub_id', id)
        .limit(1),
      supabase
        .from('work_orders')
        .select('id')
        .eq('sub_contractor_id', id)
        .limit(1),
    ])

    if ((assignedJobs && assignedJobs.length > 0) || (assignedWorkOrders && assignedWorkOrders.length > 0)) {
      return NextResponse.json({ 
        error: 'Cannot delete subcontractor with assigned jobs or work orders. Reassign or complete them first, or deactivate the sub instead.' 
      }, { status: 400 })
    }

    const { error } = await supabase
      .from('sub_contractors')
      .delete()
      .eq('id', id)
      .eq('org_id', profile.org_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Subs DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
