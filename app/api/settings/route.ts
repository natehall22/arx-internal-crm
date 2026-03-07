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

// GET - Load user settings
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
      .select('org_id, role, full_name')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Get user settings
    const { data: userSettings } = await adminClient
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .single()

    // Get Google Calendar token
    const { data: googleToken } = await adminClient
      .from('user_google_tokens')
      .select('*')
      .eq('user_id', user.id)
      .single()

    return NextResponse.json({
      userSettings,
      googleToken,
      profile: {
        role: profile.role,
        full_name: profile.full_name,
      },
    })
  } catch (error) {
    console.error('Error loading user settings:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Save user settings
export async function POST(request: NextRequest) {
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
    const settings = await request.json()

    // Build the settings object, only including defined values
    const settingsData: Record<string, any> = {
      user_id: user.id,
    }

    // Only add fields that are defined
    if (settings.notifications_enabled !== undefined) settingsData.notifications_enabled = settings.notifications_enabled
    if (settings.email_notifications !== undefined) settingsData.email_notifications = settings.email_notifications
    if (settings.push_notifications !== undefined) settingsData.push_notifications = settings.push_notifications
    if (settings.notification_types !== undefined) settingsData.notification_types = settings.notification_types
    if (settings.google_calendar_connected !== undefined) settingsData.google_calendar_connected = settings.google_calendar_connected
    if (settings.default_appointment_duration !== undefined) settingsData.default_appointment_duration = settings.default_appointment_duration
    if (settings.appointment_buffer_minutes !== undefined) settingsData.appointment_buffer_minutes = settings.appointment_buffer_minutes
    if (settings.working_hours_start !== undefined) settingsData.working_hours_start = settings.working_hours_start
    if (settings.working_hours_end !== undefined) settingsData.working_hours_end = settings.working_hours_end
    if (settings.working_days !== undefined) settingsData.working_days = settings.working_days
    if (settings.ai_enabled !== undefined) settingsData.ai_enabled = settings.ai_enabled
    if (settings.ai_suggestions_enabled !== undefined) settingsData.ai_suggestions_enabled = settings.ai_suggestions_enabled
    if (settings.ai_auto_notes !== undefined) settingsData.ai_auto_notes = settings.ai_auto_notes
    if (settings.theme !== undefined) settingsData.theme = settings.theme

    const { error } = await adminClient
      .from('user_settings')
      .upsert(settingsData, { onConflict: 'user_id' })

    if (error) {
      console.error('Failed to save settings:', error.message, error.details, error.hint)
      return NextResponse.json({ error: `Failed to save settings: ${error.message}` }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error saving user settings:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Disconnect Google Calendar
export async function DELETE(request: NextRequest) {
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

    await adminClient
      .from('user_google_tokens')
      .delete()
      .eq('user_id', user.id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error disconnecting Google Calendar:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
