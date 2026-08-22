/**
 * GET /api/calendar/profile
 * Returns the current user's profile for the calendar page.
 * Uses the same cookie-based auth pattern as other working API routes
 * (getSessionFromRequest + auth.getUser(token)) because the browser
 * Supabase client cannot resolve the auth session in this app's setup.
 */
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
      return JSON.parse(decodeURIComponent(singleCookie.value))
    } catch { /* fall through */ }
  }

  const chunks: string[] = []
  for (let i = 0; ; i++) {
    const chunk = req.cookies.get(`${cookieName}.${i}`)
    if (!chunk?.value) break
    chunks.push(chunk.value)
  }
  if (chunks.length > 0) {
    try {
      return JSON.parse(decodeURIComponent(chunks.join('')))
    } catch { /* fall through */ }
  }

  return null
}

export async function GET(request: NextRequest) {
  try {
    const sessionData = getSessionFromRequest(request)
    const accessToken: string | undefined = sessionData?.access_token

    if (!accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Validate the token and get the user
    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: { user }, error: authError } = await anonClient.auth.getUser(accessToken)

    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 })
    }

    const admin = createServiceClient()

    // Full profile fetch
    const { data: profile, error: profileError } = await admin
      .from('users')
      .select('id, org_id, role, team_id, region_id, custom_role_id, dashboard_view')
      .eq('id', user.id)
      .single()

    let profileBase = profile

    if (profileError || !profileBase?.org_id) {
      // Fallback: minimal fields in case a column is missing (not-yet-run migration)
      const { data: minProfile, error: minError } = await admin
        .from('users')
        .select('id, org_id, role, team_id, region_id')
        .eq('id', user.id)
        .single()

      if (minError || !minProfile?.org_id) {
        return NextResponse.json(
          { error: `Profile not found: ${minError?.message || profileError?.message}` },
          { status: 404 }
        )
      }

      return NextResponse.json({
        ...minProfile,
        custom_role_id: null,
        dashboard_view: 'sales',
        custom_role: null,
        auth_user_id: user.id,
        access_token: accessToken,
      })
    }

    // Load custom role + permissions if present
    let customRole: any = null
    if (profileBase.custom_role_id) {
      const { data: cr } = await admin
        .from('custom_roles')
        .select(`id, name, display_name, role_permissions(permission:permissions(name))`)
        .eq('id', profileBase.custom_role_id)
        .single()
      customRole = cr ?? null
    }

    return NextResponse.json({
      ...profileBase,
      custom_role: customRole,
      auth_user_id: user.id,
      access_token: accessToken,
    })
  } catch (err: any) {
    console.error('GET /api/calendar/profile error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
