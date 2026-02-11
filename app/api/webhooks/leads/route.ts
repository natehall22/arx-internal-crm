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
  try {
    // Check for API key authentication
    const authHeader = request.headers.get('authorization')
    const apiKey = request.headers.get('x-api-key')
    const webhookSecret = process.env.WEBHOOK_SECRET || process.env.LEADS_WEBHOOK_SECRET
    
    // Validate authentication - check bearer token or x-api-key header
    const providedKey = authHeader?.replace('Bearer ', '') || apiKey
    
    if (!webhookSecret) {
      console.error('WEBHOOK_SECRET or LEADS_WEBHOOK_SECRET not configured')
      // For initial setup, allow requests but log warning
      console.warn('WARNING: Webhook endpoint is not secured. Set WEBHOOK_SECRET in environment variables.')
    } else if (providedKey !== webhookSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    
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
      return NextResponse.json({ 
        error: 'org_id is required. Get your org_id from the admin settings.' 
      }, { status: 400 })
    }

    const adminClient = getAdminClient()

    // Verify org exists
    const { data: org } = await adminClient
      .from('orgs')
      .select('id, settings')
      .eq('id', org_id)
      .single()

    if (!org) {
      return NextResponse.json({ error: 'Invalid org_id' }, { status: 400 })
    }

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

    // Create the lead
    const { data: lead, error: leadError } = await adminClient
      .from('leads')
      .insert({
        org_id,
        owner_user_id: ownerUserId,
        homeowner_name: fullName || null,
        phone: phone || null,
        email: email || null,
        address_text: fullAddress || null,
        source: source || 'web',
        channel: 'inbound',
        status: 'new',
        notes: leadNotes.trim() || null,
      })
      .select('id')
      .single()

    if (leadError) {
      console.error('Lead creation error:', leadError)
      return NextResponse.json({ 
        error: `Failed to create lead: ${leadError.message}` 
      }, { status: 400 })
    }

    // Create an activity for the new lead
    await adminClient.from('activities').insert({
      org_id,
      lead_id: lead.id,
      user_id: ownerUserId,
      type: 'lead_created',
      body: `New web lead received: ${fullName || 'Unknown'}`,
    })

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

    return NextResponse.json({ 
      success: true,
      lead_id: lead.id,
      message: 'Lead created successfully'
    })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to process lead' 
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
