import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

// Create a Supabase admin client with service role key
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

// POST - Create a new user
export async function POST(request: NextRequest) {
  try {
    // Verify the requesting user is an admin
    const supabase = createServerClient()
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

    // Validate required fields
    if (!email || !password || !full_name) {
      return NextResponse.json({ error: 'Email, password, and full name are required' }, { status: 400 })
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }

    // Ensure org_id matches the admin's org
    if (org_id !== profile.org_id) {
      return NextResponse.json({ error: 'Cannot create users in a different organization' }, { status: 403 })
    }

    // Create admin client to create auth user
    const adminClient = createAdminClient()

    // Create the auth user
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email
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

    // Create the user profile in the users table
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
      // Try to clean up the auth user if profile creation fails
      await adminClient.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ error: 'Failed to create user profile' }, { status: 500 })
    }

    // Add individual permissions if provided
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
        // Don't fail the whole operation, just log the error
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

// GET - List users (optional, for future use)
export async function GET() {
  const supabase = createServerClient()
  
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
