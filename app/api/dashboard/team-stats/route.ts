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
  const now = new Date()
  const end = new Date(now.getTime() + 24 * 60 * 60 * 1000) // Tomorrow to include all of today
  let start = new Date(now)

  switch (timeframe) {
    case 'today':
      // Start of today in local time
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
      end.setTime(start.getTime() + 24 * 60 * 60 * 1000) // End of today
      break
    case 'yesterday':
      // Start of yesterday
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0)
      end.setTime(start.getTime() + 24 * 60 * 60 * 1000) // End of yesterday
      break
    case 'week':
      start.setDate(now.getDate() - now.getDay())
      start.setHours(0, 0, 0, 0)
      break
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      break
    case 'quarter':
      const quarter = Math.floor(now.getMonth() / 3)
      start = new Date(now.getFullYear(), quarter * 3, 1)
      break
    case 'year':
      start = new Date(now.getFullYear(), 0, 1)
      break
    case 'all':
      start = new Date(2020, 0, 1) // Far back enough
      break
    default:
      start.setDate(now.getDate() - now.getDay())
      start.setHours(0, 0, 0, 0)
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

    // Get user profile
    const { data: profile } = await supabase
      .from('users')
      .select('org_id, role, team_id, region_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const isAdmin = profile.role === 'admin'
    const isRegionalManager = profile.role === 'regional_manager'
    const isSalesManager = profile.role === 'sales_manager'

    // Only managers/admins can see team stats
    if (!isAdmin && !isRegionalManager && !isSalesManager) {
      return NextResponse.json({ teamMemberStats: [] })
    }

    const searchParams = request.nextUrl.searchParams
    const timeframe = searchParams.get('timeframe') || 'week'
    const { start, end } = getDateRangeForTimeFrame(timeframe)

    // Get team member IDs based on role
    let teamMemberIds: string[] = []
    
    if (isSalesManager && profile.team_id) {
      const { data: teamMembers } = await supabase
        .from('users')
        .select('id')
        .eq('team_id', profile.team_id)
      teamMemberIds = teamMembers?.map(m => m.id) || []
    } else if (isRegionalManager && profile.region_id) {
      const { data: regionTeams } = await supabase
        .from('teams')
        .select('id')
        .eq('region_id', profile.region_id)
      const teamIds = regionTeams?.map(t => t.id) || []
      if (teamIds.length > 0) {
        const { data: regionMembers } = await supabase
          .from('users')
          .select('id')
          .in('team_id', teamIds)
        teamMemberIds = regionMembers?.map(m => m.id) || []
      }
    } else if (isAdmin) {
      // Admin sees all - we'll filter by org_id in queries
      teamMemberIds = []
    }

    // Get all active team members with their info
    let membersQuery = supabase
      .from('users')
      .select('id, full_name, role')
      .eq('org_id', profile.org_id)
      .eq('active', true)
    
    if (!isAdmin && teamMemberIds.length > 0) {
      membersQuery = membersQuery.in('id', teamMemberIds)
    }
    
    const { data: members } = await membersQuery

    if (!members || members.length === 0) {
      return NextResponse.json({ teamMemberStats: [] })
    }

    // Fetch leads with canvass_disposition (doors knocked) for the time period
    let leadsQuery = supabase
      .from('leads')
      .select('owner_user_id, canvass_disposition, created_at')
      .eq('org_id', profile.org_id)
      .not('canvass_disposition', 'is', null)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())

    if (!isAdmin && teamMemberIds.length > 0) {
      leadsQuery = leadsQuery.in('owner_user_id', teamMemberIds)
    }

    const { data: leads } = await leadsQuery

    // Fetch opportunities for the time period
    let oppsQuery = supabase
      .from('opportunities')
      .select('owner_user_id, inspection_outcome, created_at')
      .eq('org_id', profile.org_id)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())

    if (!isAdmin && teamMemberIds.length > 0) {
      oppsQuery = oppsQuery.in('owner_user_id', teamMemberIds)
    }

    const { data: opportunities } = await oppsQuery

    // Contact dispositions - where rep actually talked to someone
    const contactDispositions = ['go_back', 'hot_lead', 'not_interested', 'renter']

    // Calculate stats for each member
    const teamMemberStats = members.map(member => {
      // Count doors knocked - leads with any canvass_disposition
      const memberLeads = leads?.filter(l => l.owner_user_id === member.id) || []
      const doorsKnocked = memberLeads.length

      // Count contacts - only dispositions where they talked to someone
      const contacts = memberLeads.filter(l => 
        contactDispositions.includes(l.canvass_disposition)
      ).length

      // Count inspections set
      const memberOpps = opportunities?.filter(o => o.owner_user_id === member.id) || []
      const inspectionsSet = memberOpps.length

      // Count sales
      const sales = memberOpps.filter(o => o.inspection_outcome === 'sale').length

      // Calculate close rate
      const totalInspections = memberOpps.filter(o => o.inspection_outcome).length
      const closeRate = totalInspections > 0 ? (sales / totalInspections * 100) : 0

      return {
        id: member.id,
        name: member.full_name || 'Unknown',
        role: member.role,
        doorsKnocked,
        contacts,
        inspectionsSet,
        sales,
        closeRate: closeRate.toFixed(0),
      }
    })

    // Sort by sales, then inspections, then doors
    teamMemberStats.sort((a, b) => {
      if (b.sales !== a.sales) return b.sales - a.sales
      if (b.inspectionsSet !== a.inspectionsSet) return b.inspectionsSet - a.inspectionsSet
      return b.doorsKnocked - a.doorsKnocked
    })

    return NextResponse.json({ teamMemberStats })
  } catch (error) {
    console.error('Team stats error:', error)
    return NextResponse.json({ error: 'Failed to fetch team stats' }, { status: 500 })
  }
}
