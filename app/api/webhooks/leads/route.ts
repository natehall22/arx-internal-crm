import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

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

function getMailTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
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
    
    // Extract org_id first (required)
    const org_id = body.org_id || body.orgId || body.organization_id

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

    // Extract contact info - handle many common field name variations
    const firstName = body.first_name || body.firstName || body.firstname || body.fname || body.given_name || ''
    const lastName = body.last_name || body.lastName || body.lastname || body.lname || body.family_name || body.surname || ''
    const fullNameDirect = body.name || body.full_name || body.fullName || body.homeowner_name || body.homeownerName || body.customer_name || body.customerName || ''
    
    // Build the full name - prefer direct full name, otherwise combine first + last
    let fullName = fullNameDirect.trim()
    if (!fullName && (firstName || lastName)) {
      fullName = [firstName, lastName].filter(Boolean).join(' ').trim()
    }
    
    console.log('Name fields:', { firstName, lastName, fullNameDirect, resolvedFullName: fullName })

    // Extract phone - handle variations
    const phone = body.phone || body.phone_number || body.phoneNumber || body.telephone || body.tel || body.mobile || body.cell || ''

    // Extract email - handle variations  
    const email = body.email || body.email_address || body.emailAddress || body.e_mail || ''

    // Extract address - handle variations
    const street = body.street || body.street_address || body.streetAddress || body.address1 || body.address_line_1 || ''
    const city = body.city || ''
    const state = body.state || body.province || body.region || ''
    const zip = body.zip || body.zipcode || body.zip_code || body.postal_code || body.postalCode || ''
    const addressDirect = body.address || body.address_text || body.full_address || body.fullAddress || ''

    // Build the full address
    let fullAddress = addressDirect.trim()
    if (!fullAddress && (street || city || state || zip)) {
      fullAddress = [street, city, state, zip].filter(Boolean).join(', ').trim()
    }

    // Extract optional fields
    const source = body.source || body.lead_source || body.leadSource || 'web'
    const notes = body.notes || body.note || ''
    const message = body.message || body.comments || body.comment || body.inquiry || body.description || ''
    const service_type = body.service_type || body.serviceType || body.service || ''
    const project_type = body.project_type || body.projectType || body.project || ''
    const custom_fields = body.custom_fields || body.customFields || body.custom || body.metadata || null

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

    // Notify internal team about inbound lead creation.
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://arx-internal-crm.vercel.app'
      const leadUrl = `${appUrl}/leads/${lead.id}`
      const sourceLabel = String(source || 'web')

      const transporter = getMailTransport()
      await transporter.sendMail({
        from: 'info@arxroofing.com',
        to: 'nathan@arxroofing.com',
        subject: `${sourceLabel} (inbound lead)`,
        text: `A new inbound lead was created.\n\nSource: ${sourceLabel}\nLead URL: ${leadUrl}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
            <h2 style="margin: 0 0 12px; color: #111827;">New Inbound Lead</h2>
            <p style="color: #374151; margin: 0 0 10px;"><strong>Source:</strong> ${sourceLabel}</p>
            <p style="margin: 0;">
              <a href="${leadUrl}" style="color: #4f46e5; text-decoration: none;">Open lead in CRM</a>
            </p>
          </div>
        `,
      })
    } catch (emailError) {
      // Non-blocking: lead intake should still succeed if email fails.
      console.error('Failed to send inbound lead notification email:', emailError)
    }
    
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
    authentication: 'Bearer token or x-api-key header with WEBHOOK_SECRET (optional)',
    required_fields: ['org_id'],
    field_mappings: {
      org_id: ['org_id', 'orgId', 'organization_id'],
      name: ['name', 'full_name', 'fullName', 'homeowner_name', 'customer_name', 'first_name + last_name'],
      first_name: ['first_name', 'firstName', 'firstname', 'fname', 'given_name'],
      last_name: ['last_name', 'lastName', 'lastname', 'lname', 'family_name', 'surname'],
      phone: ['phone', 'phone_number', 'phoneNumber', 'telephone', 'tel', 'mobile', 'cell'],
      email: ['email', 'email_address', 'emailAddress', 'e_mail'],
      address: ['address', 'address_text', 'full_address', 'street + city + state + zip'],
      street: ['street', 'street_address', 'streetAddress', 'address1', 'address_line_1'],
      city: ['city'],
      state: ['state', 'province', 'region'],
      zip: ['zip', 'zipcode', 'zip_code', 'postal_code', 'postalCode'],
      source: ['source', 'lead_source', 'leadSource'],
      message: ['message', 'comments', 'comment', 'inquiry', 'description', 'notes'],
    },
    example_payloads: {
      with_full_name: {
        org_id: 'your-org-uuid',
        name: 'John Smith',
        phone: '555-123-4567',
        email: 'john@example.com',
        address: '123 Main St, City, ST 12345',
        message: 'I need a roof inspection',
      },
      with_separate_names: {
        org_id: 'your-org-uuid',
        first_name: 'John',
        last_name: 'Smith',
        phone: '555-123-4567',
        email: 'john@example.com',
        street: '123 Main St',
        city: 'Springfield',
        state: 'IL',
        zip: '62701',
        message: 'I need a roof inspection',
      },
      camelCase_format: {
        orgId: 'your-org-uuid',
        firstName: 'John',
        lastName: 'Smith',
        phoneNumber: '555-123-4567',
        emailAddress: 'john@example.com',
        streetAddress: '123 Main St',
        city: 'Springfield',
        state: 'IL',
        postalCode: '62701',
        comments: 'I need a roof inspection',
      }
    }
  })
}
