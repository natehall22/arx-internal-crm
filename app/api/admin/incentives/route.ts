import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

// ─── auth helpers (same pattern as /api/admin/data/route.ts) ─────────────────

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

  return createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: sessionData?.access_token
      ? { headers: { Authorization: `Bearer ${sessionData.access_token}` } }
      : undefined,
  })
}

const ADMIN_ROLES = [
  'admin',
  'owner',
  'regional_manager',
  'regional_setter_manager',
  'sales_manager',
  'setter_manager',
  'manager',
  'operations',
]

async function getAuthedUser(req: NextRequest) {
  const client = getAuthClient(req)
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) return null
  return user
}

async function assertAdmin(req: NextRequest): Promise<{ userId: string } | NextResponse> {
  const user = await getAuthedUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: profile } = await admin
    .from('users')
    .select('role, org_id')
    .eq('id', user.id)
    .single()

  if (!profile?.role || !ADMIN_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return { userId: user.id }
}

// ─── GET /api/admin/incentives ────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authResult = await assertAdmin(req)
  if (authResult instanceof NextResponse) return authResult

  const { searchParams } = new URL(req.url)
  const resource = searchParams.get('resource')

  const user = await getAuthedUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getAuthClient(req)
  const admin = createServiceClient()

  // Resolve org_id from authed user — required for all branches
  const { data: profile } = await admin
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) return NextResponse.json({ error: 'No org found' }, { status: 400 })

  // payout queue for a specific cycle — scoped to caller's org + cycle date range
  if (resource === 'payout_queue') {
    const cycleId = searchParams.get('cycle_id')
    if (!cycleId) return NextResponse.json({ error: 'cycle_id required' }, { status: 400 })

    // Fetch the cycle to get its date window — also verifies it belongs to this org
    const { data: cycle, error: cycleError } = await admin
      .from('incentive_cycles')
      .select('id, starts_at, ends_at')
      .eq('id', cycleId)
      .eq('org_id', profile.org_id)
      .maybeSingle()

    if (cycleError) return NextResponse.json({ error: cycleError.message }, { status: 500 })
    if (!cycle) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 })

    // Filter achievements that qualified within this cycle's window
    const { data: achievements, error } = await admin
      .from('spiff_achievements')
      .select('*, users(full_name, role)')
      .eq('org_id', profile.org_id)
      .eq('qualified', true)
      .gte('qualified_at', cycle.starts_at)
      .lte('qualified_at', cycle.ends_at)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ achievements: achievements ?? [] })
  }

  // default: load all lists

  const orgId = profile.org_id

  const [spiffsRes, cyclesRes, badgesRes, usersRes] = await Promise.all([
    admin.from('spiff_programs').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
    admin.from('incentive_cycles').select('*').eq('org_id', orgId).order('starts_at', { ascending: false }),
    admin.from('incentive_badges').select('*').eq('org_id', orgId).order('sort_order'),
    admin.from('users').select('id, full_name, role').eq('org_id', orgId).eq('active', true).order('full_name'),
  ])

  const firstError = spiffsRes.error ?? cyclesRes.error ?? badgesRes.error ?? usersRes.error
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 })

  return NextResponse.json({
    heats: spiffsRes.data ?? [],
    cycles: cyclesRes.data ?? [],
    badges: badgesRes.data ?? [],
    users: usersRes.data ?? [],
  })
}

// ─── POST /api/admin/incentives ───────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const authResult = await assertAdmin(req)
  if (authResult instanceof NextResponse) return authResult

  const user = await getAuthedUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: profile } = await admin
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) return NextResponse.json({ error: 'No org found' }, { status: 400 })

  const body = await req.json()
  const { resource, ...rest } = body
  const orgId = profile.org_id

  if (resource === 'heat_program') {
    const allowed = ['name','description','trigger_metric','threshold','reward_type','reward_amount','reward_note','eligible_roles','is_public','starts_at','ends_at','status']
    const insertData = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))
    const { data, error } = await admin
      .from('spiff_programs')
      .insert({ ...insertData, org_id: orgId, created_by: authResult.userId })
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ spiff: data })
  }

  if (resource === 'incentive_cycle') {
    const allowed = ['cadence','label','starts_at','ends_at']
    const insertData = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))
    const { data, error } = await admin
      .from('incentive_cycles')
      .insert({ ...insertData, org_id: orgId })
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ cycle: data })
  }

  if (resource === 'incentive_badge') {
    const allowed = ['name','description','icon_key','color_hex','criteria_type','criteria_value','is_active','sort_order','image_url']
    const insertData = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))
    const { data, error } = await admin
      .from('incentive_badges')
      .insert({ ...insertData, org_id: orgId })
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ badge: data })
  }

  if (resource === 'user_badge') {
    const allowed = ['user_id','badge_id','awarded_by','note','awarded_at']
    const insertData = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))

    // Verify the target user belongs to this org — prevents awarding badges to users in other orgs
    if (typeof insertData.user_id === 'string') {
      const { data: targetUser } = await admin
        .from('users')
        .select('id')
        .eq('id', insertData.user_id)
        .eq('org_id', orgId)
        .maybeSingle()
      if (!targetUser) return NextResponse.json({ error: 'User not found in your organization' }, { status: 404 })
    }

    // Verify the badge belongs to this org — prevents awarding foreign-org badges
    if (typeof insertData.badge_id === 'string') {
      const { data: targetBadge } = await admin
        .from('incentive_badges')
        .select('id')
        .eq('id', insertData.badge_id)
        .eq('org_id', orgId)
        .maybeSingle()
      if (!targetBadge) return NextResponse.json({ error: 'Badge not found in your organization' }, { status: 404 })
    }

    const { data, error } = await admin
      .from('user_badges')
      .insert({ ...insertData, org_id: orgId })
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ user_badge: data })
  }

  return NextResponse.json({ error: 'Unknown resource' }, { status: 400 })
}

// ─── PATCH /api/admin/incentives ──────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const authResult = await assertAdmin(req)
  if (authResult instanceof NextResponse) return authResult

  const admin = createServiceClient()

  // Resolve org_id — required for all update queries to prevent cross-org modification
  const { data: callerProfile } = await admin
    .from('users')
    .select('org_id')
    .eq('id', authResult.userId)
    .single()
  if (!callerProfile?.org_id) return NextResponse.json({ error: 'No org found' }, { status: 400 })
  const orgId = callerProfile.org_id

  const body = await req.json()
  const { resource, id, ...rest } = body

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  if (resource === 'heat_program') {
    const allowed = ['name','description','trigger_metric','threshold','reward_type','reward_amount','reward_note','eligible_roles','is_public','starts_at','ends_at','status']
    const updateData = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))
    const { data, error } = await admin
      .from('spiff_programs')
      .update(updateData)
      .eq('id', id)
      .eq('org_id', orgId) // prevent cross-org modification
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ spiff: data })
  }

  if (resource === 'incentive_cycle') {
    const allowed = ['cadence','label','starts_at','ends_at']
    const updateData: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))
    if (rest.lock) updateData.locked_at = new Date().toISOString()
    const { data, error } = await admin
      .from('incentive_cycles')
      .update(updateData)
      .eq('id', id)
      .eq('org_id', orgId) // prevent cross-org modification
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ cycle: data })
  }

  if (resource === 'incentive_badge') {
    const allowed = ['name','description','icon_key','color_hex','criteria_type','criteria_value','is_active','sort_order','image_url']
    const updateData = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))
    const { data, error } = await admin
      .from('incentive_badges')
      .update(updateData)
      .eq('id', id)
      .eq('org_id', orgId) // prevent cross-org modification
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ badge: data })
  }

  return NextResponse.json({ error: 'Unknown resource' }, { status: 400 })
}
