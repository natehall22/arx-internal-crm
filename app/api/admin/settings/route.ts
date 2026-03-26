import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getSessionFromRequest(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
  const cookieName = `sb-${projectRef}-auth-token`
  
  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      const decoded = decodeURIComponent(singleCookie.value)
      return JSON.parse(decoded)
    } catch {
      return null
    }
  }
  
  const chunks: string[] = []
  let i = 0
  while (true) {
    const chunk = req.cookies.get(`${cookieName}.${i}`)
    if (!chunk?.value) break
    chunks.push(chunk.value)
    i++
  }
  
  if (chunks.length > 0) {
    try {
      const decoded = decodeURIComponent(chunks.join(''))
      return JSON.parse(decoded)
    } catch {
      return null
    }
  }
  
  return null
}

function getAuthClient(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const sessionData = getSessionFromRequest(req)
  
  return {
    client: createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: sessionData?.access_token
        ? { headers: { Authorization: `Bearer ${sessionData.access_token}` } }
        : undefined,
    }),
    accessToken: sessionData?.access_token,
  }
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// GET - Load settings
export async function GET(request: NextRequest) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = getAdminClient()

    // Get user profile
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Check admin access - allow admin, regional_manager, sales_manager, and operations
    if (!['admin', 'regional_manager', 'sales_manager', 'operations'].includes(profile.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Get org data
    const { data: org } = await adminClient
      .from('orgs')
      .select('*')
      .eq('id', profile.org_id)
      .single()

    return NextResponse.json({
      orgId: profile.org_id,
      role: profile.role,
      org: org || {},
      settings: org?.settings || {},
    })
  } catch (error) {
    console.error('Settings API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to load settings' 
    }, { status: 500 })
  }
}

// PATCH - Update settings
export async function PATCH(request: NextRequest) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = getAdminClient()

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id || !['admin', 'regional_manager', 'sales_manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const body = await request.json()
    const { type, ...data } = body

    // Get current org data
    const { data: org } = await adminClient
      .from('orgs')
      .select('settings')
      .eq('id', profile.org_id)
      .single()

    const currentSettings = org?.settings || {}

    if (type === 'general') {
      // Try to update org-level fields directly first
      // If columns don't exist, fall back to storing in settings JSONB
      const orgUpdate: Record<string, any> = {
        name: data.company_name,
      }
      
      // These columns may not exist in older schemas, so we try them
      // and fall back to settings if they fail
      const optionalFields = {
        phone: data.company_phone,
        email: data.company_email,
        address: data.company_address,
        timezone: data.timezone,
        date_format: data.date_format,
        currency: data.currency,
      }

      // First try with all fields
      let { error } = await adminClient
        .from('orgs')
        .update({ ...orgUpdate, ...optionalFields })
        .eq('id', profile.org_id)

      if (error && error.message.includes('column')) {
        // Columns don't exist, store in settings JSONB instead
        console.log('Org columns not found, storing in settings JSONB')
        const { error: settingsError } = await adminClient
          .from('orgs')
          .update({
            name: data.company_name,
            settings: {
              ...currentSettings,
              company_phone: data.company_phone,
              company_email: data.company_email,
              company_address: data.company_address,
              timezone: data.timezone,
              date_format: data.date_format,
              currency: data.currency,
            }
          })
          .eq('id', profile.org_id)

        if (settingsError) {
          return NextResponse.json({ error: settingsError.message }, { status: 400 })
        }
        return NextResponse.json({ success: true })
      }

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    if (type === 'settings') {
      // Update settings JSON field
      const { error } = await adminClient
        .from('orgs')
        .update({
          settings: {
            ...currentSettings,
            ...data,
          }
        })
        .eq('id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    if (type === 'canvass_dispositions') {
      const { error } = await adminClient
        .from('orgs')
        .update({
          settings: {
            ...currentSettings,
            canvass_dispositions: data.dispositions,
          }
        })
        .eq('id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    if (type === 'inspection_outcomes') {
      const { error } = await adminClient
        .from('orgs')
        .update({
          settings: {
            ...currentSettings,
            inspection_outcomes: data.inspection_outcomes,
          }
        })
        .eq('id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    if (type === 'appointment_types') {
      const { error } = await adminClient
        .from('orgs')
        .update({
          settings: {
            ...currentSettings,
            appointment_types: data.appointment_types,
          }
        })
        .eq('id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    if (type === 'scheduling') {
      const inspectionFb =
        typeof data.inspection_feedback_buffer_minutes === 'number'
          ? data.inspection_feedback_buffer_minutes
          : 0
      const defaultGap =
        typeof data.default_scheduling_gap_minutes === 'number'
          ? data.default_scheduling_gap_minutes
          : 15

      const { error } = await adminClient
        .from('orgs')
        .update({
          inspection_feedback_buffer_minutes: Math.max(0, inspectionFb),
          default_scheduling_gap_minutes: Math.max(0, defaultGap),
        })
        .eq('id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    if (type === 'commission') {
      const { error } = await adminClient
        .from('orgs')
        .update({
          settings: {
            ...currentSettings,
            commission: data.commission,
          }
        })
        .eq('id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    if (type === 'measurement_tools') {
      const { error } = await adminClient
        .from('orgs')
        .update({
          settings: {
            ...currentSettings,
            measure_tool_enabled: data.measure_tool_enabled,
            external_integrations: data.external_integrations,
          }
        })
        .eq('id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    if (type === 'reports') {
      const { error } = await adminClient
        .from('orgs')
        .update({
          settings: {
            ...currentSettings,
            reports: data.reports,
          }
        })
        .eq('id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    if (type === 'external_integrations') {
      const { error } = await adminClient
        .from('orgs')
        .update({
          settings: {
            ...currentSettings,
            external_integrations_config: data.external_integrations_config,
          }
        })
        .eq('id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  } catch (error) {
    console.error('Settings API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to update settings' 
    }, { status: 500 })
  }
}
