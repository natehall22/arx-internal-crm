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

// GET - Fetch single appointment
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Fetch appointment with related data
    const { data: appointment, error } = await adminClient
      .from('scheduled_appointments')
      .select(`
        *,
        leads(homeowner_name, phone, email, address_text),
        opportunities(id, status)
      `)
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (error || !appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    // Get setter info if exists
    let setter = null
    if (appointment.canvasser_user_id) {
      const { data: setterData } = await adminClient
        .from('users')
        .select('id, full_name, email, team_id')
        .eq('id', appointment.canvasser_user_id)
        .single()
      setter = setterData
    }

    // Get closer info
    let closer = null
    if (appointment.closer_user_id) {
      const { data: closerData } = await adminClient
        .from('users')
        .select('id, full_name, email, team_id')
        .eq('id', appointment.closer_user_id)
        .single()
      closer = closerData
    }

    return NextResponse.json({
      appointment: {
        ...appointment,
        setter,
        closer,
      }
    })
  } catch (error) {
    console.error('Appointment fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch appointment' }, { status: 500 })
  }
}

// PATCH - Update appointment (reassign, update status, etc.)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Check if user is manager or above for reassignment
    const isManager = ['admin', 'regional_manager', 'sales_manager', 'manager'].includes(profile.role)

    const body = await request.json()
    const { new_closer_id, status, notes } = body

    // Get current appointment
    const { data: appointment, error: fetchError } = await adminClient
      .from('scheduled_appointments')
      .select('*, leads(homeowner_name)')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (fetchError || !appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    const updateData: Record<string, any> = {}

    // Handle reassignment (managers only)
    if (new_closer_id && new_closer_id !== appointment.closer_user_id) {
      if (!isManager) {
        return NextResponse.json({ error: 'Only managers can reassign appointments' }, { status: 403 })
      }

      // Verify new closer exists in same org
      const { data: newCloser } = await adminClient
        .from('users')
        .select('id, full_name, org_id')
        .eq('id', new_closer_id)
        .eq('org_id', profile.org_id)
        .single()

      if (!newCloser) {
        return NextResponse.json({ error: 'New closer not found' }, { status: 404 })
      }

      updateData.closer_user_id = new_closer_id

      // Create activity for reassignment
      await adminClient.from('activities').insert({
        org_id: profile.org_id,
        lead_id: appointment.lead_id,
        opportunity_id: appointment.opportunity_id,
        user_id: user.id,
        type: 'status_change',
        body: `Appointment reassigned to ${newCloser.full_name} by ${profile.full_name}`,
      })

      // Notify old closer
      if (appointment.closer_user_id) {
        await adminClient.from('notifications').insert({
          org_id: profile.org_id,
          user_id: appointment.closer_user_id,
          type: 'appointment_reassigned',
          title: 'Appointment Reassigned',
          body: `Your appointment with ${appointment.leads?.homeowner_name || 'customer'} has been reassigned to ${newCloser.full_name}`,
          data: { appointment_id: params.id },
        })
      }

      // Notify new closer
      await adminClient.from('notifications').insert({
        org_id: profile.org_id,
        user_id: new_closer_id,
        type: 'new_appointment',
        title: 'New Appointment Assigned',
        body: `You have been assigned an appointment with ${appointment.leads?.homeowner_name || 'customer'} on ${new Date(appointment.scheduled_for).toLocaleDateString()}`,
        data: { appointment_id: params.id },
      })
    }

    if (status) {
      updateData.status = status
    }

    if (notes !== undefined) {
      updateData.notes = notes
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
    }

    // Update appointment
    const { data: updated, error: updateError } = await adminClient
      .from('scheduled_appointments')
      .update(updateData)
      .eq('id', params.id)
      .select()
      .single()

    if (updateError) {
      console.error('Update error:', updateError)
      return NextResponse.json({ error: 'Failed to update appointment' }, { status: 500 })
    }

    return NextResponse.json({ success: true, appointment: updated })
  } catch (error) {
    console.error('Appointment update error:', error)
    return NextResponse.json({ error: 'Failed to update appointment' }, { status: 500 })
  }
}
