import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import { canReceiveCanvassAppointment } from '@/lib/canvass-appointment-eligibility'
import {
  fetchOrgAppointmentTypesFromTable,
  getInspectionDurationFromTable,
} from '@/lib/org-appointment-types'
import { userHasSchedulingCreate } from '@/lib/scheduling-create-permission'
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
    } catch {
      return null
    }
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
    accessToken: sessionData?.access_token as string | undefined,
  }
}

/** Teams, closers, and duration for the lead inspection scheduling modal (no heavy canvass payload). */
export async function GET(request: NextRequest) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser(accessToken)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createServiceClient()
    const { data: profile, error: profileError } = await admin
      .from('users')
      .select('id, org_id, role, custom_role_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const allowed = await userHasSchedulingCreate(admin, user.id, profile)
    if (!allowed) {
      return NextResponse.json({
        allowed: false,
        teams: [],
        users: [],
        inspectionDurationMinutes: 60,
      })
    }

    const { data: usersRaw } = await admin
      .from('users')
      .select('id, full_name, role, can_receive_appointments, active')
      .eq('org_id', profile.org_id)
      .order('full_name', { ascending: true })

    const filteredUsers = (usersRaw || []).filter(canReceiveCanvassAppointment)

    const { data: calendarTokens } = await admin.from('user_google_tokens').select('user_id')
    const calendarUserIds = new Set((calendarTokens || []).map((t) => t.user_id))

    const usersWithCalendar = filteredUsers
      .filter((u) => calendarUserIds.has(u.id))
      .map((u) => ({
        id: u.id,
        full_name: u.full_name,
        has_calendar: true as const,
      }))

    const { data: teams } = await admin
      .from('teams')
      .select('id, name')
      .eq('org_id', profile.org_id)
      .order('name', { ascending: true })

    const appointmentTypeRows = await fetchOrgAppointmentTypesFromTable(admin, profile.org_id)
    const inspectionDurationMinutes = getInspectionDurationFromTable(appointmentTypeRows, 60)

    return NextResponse.json({
      allowed: true,
      teams: teams || [],
      users: usersWithCalendar,
      inspectionDurationMinutes,
    })
  } catch (e) {
    console.error('GET /api/leads/scheduling-resources', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
