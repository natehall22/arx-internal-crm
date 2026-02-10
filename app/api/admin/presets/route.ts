export const dynamic = "force-dynamic"
export const revalidate = 0
export const fetchCache = "force-no-store"

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

function getSupabaseClient() {
  const cookieStore = cookies()
  
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // Ignore in read-only contexts
          }
        },
      },
    }
  )
}

// GET - List all permission presets for the org
export async function GET() {
  const supabase = getSupabaseClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  // Get presets with their permissions
  const { data: presets, error } = await supabase
    .from('permission_presets')
    .select(`
      *,
      preset_permissions (
        permission_id,
        permissions (
          id,
          name,
          display_name,
          category
        )
      )
    `)
    .eq('org_id', profile.org_id)
    .order('sort_order')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ presets })
}

// POST - Create a new permission preset
export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient()
  
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
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { name, description, base_role, color, permission_ids } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  // Get max sort order
  const { data: maxOrder } = await supabase
    .from('permission_presets')
    .select('sort_order')
    .eq('org_id', profile.org_id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .single()

  const sortOrder = (maxOrder?.sort_order || 0) + 1

  // Create the preset
  const { data: preset, error: presetError } = await supabase
    .from('permission_presets')
    .insert({
      org_id: profile.org_id,
      name: name.trim(),
      description: description?.trim() || null,
      base_role: base_role || 'sales_rep',
      color: color || 'gray',
      is_system: false,
      sort_order: sortOrder,
      created_by: user.id,
    })
    .select()
    .single()

  if (presetError) {
    if (presetError.message.includes('duplicate')) {
      return NextResponse.json({ error: 'A preset with this name already exists' }, { status: 400 })
    }
    return NextResponse.json({ error: presetError.message }, { status: 500 })
  }

  // Add permissions
  if (permission_ids && Array.isArray(permission_ids) && permission_ids.length > 0) {
    const permInserts = permission_ids.map((permId: string) => ({
      preset_id: preset.id,
      permission_id: permId,
    }))

    await supabase.from('preset_permissions').insert(permInserts)
  }

  return NextResponse.json({ preset })
}

// PUT - Update a permission preset
export async function PUT(request: NextRequest) {
  const supabase = getSupabaseClient()
  
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
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { id, name, description, base_role, color, permission_ids } = body

  if (!id) {
    return NextResponse.json({ error: 'Preset ID is required' }, { status: 400 })
  }

  // Verify preset belongs to org
  const { data: existing } = await supabase
    .from('permission_presets')
    .select('id, org_id, is_system')
    .eq('id', id)
    .single()

  if (!existing || existing.org_id !== profile.org_id) {
    return NextResponse.json({ error: 'Preset not found' }, { status: 404 })
  }

  // Update the preset
  const { error: updateError } = await supabase
    .from('permission_presets')
    .update({
      name: name?.trim(),
      description: description?.trim() || null,
      base_role: base_role || 'sales_rep',
      color: color || 'gray',
    })
    .eq('id', id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // Update permissions - delete existing and re-add
  await supabase.from('preset_permissions').delete().eq('preset_id', id)

  if (permission_ids && Array.isArray(permission_ids) && permission_ids.length > 0) {
    const permInserts = permission_ids.map((permId: string) => ({
      preset_id: id,
      permission_id: permId,
    }))

    await supabase.from('preset_permissions').insert(permInserts)
  }

  return NextResponse.json({ success: true })
}

// DELETE - Delete a permission preset
export async function DELETE(request: NextRequest) {
  const supabase = getSupabaseClient()
  
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
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const presetId = request.nextUrl.searchParams.get('id')
  if (!presetId) {
    return NextResponse.json({ error: 'Preset ID is required' }, { status: 400 })
  }

  // Verify preset belongs to org and is not a system preset
  const { data: existing } = await supabase
    .from('permission_presets')
    .select('id, org_id, is_system')
    .eq('id', presetId)
    .single()

  if (!existing || existing.org_id !== profile.org_id) {
    return NextResponse.json({ error: 'Preset not found' }, { status: 404 })
  }

  if (existing.is_system) {
    return NextResponse.json({ error: 'System presets cannot be deleted' }, { status: 400 })
  }

  // Delete preset (cascade will delete preset_permissions)
  const { error } = await supabase
    .from('permission_presets')
    .delete()
    .eq('id', presetId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
