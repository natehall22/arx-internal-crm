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

function getDateRangeForTimeFrame(timeframe: string): { start: Date; end: Date } {
  const ET_OFFSET_HOURS = 5
  const now = new Date()
  const nowET = new Date(now.getTime() - ET_OFFSET_HOURS * 60 * 60 * 1000)
  
  let start: Date
  let end: Date

  switch (timeframe) {
    case 'today':
      start = new Date(Date.UTC(nowET.getUTCFullYear(), nowET.getUTCMonth(), nowET.getUTCDate(), ET_OFFSET_HOURS, 0, 0, 0))
      end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
      break
    case 'week':
      const dayOfWeek = nowET.getUTCDay()
      start = new Date(Date.UTC(nowET.getUTCFullYear(), nowET.getUTCMonth(), nowET.getUTCDate() - dayOfWeek, ET_OFFSET_HOURS, 0, 0, 0))
      end = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      break
    case 'month':
      start = new Date(Date.UTC(nowET.getUTCFullYear(), nowET.getUTCMonth(), 1, ET_OFFSET_HOURS, 0, 0, 0))
      end = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      break
    case 'quarter':
      const quarter = Math.floor(nowET.getUTCMonth() / 3)
      start = new Date(Date.UTC(nowET.getUTCFullYear(), quarter * 3, 1, ET_OFFSET_HOURS, 0, 0, 0))
      end = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      break
    default:
      start = new Date(Date.UTC(2020, 0, 1, ET_OFFSET_HOURS, 0, 0, 0))
      end = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  }

  return { start, end }
}

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

    const supabase = getAdminClient()

    const { data: profile } = await supabase
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Admin only
    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const timeframe = searchParams.get('range') || searchParams.get('timeframe') || 'quarter'
    const { start, end } = getDateRangeForTimeFrame(timeframe)

    // Get all active team members
    const { data: members } = await supabase
      .from('users')
      .select('id, full_name, role, email')
      .eq('org_id', profile.org_id)
      .eq('active', true)
      .neq('show_in_reports', false)

    if (!members || members.length === 0) {
      return NextResponse.json({ error: 'No members found' }, { status: 404 })
    }

    // Fetch all data separately
    const { data: leads } = await supabase
      .from('leads')
      .select('id, owner_user_id, canvass_disposition, source, created_at')
      .eq('org_id', profile.org_id)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())

    const { data: appointments } = await supabase
      .from('scheduled_appointments')
      .select('id, canvasser_user_id, closer_user_id, lead_id, created_at, status')
      .eq('org_id', profile.org_id)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())

    const { data: opportunities } = await supabase
      .from('opportunities')
      .select('id, owner_user_id, setter_user_id, inspection_outcome, created_at')
      .eq('org_id', profile.org_id)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())

    const contactDispositions = ['go_back', 'hot_lead', 'not_interested', 'renter']

    const reps = members.map(member => {
      // LEADS (raw door knocks)
      const memberLeads = leads?.filter(l => l.owner_user_id === member.id) || []
      const rawDoors = memberLeads.length
      const rawContacts = memberLeads.filter(l => 
        contactDispositions.includes(l.canvass_disposition)
      ).length

      // APPOINTMENTS (inspections set by this user)
      const memberAppointments = appointments?.filter(a => a.canvasser_user_id === member.id) || []
      const inspectionsSet = memberAppointments.length

      // Calculate bonus doors/contacts
      const inspectionBonusDoors = memberAppointments.filter(a => {
        if (!a.lead_id) return true
        const lead = memberLeads.find(l => l.id === a.lead_id)
        return !lead
      }).length

      const inspectionBonusContacts = memberAppointments.filter(a => {
        if (!a.lead_id) return true
        const lead = memberLeads.find(l => l.id === a.lead_id)
        if (!lead) return true
        return !contactDispositions.includes(lead.canvass_disposition)
      }).length

      // SALES (closer gets credit)
      const memberOwnedOpps = opportunities?.filter(o => o.owner_user_id === member.id) || []
      const sales = memberOwnedOpps.filter(o => o.inspection_outcome === 'sale').length
      const totalInspectionsRun = memberOwnedOpps.filter(o => o.inspection_outcome).length
      const closeRate = totalInspectionsRun > 0 ? (sales / totalInspectionsRun * 100) : 0

      return {
        user_id: member.id,
        name: member.full_name || 'Unknown',
        email: member.email,
        role: member.role,
        doors: {
          raw: rawDoors,
          bonus_from_inspections: inspectionBonusDoors,
          final: rawDoors + inspectionBonusDoors,
        },
        contacts: {
          raw: rawContacts,
          bonus_from_inspections: inspectionBonusContacts,
          final: rawContacts + inspectionBonusContacts,
        },
        inspections: {
          count: inspectionsSet,
          sample_ids: memberAppointments.slice(0, 5).map(a => a.id),
        },
        sales: {
          count: sales,
        },
        close_rate: closeRate.toFixed(1) + '%',
        _debug: {
          leads_owned: memberLeads.slice(0, 3).map(l => ({
            id: l.id,
            disposition: l.canvass_disposition,
            created: l.created_at,
          })),
          appointments_set: memberAppointments.slice(0, 3).map(a => ({
            id: a.id,
            lead_id: a.lead_id,
            closer_id: a.closer_user_id,
            created: a.created_at,
          })),
        },
      }
    })

    // Sort by inspections set (setter performance view)
    reps.sort((a, b) => {
      if (b.inspections.count !== a.inspections.count) return b.inspections.count - a.inspections.count
      return b.doors.final - a.doors.final
    })

    return NextResponse.json({
      range: {
        start: start.toISOString(),
        end: end.toISOString(),
        timezone: 'America/New_York',
        timeframe,
      },
      totals: {
        leads: leads?.length || 0,
        appointments: appointments?.length || 0,
        opportunities: opportunities?.length || 0,
      },
      reps,
      query_info: {
        leads_table: 'owner_user_id = setter who knocked',
        appointments_table: 'canvasser_user_id = setter who scheduled inspection',
        opportunities_table: 'owner_user_id = closer, setter_user_id = setter',
        logic: 'Inspections counted from scheduled_appointments.canvasser_user_id',
      },
    })
  } catch (error) {
    console.error('Debug team stats error:', error)
    return NextResponse.json({ error: 'Failed to fetch debug stats' }, { status: 500 })
  }
}
