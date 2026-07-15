import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuthApi } from '@/lib/auth'

export const dynamic = 'force-dynamic'

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * POST /api/mobile/push-token — register / refresh an APNs device token.
 * DELETE /api/mobile/push-token — remove a token on sign-out.
 */
export async function POST(request: NextRequest) {
  try {
    let authContext: Awaited<ReturnType<typeof requireAuthApi>>
    try {
      authContext = await requireAuthApi()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const profile = authContext.profile
    const userId = authContext.authUser.id
    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    let body: { device_token?: string; platform?: string; environment?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const deviceToken = typeof body.device_token === 'string' ? body.device_token.trim() : ''
    if (!deviceToken || deviceToken.length < 32 || deviceToken.length > 200) {
      return NextResponse.json({ error: 'device_token is required' }, { status: 400 })
    }

    const platform = body.platform === 'ios' || !body.platform ? 'ios' : String(body.platform)
    if (platform !== 'ios') {
      return NextResponse.json({ error: 'Only ios platform is supported' }, { status: 400 })
    }

    const environment =
      body.environment === 'sandbox' || body.environment === 'production'
        ? body.environment
        : process.env.APNS_ENVIRONMENT === 'sandbox'
          ? 'sandbox'
          : 'production'

    const admin = getAdminClient()
    const { error } = await admin.from('mobile_device_tokens').upsert(
      {
        user_id: userId,
        org_id: profile.org_id,
        device_token: deviceToken,
        platform: 'ios',
        environment,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,device_token' }
    )

    if (error) {
      console.error('mobile push-token upsert', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Mobile push-token POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to register token' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    let authContext: Awaited<ReturnType<typeof requireAuthApi>>
    try {
      authContext = await requireAuthApi()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authContext.authUser.id

    let body: { device_token?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const deviceToken = typeof body.device_token === 'string' ? body.device_token.trim() : ''
    if (!deviceToken) {
      return NextResponse.json({ error: 'device_token is required' }, { status: 400 })
    }

    const admin = getAdminClient()
    const { error } = await admin
      .from('mobile_device_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('device_token', deviceToken)

    if (error) {
      console.error('mobile push-token delete', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Mobile push-token DELETE error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete token' },
      { status: 500 }
    )
  }
}
