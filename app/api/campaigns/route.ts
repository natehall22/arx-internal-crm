import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET - List all campaigns
export async function GET(request: NextRequest) {
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

  // Check permission
  const allowedRoles = ['admin', 'regional_manager', 'operations']
  const { data: hasPermission } = await supabase
    .from('user_permissions')
    .select('id')
    .eq('user_id', user.id)
    .eq('permissions.name', 'campaigns:view')
    .maybeSingle()

  if (!allowedRoles.includes(profile.role) && !hasPermission) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const activeOnly = request.nextUrl.searchParams.get('active') === 'true'

  let query = supabase
    .from('campaigns')
    .select('*')
    .eq('org_id', profile.org_id)
    .order('created_at', { ascending: false })

  if (activeOnly) {
    query = query.eq('is_active', true)
  }

  const { data: campaigns, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const campaignIds = (campaigns || []).map((campaign) => campaign.id)
  let leadCounts = new Map<string, number>()

  if (campaignIds.length > 0) {
    const { data: leadRows, error: leadCountError } = await supabase
      .from('leads')
      .select('campaign_id')
      .eq('org_id', profile.org_id)
      .in('campaign_id', campaignIds)

    if (leadCountError) {
      return NextResponse.json({ error: leadCountError.message }, { status: 500 })
    }

    leadCounts = new Map<string, number>()
    for (const row of leadRows || []) {
      if (!row.campaign_id) continue
      leadCounts.set(row.campaign_id, (leadCounts.get(row.campaign_id) || 0) + 1)
    }
  }

  return NextResponse.json({
    campaigns: (campaigns || []).map((campaign) => ({
      ...campaign,
      total_leads: leadCounts.get(campaign.id) || 0,
    })),
  })
}

// POST - Create a new campaign
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
    description,
    source_type,
    channel,
    budget,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_term,
    utm_content,
    google_campaign_id,
    google_ads_campaign_id,
    facebook_campaign_id,
    external_id,
    start_date,
    end_date,
  } = body

  const resolvedGoogleCampaignId = google_campaign_id || google_ads_campaign_id || null

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const { data: campaign, error } = await supabase
    .from('campaigns')
    .insert({
      org_id: profile.org_id,
      name: name.trim(),
      description: description?.trim() || null,
      source_type: source_type || 'other',
      channel: channel || 'inbound',
      budget: budget || null,
      utm_source: utm_source || null,
      utm_medium: utm_medium || null,
      utm_campaign: utm_campaign || null,
      utm_term: utm_term || null,
      utm_content: utm_content || null,
      google_campaign_id: resolvedGoogleCampaignId,
      google_ads_campaign_id: resolvedGoogleCampaignId,
      facebook_campaign_id: facebook_campaign_id || null,
      external_id: external_id || null,
      start_date: start_date || null,
      end_date: end_date || null,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    if (error.message.includes('duplicate')) {
      return NextResponse.json({ error: 'A campaign with this name already exists' }, { status: 400 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ campaign })
}

// PUT - Update a campaign
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
    return NextResponse.json({ error: 'Campaign ID is required' }, { status: 400 })
  }

  // Verify campaign belongs to org
  const { data: existing } = await supabase
    .from('campaigns')
    .select('id')
    .eq('id', id)
    .eq('org_id', profile.org_id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  const { error } = await supabase
    .from('campaigns')
    .update(updates)
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// DELETE - Delete a campaign
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

  const campaignId = request.nextUrl.searchParams.get('id')
  if (!campaignId) {
    return NextResponse.json({ error: 'Campaign ID is required' }, { status: 400 })
  }

  // Verify campaign belongs to org
  const { data: existing } = await supabase
    .from('campaigns')
    .select('id')
    .eq('id', campaignId)
    .eq('org_id', profile.org_id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  const { error } = await supabase
    .from('campaigns')
    .delete()
    .eq('id', campaignId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
