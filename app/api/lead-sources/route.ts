import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET - List all lead sources
export async function GET() {
  const supabase = createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('users')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  // Only admins can view lead sources
  if (!['admin', 'regional_manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: leadSources, error } = await supabase
    .from('lead_sources')
    .select(`
      *,
      campaigns (id, name),
      auto_assign_user:users!lead_sources_auto_assign_user_id_fkey (id, full_name, email),
      auto_assign_team:teams!lead_sources_auto_assign_team_id_fkey (id, name)
    `)
    .eq('org_id', profile.org_id)
    .order('name')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ leadSources })
}

// POST - Create a new lead source
export async function POST(request: NextRequest) {
  const supabase = createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('users')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'regional_manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const {
    name,
    source_type,
    default_campaign_id,
    field_mapping,
    auto_assign_user_id,
    auto_assign_team_id,
    round_robin_enabled,
    notify_on_new_lead,
    notification_emails,
  } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  if (!source_type) {
    return NextResponse.json({ error: 'Source type is required' }, { status: 400 })
  }

  const { data: leadSource, error } = await supabase
    .from('lead_sources')
    .insert({
      org_id: profile.org_id,
      name: name.trim(),
      source_type,
      default_campaign_id: default_campaign_id || null,
      field_mapping: field_mapping || null,
      auto_assign_user_id: auto_assign_user_id || null,
      auto_assign_team_id: auto_assign_team_id || null,
      round_robin_enabled: round_robin_enabled || false,
      notify_on_new_lead: notify_on_new_lead !== false,
      notification_emails: notification_emails || null,
    })
    .select()
    .single()

  if (error) {
    if (error.message.includes('duplicate')) {
      return NextResponse.json({ error: 'A lead source with this name already exists' }, { status: 400 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ leadSource })
}

// PUT - Update a lead source
export async function PUT(request: NextRequest) {
  const supabase = createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('users')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'regional_manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { id, ...updates } = body

  if (!id) {
    return NextResponse.json({ error: 'Lead source ID is required' }, { status: 400 })
  }

  // Verify lead source belongs to org
  const { data: existing } = await supabase
    .from('lead_sources')
    .select('id')
    .eq('id', id)
    .eq('org_id', profile.org_id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Lead source not found' }, { status: 404 })
  }

  const { error } = await supabase
    .from('lead_sources')
    .update(updates)
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// DELETE - Delete a lead source
export async function DELETE(request: NextRequest) {
  const supabase = createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('users')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'regional_manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sourceId = request.nextUrl.searchParams.get('id')
  if (!sourceId) {
    return NextResponse.json({ error: 'Lead source ID is required' }, { status: 400 })
  }

  // Verify lead source belongs to org
  const { data: existing } = await supabase
    .from('lead_sources')
    .select('id')
    .eq('id', sourceId)
    .eq('org_id', profile.org_id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Lead source not found' }, { status: 404 })
  }

  const { error } = await supabase
    .from('lead_sources')
    .delete()
    .eq('id', sourceId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
