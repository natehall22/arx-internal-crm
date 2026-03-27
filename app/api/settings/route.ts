import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuthApi } from '@/lib/auth'

export const dynamic = 'force-dynamic'

function isAuthFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (
    error.message === 'Unauthorized' ||
    error.message === 'No session' ||
    error.message === 'Token invalid or expired' ||
    error.message === 'Profile missing'
  )
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// GET - Load user settings
export async function GET(_request: NextRequest) {
  try {
    const { authUser, profile } = await requireAuthApi()

    const adminClient = getAdminClient()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Get user settings
    const { data: userSettings } = await adminClient
      .from('user_settings')
      .select('*')
      .eq('user_id', authUser.id)
      .maybeSingle()

    // Get Google Calendar token (no row is OK)
    const { data: googleToken } = await adminClient
      .from('user_google_tokens')
      .select('*')
      .eq('user_id', authUser.id)
      .maybeSingle()

    return NextResponse.json({
      userSettings,
      googleToken,
      profile: {
        role: profile.role,
        full_name: profile.full_name,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Server config error') {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }
    if (isAuthFailure(error)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Error loading user settings:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Save user settings
export async function POST(request: NextRequest) {
  try {
    const { authUser } = await requireAuthApi()

    const adminClient = getAdminClient()
    const settings = await request.json()

    // Build the settings object, only including defined values
    const settingsData: Record<string, unknown> = {
      user_id: authUser.id,
    }

    // Only add fields that are defined
    if (settings.notifications_enabled !== undefined)
      settingsData.notifications_enabled = settings.notifications_enabled
    if (settings.email_notifications !== undefined)
      settingsData.email_notifications = settings.email_notifications
    if (settings.push_notifications !== undefined)
      settingsData.push_notifications = settings.push_notifications
    if (settings.notification_types !== undefined)
      settingsData.notification_types = settings.notification_types
    if (settings.google_calendar_connected !== undefined)
      settingsData.google_calendar_connected = settings.google_calendar_connected
    if (settings.default_appointment_duration !== undefined)
      settingsData.default_appointment_duration = settings.default_appointment_duration
    if (settings.appointment_buffer_minutes !== undefined)
      settingsData.appointment_buffer_minutes = settings.appointment_buffer_minutes
    if (settings.working_hours_start !== undefined)
      settingsData.working_hours_start = settings.working_hours_start
    if (settings.working_hours_end !== undefined)
      settingsData.working_hours_end = settings.working_hours_end
    if (settings.working_days !== undefined) settingsData.working_days = settings.working_days
    if (settings.ai_enabled !== undefined) settingsData.ai_enabled = settings.ai_enabled
    if (settings.ai_suggestions_enabled !== undefined)
      settingsData.ai_suggestions_enabled = settings.ai_suggestions_enabled
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
    if (error instanceof Error && error.message === 'Server config error') {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }
    if (isAuthFailure(error)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Error saving user settings:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Disconnect Google Calendar
export async function DELETE(request: NextRequest) {
  try {
    const { authUser } = await requireAuthApi()

    const adminClient = getAdminClient()

    const { error: deleteError } = await adminClient
      .from('user_google_tokens')
      .delete()
      .eq('user_id', authUser.id)

    if (deleteError) {
      console.error('Failed to delete user_google_tokens:', deleteError)
      return NextResponse.json(
        { error: deleteError.message || 'Failed to disconnect Google Calendar' },
        { status: 500 }
      )
    }

    const { error: settingsError } = await adminClient
      .from('user_settings')
      .update({ google_calendar_connected: false })
      .eq('user_id', authUser.id)

    if (settingsError) {
      console.error('Failed to clear google_calendar_connected:', settingsError)
      // Tokens are already removed; still report success so UI can disconnect
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'Server config error') {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }
    if (isAuthFailure(error)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Error disconnecting Google Calendar:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
