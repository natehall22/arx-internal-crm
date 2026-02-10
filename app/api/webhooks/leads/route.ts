import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Use service role for webhook ingestion (no auth context)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

/**
 * POST /api/webhooks/leads?token=xxx
 * 
 * Receives leads from external sources (website forms, Google Ads, Facebook, etc.)
 * 
 * Required query param: token (the webhook_token from lead_sources table)
 * 
 * Expected body formats:
 * 
 * Standard format:
 * {
 *   "name": "John Doe",
 *   "email": "john@example.com",
 *   "phone": "555-123-4567",
 *   "address": "123 Main St, City, ST 12345",
 *   "message": "I need a new roof",
 *   "utm_source": "google",
 *   "utm_medium": "cpc",
 *   "utm_campaign": "spring_sale"
 * }
 * 
 * Google Ads format:
 * {
 *   "lead_id": "xxx",
 *   "user_column_data": [
 *     {"column_id": "FULL_NAME", "string_value": "John Doe"},
 *     {"column_id": "EMAIL", "string_value": "john@example.com"},
 *     ...
 *   ]
 * }
 * 
 * Facebook format:
 * {
 *   "entry": [{
 *     "changes": [{
 *       "value": {
 *         "leadgen_id": "xxx",
 *         "field_data": [
 *           {"name": "full_name", "values": ["John Doe"]},
 *           {"name": "email", "values": ["john@example.com"]},
 *           ...
 *         ]
 *       }
 *     }]
 *   }]
 * }
 */
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  
  if (!token) {
    return NextResponse.json(
      { error: 'Missing webhook token' },
      { status: 401 }
    )
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase configuration')
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Look up the lead source by token
  const { data: leadSource, error: sourceError } = await supabase
    .from('lead_sources')
    .select(`
      *,
      campaigns (id, name, utm_source, utm_medium, utm_campaign)
    `)
    .eq('webhook_token', token)
    .eq('webhook_enabled', true)
    .single()

  if (sourceError || !leadSource) {
    console.error('Invalid webhook token:', token)
    return NextResponse.json(
      { error: 'Invalid or disabled webhook token' },
      { status: 401 }
    )
  }

  if (!leadSource.is_active) {
    return NextResponse.json(
      { error: 'Lead source is inactive' },
      { status: 403 }
    )
  }

  // Parse the incoming payload
  let body: any
  try {
    body = await request.json()
  } catch (e) {
    return NextResponse.json(
      { error: 'Invalid JSON payload' },
      { status: 400 }
    )
  }

  // Get request metadata
  const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0] || 
                    request.headers.get('x-real-ip') ||
                    null
  const userAgent = request.headers.get('user-agent')
  const referrer = request.headers.get('referer')

  // Normalize the payload based on source type
  const normalizedData = normalizeLeadData(body, leadSource.source_type, leadSource.field_mapping)

  // Build the lead record
  const leadData: any = {
    org_id: leadSource.org_id,
    lead_source_id: leadSource.id,
    campaign_id: leadSource.default_campaign_id,
    source_type: leadSource.source_type,
    channel: 'inbound',
    status: 'new',
    
    // Contact info
    homeowner_name: normalizedData.name || null,
    email: normalizedData.email || null,
    phone: normalizedData.phone || null,
    address_text: normalizedData.address || null,
    notes: normalizedData.message || normalizedData.notes || null,
    
    // UTM tracking
    utm_source: normalizedData.utm_source || leadSource.campaigns?.utm_source || null,
    utm_medium: normalizedData.utm_medium || leadSource.campaigns?.utm_medium || null,
    utm_campaign: normalizedData.utm_campaign || leadSource.campaigns?.utm_campaign || null,
    utm_term: normalizedData.utm_term || null,
    utm_content: normalizedData.utm_content || null,
    
    // External tracking
    external_lead_id: normalizedData.external_id || null,
    landing_page: normalizedData.landing_page || null,
    referrer_url: referrer || normalizedData.referrer || null,
    ip_address: ipAddress,
    user_agent: userAgent,
    
    // Store raw payload for debugging
    raw_payload: body,
    
    // Source field (legacy)
    source: leadSource.name,
  }

  // Auto-assign if configured
  if (leadSource.auto_assign_user_id) {
    leadData.owner_user_id = leadSource.auto_assign_user_id
  }

  // Create the lead
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .insert(leadData)
    .select()
    .single()

  if (leadError) {
    console.error('Error creating lead:', leadError)
    return NextResponse.json(
      { error: 'Failed to create lead', details: leadError.message },
      { status: 500 }
    )
  }

  // Add to inbound queue if not auto-assigned
  if (!leadSource.auto_assign_user_id) {
    const queueData: any = {
      org_id: leadSource.org_id,
      lead_id: lead.id,
      lead_source_id: leadSource.id,
      campaign_id: leadSource.default_campaign_id,
      status: 'pending',
      priority: getPriorityFromSource(leadSource.source_type),
    }

    await supabase.from('inbound_lead_queue').insert(queueData)
  }

  // Create notification if enabled
  if (leadSource.notify_on_new_lead) {
    await createLeadNotification(supabase, leadSource, lead)
  }

  return NextResponse.json({
    success: true,
    lead_id: lead.id,
    message: 'Lead created successfully',
  })
}

// GET endpoint for webhook verification (Facebook requires this)
export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('hub.mode')
  const token = request.nextUrl.searchParams.get('hub.verify_token')
  const challenge = request.nextUrl.searchParams.get('hub.challenge')

  // Facebook webhook verification
  if (mode === 'subscribe' && token && challenge) {
    // Verify the token matches one of our lead sources
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    
    const { data: leadSource } = await supabase
      .from('lead_sources')
      .select('id')
      .eq('webhook_token', token)
      .single()

    if (leadSource) {
      return new NextResponse(challenge, { status: 200 })
    }
  }

  return NextResponse.json({ status: 'ok' })
}

/**
 * Normalize lead data from various formats
 */
function normalizeLeadData(
  body: any, 
  sourceType: string, 
  fieldMapping: any
): Record<string, string | null> {
  const result: Record<string, string | null> = {}

  // Handle Google Ads lead form format
  if (body.lead_id && body.user_column_data) {
    result.external_id = body.lead_id
    for (const col of body.user_column_data || []) {
      const columnId = col.column_id?.toLowerCase()
      const value = col.string_value || col.value
      
      if (columnId?.includes('name') || columnId === 'full_name') {
        result.name = value
      } else if (columnId?.includes('email')) {
        result.email = value
      } else if (columnId?.includes('phone')) {
        result.phone = value
      } else if (columnId?.includes('address') || columnId?.includes('street')) {
        result.address = value
      } else if (columnId?.includes('city')) {
        result.address = (result.address || '') + ', ' + value
      } else if (columnId?.includes('state')) {
        result.address = (result.address || '') + ', ' + value
      } else if (columnId?.includes('zip') || columnId?.includes('postal')) {
        result.address = (result.address || '') + ' ' + value
      }
    }
    return result
  }

  // Handle Facebook lead form format
  if (body.entry?.[0]?.changes?.[0]?.value?.field_data) {
    const leadData = body.entry[0].changes[0].value
    result.external_id = leadData.leadgen_id
    
    for (const field of leadData.field_data || []) {
      const fieldName = field.name?.toLowerCase()
      const value = field.values?.[0]
      
      if (fieldName?.includes('name') || fieldName === 'full_name') {
        result.name = value
      } else if (fieldName?.includes('email')) {
        result.email = value
      } else if (fieldName?.includes('phone')) {
        result.phone = value
      } else if (fieldName?.includes('address') || fieldName?.includes('street')) {
        result.address = value
      } else if (fieldName?.includes('city')) {
        result.address = (result.address || '') + ', ' + value
      } else if (fieldName?.includes('state')) {
        result.address = (result.address || '') + ', ' + value
      } else if (fieldName?.includes('zip') || fieldName?.includes('postal')) {
        result.address = (result.address || '') + ' ' + value
      }
    }
    return result
  }

  // Standard format - use field mapping
  const mapping = fieldMapping || {
    name: 'name',
    email: 'email',
    phone: 'phone',
    address: 'address',
    message: 'notes',
  }

  // Map fields using the configured mapping
  for (const [targetField, sourceField] of Object.entries(mapping)) {
    if (typeof sourceField === 'string') {
      // Simple field mapping
      result[targetField] = getNestedValue(body, sourceField)
    } else if (Array.isArray(sourceField)) {
      // Try multiple source fields
      for (const sf of sourceField) {
        const value = getNestedValue(body, sf)
        if (value) {
          result[targetField] = value
          break
        }
      }
    }
  }

  // Also grab UTM params directly
  result.utm_source = body.utm_source || body.utmSource || null
  result.utm_medium = body.utm_medium || body.utmMedium || null
  result.utm_campaign = body.utm_campaign || body.utmCampaign || null
  result.utm_term = body.utm_term || body.utmTerm || null
  result.utm_content = body.utm_content || body.utmContent || null
  result.landing_page = body.landing_page || body.landingPage || body.page_url || null
  result.referrer = body.referrer || body.referer || null
  result.external_id = body.external_id || body.lead_id || body.id || null

  return result
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: any, path: string): string | null {
  const parts = path.split('.')
  let value = obj
  
  for (const part of parts) {
    if (value === null || value === undefined) return null
    value = value[part]
  }
  
  return typeof value === 'string' ? value : 
         typeof value === 'number' ? String(value) : 
         null
}

/**
 * Get priority based on source type
 */
function getPriorityFromSource(sourceType: string): number {
  const priorities: Record<string, number> = {
    'google_ads': 10,
    'facebook': 8,
    'website': 7,
    'phone_call': 9,
    'walk_in': 10,
    'referral': 8,
    'instagram': 6,
    'tiktok': 5,
    'youtube': 5,
    'bing_ads': 7,
    'home_show': 6,
    'partner': 7,
    'other': 3,
  }
  return priorities[sourceType] || 5
}

/**
 * Create notification for new lead
 */
async function createLeadNotification(
  supabase: any,
  leadSource: any,
  lead: any
) {
  // Get users to notify
  const usersToNotify: string[] = []

  // If auto-assigned, notify that user
  if (leadSource.auto_assign_user_id) {
    usersToNotify.push(leadSource.auto_assign_user_id)
  }

  // Get admins and users with inbound permission
  const { data: adminUsers } = await supabase
    .from('users')
    .select('id')
    .eq('org_id', leadSource.org_id)
    .in('role', ['admin', 'regional_manager'])
    .eq('active', true)

  for (const user of adminUsers || []) {
    if (!usersToNotify.includes(user.id)) {
      usersToNotify.push(user.id)
    }
  }

  // Create notifications
  const notifications = usersToNotify.map(userId => ({
    org_id: leadSource.org_id,
    user_id: userId,
    type: 'new_inbound_lead',
    title: 'New Inbound Lead',
    message: `New lead from ${leadSource.name}: ${lead.homeowner_name || lead.email || 'Unknown'}`,
    link: `/leads/${lead.id}`,
    read: false,
  }))

  if (notifications.length > 0) {
    await supabase.from('notifications').insert(notifications)
  }
}
