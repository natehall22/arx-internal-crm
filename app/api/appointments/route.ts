import { ADJUSTER_MEETING_APPOINTMENT_TYPE } from '@/lib/adjuster-meeting'
import { resolveCanReassignAppointment } from '@/lib/permissions'
import { isInsideSalesRoleLike } from '@/lib/inside-sales-follow-up'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { getAccessTokenFromApiRequest } from '@/lib/supabase-api-request-auth'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getAuthClient(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const accessToken = getAccessTokenFromApiRequest(req)

  return {
    client: createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: accessToken
        ? { headers: { Authorization: `Bearer ${accessToken}` } }
        : undefined,
    }),
    accessToken,
  }
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// GET - List appointments
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
      .select('org_id, role, team_id, region_id, custom_role_id, custom_role:custom_roles(name, display_name)')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const searchParams = request.nextUrl.searchParams
    const filter = searchParams.get('filter') || 'upcoming'
    const canReassign = await resolveCanReassignAppointment(adminClient, profile)

    const { permissionNames } = await resolveEffectivePermissionNames(adminClient, user.id, {
      role: profile.role,
      custom_role_id: profile.custom_role_id,
    })

    // Build query
    let query = adminClient
      .from('scheduled_appointments')
      .select(`
        *,
        leads(homeowner_name, phone, address_text)
      `)
      .eq('org_id', profile.org_id)

    // Filter based on role - reps only see their own; scheduling managers see all.
    // Inside-sales users additionally see insurance_call rows (their calendar — calls have no closer).
    if (!canReassign) {
      const customRole = Array.isArray((profile as any).custom_role)
        ? (profile as any).custom_role[0]
        : (profile as any).custom_role
      const insideSales = isInsideSalesRoleLike({
        role: profile.role,
        customRoleName: customRole?.name || null,
        customRoleDisplayName: customRole?.display_name || null,
        permissionNames,
      })
      query = query.or(
        insideSales
          ? `closer_user_id.eq.${user.id},canvasser_user_id.eq.${user.id},appointment_type.eq.insurance_call`
          : `closer_user_id.eq.${user.id},canvasser_user_id.eq.${user.id}`
      )
    }

    // Apply time filters
    const now = new Date().toISOString()
    
    if (filter === 'upcoming') {
      query = query.gte('scheduled_for', now).eq('status', 'scheduled')
    } else if (filter === 'past') {
      query = query.lt('scheduled_for', now)
    } else if (filter === 'needs_feedback') {
      // Insurance calls are dispositioned from the inside-sales queue, and adjuster
      // meetings are completed by the attending rep on the appointment itself —
      // neither belongs in the inspection feedback form. Routing an adjuster meeting
      // there would let it write an inspection_outcome onto the opportunity and
      // disturb pipeline state for a visit that was never an inspection.
      query = query
        .lt('scheduled_for', now)
        .eq('status', 'scheduled')
        .not('appointment_type', 'in', `(insurance_call,${ADJUSTER_MEETING_APPOINTMENT_TYPE})`)
    }

    query = query.order('scheduled_for', { ascending: filter === 'upcoming' })

    const { data: appointments, error: appointmentsError } = await query.limit(100)

    if (appointmentsError) {
      console.error('Appointments fetch error:', appointmentsError)
      return NextResponse.json({ error: 'Failed to fetch appointments' }, { status: 500 })
    }

    // Get user info for closers and setters
    const userIds = new Set<string>()
    appointments?.forEach(apt => {
      if (apt.closer_user_id) userIds.add(apt.closer_user_id)
      if (apt.canvasser_user_id) userIds.add(apt.canvasser_user_id)
    })

    let usersMap: Record<string, any> = {}
    if (userIds.size > 0) {
      const { data: usersData } = await adminClient
        .from('users')
        .select('id, full_name, role')
        .in('id', Array.from(userIds))

      usersData?.forEach(u => {
        usersMap[u.id] = u
      })
    }

    // Get feedback/status updates for appointments
    const appointmentIds = appointments?.map(a => a.id) || []
    let feedbackMap: Record<string, any> = {}
    
    if (appointmentIds.length > 0) {
      const { data: statusUpdates } = await adminClient
        .from('inspection_status_updates')
        .select('appointment_id, outcome, notes, setter_feedback, completed_at')
        .in('appointment_id', appointmentIds)
        .order('completed_at', { ascending: false })
      
      // Get the most recent feedback for each appointment
      statusUpdates?.forEach(update => {
        if (!feedbackMap[update.appointment_id]) {
          feedbackMap[update.appointment_id] = update
        }
      })
    }

    // Add user info and feedback to appointments
    const enrichedAppointments = appointments?.map(apt => ({
      ...apt,
      closer: apt.closer_user_id ? usersMap[apt.closer_user_id] : null,
      setter: apt.canvasser_user_id ? usersMap[apt.canvasser_user_id] : null,
      feedback: feedbackMap[apt.id] || null,
    }))

    // Get all users for reassignment dropdown (scheduling managers only)
    let allUsers: any[] = []
    if (canReassign) {
      const { data: orgUsers } = await adminClient
        .from('users')
        .select('id, full_name, role')
        .eq('org_id', profile.org_id)
        .in('role', ['sales_rep', 'closer', 'canvasser', 'sales_manager', 'regional_manager'])
        .order('full_name')

      allUsers = orgUsers || []
    }

    return NextResponse.json({
      appointments: enrichedAppointments || [],
      users: allUsers,
      profile: { role: profile.role },
      canReassign,
      /** Echo for client PATCH calls when cookie sync is flaky (same pattern as /api/calendar/profile). */
      access_token: accessToken,
    })
  } catch (error) {
    console.error('Appointments API error:', error)
    return NextResponse.json({ error: 'Failed to fetch appointments' }, { status: 500 })
  }
}
