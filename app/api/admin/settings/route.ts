import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'

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

    const adminClient = createServiceClient()

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

    const adminClient = createServiceClient()

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

    if (type === 'close_outcomes') {
      const { error } = await adminClient
        .from('orgs')
        .update({
          settings: {
            ...currentSettings,
            close_outcomes: data.close_outcomes,
          }
        })
        .eq('id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    if (type === 'appointment_types') {
      // Sync to appointment_types table first (scheduling routes read the table).
      // Persist orgs.settings JSON only after a successful sync so we don't claim success when the table is empty.
      // Helpers (findInspectionRow / findCloseKindRow) use category 'inspection' vs 'close' only; name distinguishes close kinds.
      if (Array.isArray(data.appointment_types)) {
        if (data.appointment_types.length > 0) {
          const { error: deleteError } = await adminClient
            .from('appointment_types')
            .delete()
            .eq('org_id', profile.org_id)

          if (deleteError) {
            return NextResponse.json(
              { error: `Failed to clear appointment types: ${deleteError.message}` },
              { status: 500 }
            )
          }

          const rows = data.appointment_types.map((t: any, i: number) => {
            const bufferAfter =
              typeof t.buffer_after_minutes === 'number' ? t.buffer_after_minutes : 0
            const category = t.id === 'inspection' ? 'inspection' : 'close'
            return {
              org_id: profile.org_id,
              name: t.name || t.id,
              duration_minutes: typeof t.duration_minutes === 'number' ? t.duration_minutes : 60,
              buffer_after_minutes: bufferAfter,
              color: t.color || '#6366f1',
              description: t.description || null,
              category,
              active: t.active !== false,
              sort_order: i,
            }
          })

          const { error: tableError } = await adminClient.from('appointment_types').insert(rows)

          if (tableError) {
            console.error('appointment_types table sync failed:', tableError.message)
            return NextResponse.json(
              { error: `Failed to sync appointment types: ${tableError.message}` },
              { status: 500 }
            )
          }
        } else {
          const { error: clearError } = await adminClient
            .from('appointment_types')
            .delete()
            .eq('org_id', profile.org_id)

          if (clearError) {
            return NextResponse.json(
              { error: `Failed to clear appointment types: ${clearError.message}` },
              { status: 500 }
            )
          }
        }
      }

      const { error } = await adminClient
        .from('orgs')
        .update({
          settings: {
            ...currentSettings,
            appointment_types: data.appointment_types,
          },
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

    if (type === 'materials_coverage') {
      const parseOptional = (value: unknown): number | null => {
        if (value == null || String(value).trim() === '') return null
        const n = Number(value)
        if (!Number.isFinite(n) || n <= 0) return null
        return n
      }

      const { error } = await adminClient
        .from('orgs')
        .update({
          starter_lf_per_bundle: parseOptional(data.starter_lf_per_bundle),
          cap_lf_per_bundle: parseOptional(data.cap_lf_per_bundle),
          underlayment_sq_per_roll: parseOptional(data.underlayment_sq_per_roll),
          ridge_vent_lf_per_piece: parseOptional(data.ridge_vent_lf_per_piece),
          ridge_vent_end_setback_ft: parseOptional(data.ridge_vent_end_setback_ft),
          ice_water_lf_per_roll: parseOptional(data.ice_water_lf_per_roll),
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
