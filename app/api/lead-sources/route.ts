import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

// GET - List all lead sources
export async function GET() {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // RLS-bound client: this route's reads/writes rely on the org policies on the
  // tables below, so it must stay the caller's client rather than a service client.
  const supabase = createClient()

  // Only admins can view lead sources
  if (!['admin', 'regional_manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: leadSources, error } = await supabase
    .from('lead_sources')
    .select(`
      *,
      campaigns (id, name),
      auto_assign_user:users!lead_sources_auto_assign_user_id_fkey (id, full_name, email)
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
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // RLS-bound client: this route's reads/writes rely on the org policies on the
  // tables below, so it must stay the caller's client rather than a service client.
  const supabase = createClient()

  if (!['admin', 'regional_manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const {
    name,
    source_type,
    default_campaign_id,
    field_mapping,
    auto_assign_user_id,
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
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // RLS-bound client: this route's reads/writes rely on the org policies on the
  // tables below, so it must stay the caller's client rather than a service client.
  const supabase = createClient()

  if (!['admin', 'regional_manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { id } = body

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
    .update({
      name: typeof body.name === 'string' ? body.name.trim() : undefined,
      source_type: body.source_type,
      default_campaign_id: body.default_campaign_id || null,
      field_mapping: body.field_mapping || null,
      auto_assign_user_id: body.auto_assign_user_id || null,
      webhook_enabled: body.webhook_enabled,
      is_active: body.is_active,
    })
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// DELETE - Delete a lead source
export async function DELETE(request: NextRequest) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // RLS-bound client: this route's reads/writes rely on the org policies on the
  // tables below, so it must stay the caller's client rather than a service client.
  const supabase = createClient()

  if (!['admin', 'regional_manager'].includes(profile.role)) {
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
