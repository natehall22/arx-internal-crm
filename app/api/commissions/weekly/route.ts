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
      .select('org_id')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Calculate this week's boundaries (Sunday to Saturday) in ET
    // getDay() uses the server's local timezone which may not be ET; use Intl instead
    const now = new Date()
    const etDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now)
    const [etYear, etMonth, etDay] = etDateStr.split('-').map(Number)
    const etDow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(now)
    )
    if (etDow < 0) throw new Error('Unable to compute ET day-of-week')
    const weekStartStr = new Date(Date.UTC(etYear, etMonth - 1, etDay - etDow)).toISOString().split('T')[0]
    const weekEndStr = new Date(Date.UTC(etYear, etMonth - 1, etDay - etDow + 6)).toISOString().split('T')[0]

    // Check if user has a comp plan assigned
    const { data: userCompPlan } = await supabase
      .from('user_comp_plans')
      .select('id, comp_plans(is_active)')
      .eq('user_id', user.id)
      .eq('org_id', profile.org_id)
      .lte('effective_from', weekEndStr)
      .or(`effective_to.is.null,effective_to.gte.${weekStartStr}`)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    let hasCompPlan = !!userCompPlan && (userCompPlan.comp_plans as any)?.is_active !== false
    if (!hasCompPlan) {
      const { data: defaultPlan } = await supabase
        .from('comp_plans')
        .select('id')
        .eq('org_id', profile.org_id)
        .eq('is_default', true)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
      hasCompPlan = !!defaultPlan
    }

    // Get this week's commissions
    const { data: commissions } = await supabase
      .from('commissions')
      .select('total_amount')
      .eq('user_id', user.id)
      .gte('commission_period', weekStartStr)
      .lte('commission_period', weekEndStr)

    const weeklyTotal = commissions?.reduce((sum, c) => sum + (c.total_amount || 0), 0) || 0

    return NextResponse.json({
      weeklyTotal,
      hasCompPlan,
      weekStart: weekStartStr,
      weekEnd: weekEndStr,
    })

  } catch (error) {
    console.error('Weekly commissions error:', error)
    return NextResponse.json({ error: 'Failed to fetch weekly commissions' }, { status: 500 })
  }
}
