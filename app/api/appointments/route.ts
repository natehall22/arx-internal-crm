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
      return JSON.parse(singleCookie.value)
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
      return JSON.parse(chunks.join(''))
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
      .select('org_id, role, team_id, region_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const searchParams = request.nextUrl.searchParams
    const filter = searchParams.get('filter') || 'upcoming'
    const isManager = ['admin', 'regional_manager', 'sales_manager'].includes(profile.role)

    // Build query
    let query = adminClient
      .from('scheduled_appointments')
      .select(`
        *,
        leads(homeowner_name, phone, address_text)
      `)
      .eq('org_id', profile.org_id)

    // Filter based on role - reps only see their own, managers see all
    if (!isManager) {
      query = query.or(`closer_user_id.eq.${user.id},canvasser_user_id.eq.${user.id}`)
    }

    // Apply time filters
    const now = new Date().toISOString()
    
    if (filter === 'upcoming') {
      query = query.gte('scheduled_for', now).eq('status', 'scheduled')
    } else if (filter === 'past') {
      query = query.lt('scheduled_for', now)
    } else if (filter === 'needs_feedback') {
      query = query.lt('scheduled_for', now).eq('status', 'scheduled')
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

    // Get all users for reassignment dropdown (managers only)
    let allUsers: any[] = []
    if (isManager) {
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
    })
  } catch (error) {
    console.error('Appointments API error:', error)
    return NextResponse.json({ error: 'Failed to fetch appointments' }, { status: 500 })
  }
}
