import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

function getSupabaseClient(req: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll() {
          // No-op for GET/POST that return JSON
        },
      },
    }
  )
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient(request)
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('users')
      .select('role, org_id')
      .eq('id', user.id)
      .single()

    if (!profile || !['admin', 'regional_manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const {
      email,
      password,
      full_name,
      phone,
      role,
      custom_role_id,
      team_id,
      region_id,
      manager_user_id,
      org_id,
      permission_ids,
    } = body

    if (!email || !password || !full_name) {
      return NextResponse.json({ error: 'Email, password, and full name are required' }, { status: 400 })
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }

    if (org_id !== profile.org_id) {
      return NextResponse.json({ error: 'Cannot create users in a different organization' }, { status: 403 })
    }

    const adminClient = createAdminClient()

    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name,
      },
    })

    if (authError) {
      console.error('Auth error:', authError)
      if (authError.message.includes('already been registered')) {
        return NextResponse.json({ error: 'A user with this email already exists' }, { status: 400 })
      }
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    if (!authData.user) {
      return NextResponse.json({ error: 'Failed to create auth user' }, { status: 500 })
    }

    const { error: profileError } = await adminClient
      .from('users')
      .insert({
        id: authData.user.id,
        email,
        full_name,
        phone: phone || null,
        role: role || 'sales_rep',
        custom_role_id: custom_role_id || null,
        team_id: team_id || null,
        region_id: region_id || null,
        manager_user_id: manager_user_id || null,
        org_id,
        active: true,
      })

    if (profileError) {
      console.error('Profile error:', profileError)
      await adminClient.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ error: 'Failed to create user profile' }, { status: 500 })
    }

    if (permission_ids && Array.isArray(permission_ids) && permission_ids.length > 0) {
      const permissionInserts = permission_ids.map((permId: string) => ({
        org_id,
        user_id: authData.user.id,
        permission_id: permId,
        granted_by: user.id,
      }))

      const { error: permError } = await adminClient
        .from('user_permissions')
        .insert(permissionInserts)

      if (permError) {
        console.error('Permission error:', permError)
      }
    }

    return NextResponse.json({ 
      success: true, 
      user: { 
        id: authData.user.id, 
        email, 
        full_name 
      } 
    })

  } catch (error) {
    console.error('Create user error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const supabase = getSupabaseClient(request)
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('users')
    .select('role, org_id')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const { data: users, error } = await supabase
    .from('users')
    .select('*')
    .eq('org_id', profile.org_id)
    .order('full_name')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ users })
}
