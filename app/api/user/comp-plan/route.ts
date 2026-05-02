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

    const todayStr = new Date().toISOString().split('T')[0]

    // Get the user's active comp plan assignment using service role (bypasses RLS)
    const { data: userCompPlan, error } = await supabase
      .from('user_comp_plans')
      .select('*, comp_plans(*)')
      .eq('user_id', user.id)
      .eq('org_id', profile.org_id)
      .lte('effective_from', todayStr)
      .or(`effective_to.is.null,effective_to.gte.${todayStr}`)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('Error fetching comp plan:', error)
      return NextResponse.json({ error: 'Failed to fetch comp plan' }, { status: 500 })
    }

    let plan = userCompPlan?.comp_plans as any
    let assignment = userCompPlan

    if (!plan) {
      const { data: defaultPlan } = await supabase
        .from('comp_plans')
        .select('*')
        .eq('org_id', profile.org_id)
        .eq('is_default', true)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()

      if (!defaultPlan) {
        return NextResponse.json({ hasCompPlan: false, compPlan: null })
      }

      plan = defaultPlan
      assignment = null
    } else if (plan.is_active === false) {
      return NextResponse.json({ hasCompPlan: false, compPlan: null, reason: 'inactive' })
    }

    return NextResponse.json({
      hasCompPlan: true,
      compPlan: {
        id: plan.id,
        name: plan.name,
        plan_type: plan.plan_type || 'percentage',
        base_percentage: plan.base_percentage,
        flat_rate: plan.flat_rate,
        flat_amount: plan.flat_amount,
        hourly_rate: plan.hourly_rate,
        unit_rate: plan.unit_rate,
        unit_type: plan.unit_type,
        hybrid_components: plan.hybrid_components || null,
        volume_bonuses: plan.volume_bonuses || [],
        is_manager_plan: plan.is_manager_plan || false,
        personal_sales_enabled: plan.personal_sales_enabled || false,
        team_override_enabled: plan.team_override_enabled || false,
        team_overrides: plan.team_overrides || [],
        readme: plan.readme,
      },
      assignment: {
        effective_from: assignment?.effective_from ?? todayStr,
        effective_to: assignment?.effective_to ?? null,
        override_percentage: assignment?.override_percentage ?? null,
      }
    })

  } catch (error) {
    console.error('Comp plan API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
