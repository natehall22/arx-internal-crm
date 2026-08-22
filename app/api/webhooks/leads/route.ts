import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { getCrmEmailFrom } from '@/lib/crm-email-from'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const ALLOWED_ORIGINS = [
  'https://arxroofing.com',
  'https://www.arxroofing.com',
  'http://localhost:3000',
  'http://localhost:3001',
]

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, x-webhook-token',
    'Access-Control-Max-Age': '86400',
  }
}

// Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin')
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) })
}

// This endpoint receives leads from external sources (websites, forms, etc.)
// It can be called with an API key for authentication

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

type LeadSourceConfig = {
  id: string
  org_id: string
  name: string
  source_type: string | null
  default_campaign_id: string | null
  field_mapping: Record<string, string> | null
  auto_assign_user_id: string | null
  webhook_enabled: boolean
  is_active: boolean
}

function pickMappedField(body: Record<string, any>, mapping: Record<string, string> | null | undefined, target: string) {
  const mappedKey = mapping?.[target]
  if (mappedKey && body[mappedKey] != null) return body[mappedKey]
  return undefined
}

/**
 * Attach inbound leads to a CRM campaign when the payload names one.
 * - Prefer explicit campaign_id (must belong to this org)
 * - Else look up by campaign name (case-insensitive exact match)
 * - Else keep the lead source default_campaign_id
 * Existing callers that omit campaign* stay unchanged.
 */
async function resolveCampaignId(
  adminClient: ReturnType<typeof createServiceClient>,
  orgId: string,
  body: Record<string, any>,
  fallbackCampaignId: string | null
): Promise<string | null> {
  const campaignIdRaw = body.campaign_id || body.campaignId
  const campaignNameRaw = body.campaign || body.campaign_name || body.campaignName
  const campaignName =
    typeof campaignNameRaw === 'string' ? campaignNameRaw.trim() : ''

  if (typeof campaignIdRaw === 'string' && campaignIdRaw.trim()) {
    const { data, error } = await adminClient
      .from('campaigns')
      .select('id')
      .eq('org_id', orgId)
      .eq('id', campaignIdRaw.trim())
      .maybeSingle()

    if (error) {
      console.log('Lead webhook: campaign_id lookup failed:', error.message)
    } else if (data?.id) {
      return data.id
    } else {
      console.log('Lead webhook: campaign_id not found for org, using fallback')
    }
  }

  if (campaignName) {
    // Escape LIKE wildcards so payload names match literally (case-insensitive).
    const literalName = campaignName.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    const { data, error } = await adminClient
      .from('campaigns')
      .select('id')
      .eq('org_id', orgId)
      .ilike('name', literalName)
      .limit(1)
      .maybeSingle()

    if (error) {
      console.log('Lead webhook: campaign name lookup failed:', error.message)
    } else if (data?.id) {
      return data.id
    } else {
      console.log(
        `Lead webhook: campaign "${campaignName}" not found for org, using fallback`
      )
    }
  }

  return fallbackCampaignId
}

async function insertLeadWithSchemaFallback(adminClient: ReturnType<typeof createServiceClient>, leadData: Record<string, any>) {
  const insertData: Record<string, any> = { ...leadData, channel: 'inbound' }
  let lastError: any = null

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await adminClient
      .from('leads')
      .insert(insertData)
      .select('id')
      .single()

    if (!error) return { lead: data as { id: string }, error: null }

    lastError = error
    const missingColumn = error.message?.match(/Could not find the '([^']+)' column/)?.[1]
    if (missingColumn && missingColumn in insertData) {
      console.log(`Lead webhook insert: dropping unavailable optional column "${missingColumn}"`)
      delete insertData[missingColumn]
      continue
    }

    if ((error.message?.includes('channel') || error.code === '42703') && 'channel' in insertData) {
      console.log('Lead webhook insert: channel column not found, inserting without it')
      delete insertData.channel
      continue
    }

    break
  }

  return { lead: null, error: lastError }
}

async function syncCampaignLeadTotal(adminClient: ReturnType<typeof createServiceClient>, orgId: string, campaignId: string | null | undefined) {
  if (!campaignId) return

  const { count, error: countError } = await adminClient
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('campaign_id', campaignId)

  if (countError) {
    console.log('Could not count campaign leads:', countError)
    return
  }

  const { error: updateError } = await adminClient
    .from('campaigns')
    .update({ total_leads: count || 0 })
    .eq('org_id', orgId)
    .eq('id', campaignId)

  if (updateError) {
    console.log('Could not update campaign lead total:', updateError)
  }
}

// POST - Create a new lead from external source
export async function POST(request: NextRequest) {
  console.log('=== Webhook Lead Request ===')
  const origin = request.headers.get('origin')
  const cors = corsHeaders(origin)

  try {
    let body: any
    try {
      body = await request.json()
      console.log('Received payload:', JSON.stringify(body, null, 2))
    } catch (parseError) {
      console.error('Failed to parse JSON body:', parseError)
      return NextResponse.json({
        error: 'Invalid JSON in request body'
      }, { status: 400, headers: cors })
    }

    const adminClient = createServiceClient()

    // Check for API key authentication
    const authHeader = request.headers.get('authorization')
    const apiKey = request.headers.get('x-api-key')
    const sourceToken = request.nextUrl.searchParams.get('token') || request.headers.get('x-webhook-token')
    const webhookSecret = process.env.WEBHOOK_SECRET || process.env.LEADS_WEBHOOK_SECRET

    let leadSource: LeadSourceConfig | null = null
    if (sourceToken) {
      const { data, error } = await adminClient
        .from('lead_sources')
        .select('id, org_id, name, source_type, default_campaign_id, field_mapping, auto_assign_user_id, webhook_enabled, is_active')
        .eq('webhook_token', sourceToken)
        .single()

      if (error || !data) {
        console.error('Invalid lead source token:', error)
        return NextResponse.json({ error: 'Invalid webhook token' }, { status: 401, headers: cors })
      }

      if (!data.webhook_enabled || !data.is_active) {
        console.error('Lead source webhook is disabled:', data.id)
        return NextResponse.json({ error: 'Webhook is disabled for this lead source' }, { status: 403, headers: cors })
      }

      leadSource = data as LeadSourceConfig
    }

    const providedKey = authHeader?.replace('Bearer ', '') || apiKey
    if (webhookSecret && !leadSource && (!providedKey || providedKey !== webhookSecret)) {
      console.error('Invalid or missing API key')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors })
    }
    
    // Extract org_id first (required)
    const org_id = leadSource?.org_id || body.org_id || body.orgId || body.organization_id

    if (!org_id) {
      console.error('Missing org_id in payload')
      return NextResponse.json({
        error: 'org_id is required unless using a lead source webhook token.'
      }, { status: 400, headers: cors })
    }

    // Validate org_id format (should be a UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(org_id)) {
      console.error('Invalid org_id format:', org_id)
      return NextResponse.json({
        error: 'Invalid org_id format. Must be a valid UUID.'
      }, { status: 400, headers: cors })
    }

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
      }, { status: 500, headers: cors })
    }

    if (!org) {
      console.error('Org not found for id:', org_id)
      return NextResponse.json({ error: 'Invalid org_id - organization not found' }, { status: 400, headers: cors })
    }

    console.log('Found org:', org.id)

    if (!leadSource) {
      const { data: defaultSource, error: defaultSourceError } = await adminClient
        .from('lead_sources')
        .select('id, org_id, name, source_type, default_campaign_id, field_mapping, auto_assign_user_id, webhook_enabled, is_active')
        .eq('org_id', org_id)
        .eq('source_type', 'website')
        .eq('is_active', true)
        .eq('webhook_enabled', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (defaultSourceError) {
        console.log('Could not load default website lead source:', defaultSourceError)
      } else if (defaultSource) {
        leadSource = defaultSource as LeadSourceConfig
      }
    }

    // Extract contact info - handle many common field name variations
    const fieldMapping = leadSource?.field_mapping
    const firstName = pickMappedField(body, fieldMapping, 'first_name') || body.first_name || body.firstName || body.firstname || body.fname || body.given_name || ''
    const lastName = pickMappedField(body, fieldMapping, 'last_name') || body.last_name || body.lastName || body.lastname || body.lname || body.family_name || body.surname || ''
    const fullNameDirect = pickMappedField(body, fieldMapping, 'name') || body.name || body.full_name || body.fullName || body.homeowner_name || body.homeownerName || body.customer_name || body.customerName || ''
    
    // Build the full name - prefer direct full name, otherwise combine first + last
    let fullName = fullNameDirect.trim()
    if (!fullName && (firstName || lastName)) {
      fullName = [firstName, lastName].filter(Boolean).join(' ').trim()
    }
    
    console.log('Name fields:', { firstName, lastName, fullNameDirect, resolvedFullName: fullName })

    // Extract phone - handle variations
    const phone = pickMappedField(body, fieldMapping, 'phone') || body.phone || body.phone_number || body.phoneNumber || body.telephone || body.tel || body.mobile || body.cell || ''

    // Extract email - handle variations  
    const email = pickMappedField(body, fieldMapping, 'email') || body.email || body.email_address || body.emailAddress || body.e_mail || ''

    // Extract address - handle variations
    const street = body.street || body.street_address || body.streetAddress || body.address1 || body.address_line_1 || ''
    const city = body.city || ''
    const state = body.state || body.province || body.region || ''
    const zip = body.zip || body.zipcode || body.zip_code || body.postal_code || body.postalCode || ''
    const addressDirect = pickMappedField(body, fieldMapping, 'address') || body.address || body.address_text || body.full_address || body.fullAddress || ''

    // Build the full address
    let fullAddress = addressDirect.trim()
    if (!fullAddress && (street || city || state || zip)) {
      fullAddress = [street, city, state, zip].filter(Boolean).join(', ').trim()
    }

    // Extract optional fields
    const source = leadSource?.name || body.source || body.lead_source || body.leadSource || 'web'
    const notes = pickMappedField(body, fieldMapping, 'notes') || body.notes || body.note || ''
    const message = pickMappedField(body, fieldMapping, 'message') || body.message || body.comments || body.comment || body.inquiry || body.description || ''
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
    if (leadSource?.auto_assign_user_id) {
      ownerUserId = leadSource.auto_assign_user_id
    } else if (org.settings?.web_leads_owner_id) {
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

    const campaignId = await resolveCampaignId(
      adminClient,
      org_id,
      body,
      leadSource?.default_campaign_id || null
    )

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
      lead_source_id: leadSource?.id || null,
      campaign_id: campaignId,
      source_type: leadSource?.source_type || null,
      external_lead_id: body.external_lead_id || body.externalLeadId || body.id || null,
      raw_payload: body,
    }

    const { lead, error: leadError } = await insertLeadWithSchemaFallback(adminClient, leadData)

    if (leadError) {
      console.error('Lead creation error:', leadError)
      return NextResponse.json({
        error: `Failed to create lead: ${leadError.message}`
      }, { status: 500, headers: cors })
    }

    if (!lead) {
      return NextResponse.json({
        error: 'Failed to create lead: Unknown error'
      }, { status: 500, headers: cors })
    }

    if (leadSource) {
      try {
        const { data: sourceStats } = await adminClient
          .from('lead_sources')
          .select('total_leads_received')
          .eq('id', leadSource.id)
          .single()

        await adminClient
          .from('lead_sources')
          .update({
            total_leads_received: Number(sourceStats?.total_leads_received || 0) + 1,
            last_lead_at: new Date().toISOString(),
          })
          .eq('id', leadSource.id)
      } catch (sourceUpdateError) {
        console.log('Could not update lead source stats:', sourceUpdateError)
      }
    }

    await syncCampaignLeadTotal(adminClient, org_id, leadData.campaign_id)

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
        from: getCrmEmailFrom(),
        to: 'nathan@arxroofing.com',
        subject: `${sourceLabel} (inbound lead)`,
        text: `A new inbound lead was created.\n\nSource: ${sourceLabel}\nLead Name: ${fullName || 'Unknown'}\nAddress: ${fullAddress || 'TBD'}\nPhone: ${phone || 'N/A'}\nLead URL: ${leadUrl}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
            <h2 style="margin: 0 0 12px; color: #111827;">New Inbound Lead</h2>
            <p style="color: #374151; margin: 0 0 10px;"><strong>Source:</strong> ${sourceLabel}</p>
            <p style="color: #374151; margin: 0 0 6px;"><strong>Lead Name:</strong> ${fullName || 'Unknown'}</p>
            <p style="color: #374151; margin: 0 0 6px;"><strong>Address:</strong> ${fullAddress || 'TBD'}</p>
            <p style="color: #374151; margin: 0 0 10px;"><strong>Phone:</strong> ${phone || 'N/A'}</p>
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
    }, { headers: cors })
  } catch (error) {
    console.error('Webhook error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to process lead'
    return NextResponse.json({
      error: errorMessage,
      details: error instanceof Error ? error.stack : undefined
    }, { status: 500, headers: cors })
  }
}

// GET - Return webhook info and test endpoint
export async function GET(request: NextRequest) {
  return NextResponse.json({
    status: 'active',
    endpoint: '/api/webhooks/leads',
    method: 'POST',
    description: 'Webhook endpoint for receiving leads from external sources',
    authentication: 'Use a lead source URL with ?token=..., or Bearer/x-api-key when WEBHOOK_SECRET is configured. If no secret is configured, org_id payload intake is allowed.',
    required_fields: ['org_id unless using a lead source token'],
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
