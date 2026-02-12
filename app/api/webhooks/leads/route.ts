import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// This endpoint receives leads from external sources (websites, forms, etc.)
// It can be called with an API key for authentication

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// POST - Create a new lead from external source
export async function POST(request: NextRequest) {
  console.log('=== Webhook Lead Request ===')
  
  try {
    // Check for API key authentication
    const authHeader = request.headers.get('authorization')
    const apiKey = request.headers.get('x-api-key')
    const webhookSecret = process.env.WEBHOOK_SECRET || process.env.LEADS_WEBHOOK_SECRET
    
    // Validate authentication - check bearer token or x-api-key header
    const providedKey = authHeader?.replace('Bearer ', '') || apiKey
    
    if (!webhookSecret) {
      console.warn('WARNING: Webhook endpoint is not secured. Set WEBHOOK_SECRET in environment variables.')
      // For initial setup, allow requests but log warning
    } else if (providedKey && providedKey !== webhookSecret) {
      console.error('Invalid API key provided')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: any
    try {
      body = await request.json()
      console.log('Received payload:', JSON.stringify(body, null, 2))
    } catch (parseError) {
      console.error('Failed to parse JSON body:', parseError)
      return NextResponse.json({ 
        error: 'Invalid JSON in request body' 
      }, { status: 400 })
    }
    
    // Required fields
    const {
      org_id,
      // Contact info
      name,
      homeowner_name,
      first_name,
      last_name,
      phone,
      email,
      // Address
      address,
      address_text,
      street,
      city,
      state,
      zip,
      // Optional
      source,
      notes,
      message,
      service_type,
      project_type,
      // Custom fields
      custom_fields,
    } = body

    if (!org_id) {
      console.error('Missing org_id in payload')
      return NextResponse.json({ 
        error: 'org_id is required. Get your org_id from the admin settings.' 
      }, { status: 400 })
    }

    // Validate org_id format (should be a UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(org_id)) {
      console.error('Invalid org_id format:', org_id)
      return NextResponse.json({ 
        error: 'Invalid org_id format. Must be a valid UUID.' 
      }, { status: 400 })
    }

    const adminClient = getAdminClient()

    // Verify org exists
    const { data: org, error: orgError } = await adminClient
      .from('orgs')
      .select('id, settings')
      .eq('id', org_id)
      .single()

    if (orgError) {
      console.error('Org lookup error:', orgError)
      return NextResponse.json({ 
        error: `Failed to verify org: ${orgError.message}` 
      }, { status: 500 })
    }

    if (!org) {
      console.error('Org not found for id:', org_id)
      return NextResponse.json({ error: 'Invalid org_id - organization not found' }, { status: 400 })
    }

    console.log('Found org:', org.id)

    // Build the full name
    let fullName = homeowner_name || name
    if (!fullName && (first_name || last_name)) {
      fullName = [first_name, last_name].filter(Boolean).join(' ')
    }

    // Build the full address
    let fullAddress = address_text || address
    if (!fullAddress && (street || city || state || zip)) {
      fullAddress = [street, city, state, zip].filter(Boolean).join(', ')
    }

    // Build notes from message and any custom fields
    let leadNotes = notes || message || ''
    if (service_type) {
      leadNotes = `Service requested: ${service_type}\n${leadNotes}`
    }
    if (project_type) {
      leadNotes = `Project type: ${project_type}\n${leadNotes}`
    }
    if (custom_fields && typeof custom_fields === 'object') {
      const customFieldsText = Object.entries(custom_fields)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n')
      if (customFieldsText) {
        leadNotes = `${leadNotes}\n\nAdditional Info:\n${customFieldsText}`
      }
    }

    // Find the user assigned to web leads (if configured in org settings)
    let ownerUserId: string | null = null
    if (org.settings?.web_leads_owner_id) {
      ownerUserId = org.settings.web_leads_owner_id
    } else {
      // Default to first admin user in the org
      const { data: adminUser } = await adminClient
        .from('users')
        .select('id')
        .eq('org_id', org_id)
        .eq('role', 'admin')
        .limit(1)
        .single()
      
      ownerUserId = adminUser?.id || null
    }

    // Build lead data - only include fields that exist
    const leadData: Record<string, any> = {
      org_id,
      owner_user_id: ownerUserId,
      homeowner_name: fullName || null,
      phone: phone || null,
      email: email || null,
      address_text: fullAddress || null,
      source: source || 'web',
      status: 'new',
      notes: leadNotes.trim() || null,
    }

    // Try to create the lead with channel field first
    let lead: { id: string } | null = null
    let leadError: any = null

    // First attempt: with channel field
    const { data: leadWithChannel, error: errorWithChannel } = await adminClient
      .from('leads')
      .insert({ ...leadData, channel: 'inbound' })
      .select('id')
      .single()

    if (errorWithChannel) {
      // If channel column doesn't exist, try without it
      if (errorWithChannel.message?.includes('channel') || errorWithChannel.code === '42703') {
        console.log('Channel column not found, inserting without it')
        const { data: leadWithoutChannel, error: errorWithoutChannel } = await adminClient
          .from('leads')
          .insert(leadData)
          .select('id')
          .single()
        
        lead = leadWithoutChannel
        leadError = errorWithoutChannel
      } else {
        leadError = errorWithChannel
      }
    } else {
      lead = leadWithChannel
    }

    if (leadError) {
      console.error('Lead creation error:', leadError)
      return NextResponse.json({ 
        error: `Failed to create lead: ${leadError.message}` 
      }, { status: 500 })
    }

    if (!lead) {
      return NextResponse.json({ 
        error: 'Failed to create lead: Unknown error' 
      }, { status: 500 })
    }

    // Create an activity for the new lead (use 'note' type which is valid in the enum)
    try {
      await adminClient.from('activities').insert({
        org_id,
        lead_id: lead.id,
        user_id: ownerUserId,
        type: 'note',
        body: `New web lead received: ${fullName || 'Unknown'}`,
      })
    } catch (activityError) {
      console.log('Could not create activity:', activityError)
      // Non-critical, continue
    }

    // Create a notification for the assigned user (if notifications table exists)
    try {
      await adminClient.from('notifications').insert({
        org_id,
        user_id: ownerUserId,
        type: 'new_lead',
        title: 'New Web Lead',
        body: `New lead from website: ${fullName || 'Unknown'} - ${phone || email || 'No contact info'}`,
        data: { lead_id: lead.id },
        read: false,
      })
    } catch (e) {
      // Notifications table might not exist, that's ok
      console.log('Could not create notification (table may not exist)')
    }

    console.log('Lead created successfully:', lead.id)
    
    return NextResponse.json({ 
      success: true,
      lead_id: lead.id,
      message: 'Lead created successfully'
    })
  } catch (error) {
    console.error('Webhook error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to process lead'
    return NextResponse.json({ 
      error: errorMessage,
      details: error instanceof Error ? error.stack : undefined
    }, { status: 500 })
  }
}

// GET - Return webhook info and test endpoint
export async function GET(request: NextRequest) {
  return NextResponse.json({
    status: 'active',
    endpoint: '/api/webhooks/leads',
    method: 'POST',
    description: 'Webhook endpoint for receiving leads from external sources',
    authentication: 'Bearer token or x-api-key header with WEBHOOK_SECRET',
    required_fields: ['org_id'],
    optional_fields: [
      'name', 'homeowner_name', 'first_name', 'last_name',
      'phone', 'email',
      'address', 'address_text', 'street', 'city', 'state', 'zip',
      'source', 'notes', 'message', 'service_type', 'project_type',
      'custom_fields'
    ],
    example_payload: {
      org_id: 'your-org-uuid',
      name: 'John Smith',
      phone: '555-123-4567',
      email: 'john@example.com',
      address: '123 Main St, City, ST 12345',
      source: 'web',
      message: 'I need a roof inspection',
      service_type: 'Roofing',
    }
  })
}
