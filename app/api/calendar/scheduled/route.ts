import {
  canViewOrgWideScheduledAppointments,
  deriveCalendarAccess,
} from '@/lib/permissions'
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

/**
 * Scheduled appointments for the calendar (date range), with the same visibility rules as the
 * main calendar UI but using a service-role query so RLS + flaky client-side custom_role joins
 * cannot hide org-wide rows for leadership.
 */
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

    const searchParams = request.nextUrl.searchParams
    const startRaw = searchParams.get('start')
    const endRaw = searchParams.get('end')
    const closerUserId = searchParams.get('closerUserId') || ''

    if (!startRaw || !endRaw) {
      return NextResponse.json({ error: 'start and end (ISO) are required' }, { status: 400 })
    }

    const start = new Date(startRaw)
    const end = new Date(endRaw)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: 'Invalid start or end date' }, { status: 400 })
    }

    const adminClient = getAdminClient()

    const { data: profile, error: profileError } = await adminClient
      .from('users')
      .select(
        `
        id,
        org_id,
        role,
        team_id,
        region_id,
        custom_role_id,
        custom_role:custom_roles(
          id,
          name,
          display_name,
          role_permissions(permission:permissions(name))
        )
      `
      )
      .eq('id', user.id)
      .single()

    if (profileError || !profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const canSeeAllAppointments =
      canViewOrgWideScheduledAppointments(profile) || deriveCalendarAccess(profile) !== 'none'

    let query = adminClient
      .from('scheduled_appointments')
      .select('*')
      .eq('org_id', profile.org_id)
      .gte('scheduled_for', start.toISOString())
      .lte('scheduled_for', end.toISOString())
      .order('scheduled_for', { ascending: true })

    if (closerUserId) {
      query = query.eq('closer_user_id', closerUserId)
    } else if (!canSeeAllAppointments) {
      query = query.or(`closer_user_id.eq.${user.id},canvasser_user_id.eq.${user.id}`)
    }

    const { data: appointments, error: appointmentsError } = await query.limit(2000)

    if (appointmentsError) {
      console.error('Calendar scheduled fetch error:', appointmentsError)
      return NextResponse.json({ error: 'Failed to fetch appointments' }, { status: 500 })
    }

    return NextResponse.json({ appointments: appointments ?? [] })
  } catch (e) {
    console.error('GET /api/calendar/scheduled:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
