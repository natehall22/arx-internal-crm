import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { isSisuAdminRole } from '@/lib/sisu-admin-access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type AdminContext = { userId: string; orgId: string }

/**
 * Resolves the caller once — identity, active check, role and org in a single pass.
 * Replaces a local cookie parser + anon auth client that re-hit Supabase auth twice
 * per request and never checked `users.active`.
 */
async function requireIncentivesAdmin(): Promise<AdminContext | NextResponse> {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isSisuAdminRole(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!profile.org_id) {
    return NextResponse.json({ error: 'No org found' }, { status: 400 })
  }

  return { userId: profile.id, orgId: profile.org_id }
}

// ─── GET /api/admin/incentives ────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authResult = await requireIncentivesAdmin()
  if (authResult instanceof NextResponse) return authResult

  const { searchParams } = new URL(req.url)
  const resource = searchParams.get('resource')

  const admin = createServiceClient()
  const orgId = authResult.orgId

  // payout queue for a specific cycle — scoped to caller's org + cycle date range
  if (resource === 'payout_queue') {
    const cycleId = searchParams.get('cycle_id')
    if (!cycleId) return NextResponse.json({ error: 'cycle_id required' }, { status: 400 })

    // Fetch the cycle to get its date window — also verifies it belongs to this org
    const { data: cycle, error: cycleError } = await admin
      .from('incentive_cycles')
      .select('id, starts_at, ends_at')
      .eq('id', cycleId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (cycleError) return NextResponse.json({ error: cycleError.message }, { status: 500 })
    if (!cycle) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 })

    // Filter achievements that qualified within this cycle's window
    const { data: achievements, error } = await admin
      .from('spiff_achievements')
      .select('*, users(full_name, role)')
      .eq('org_id', orgId)
      .eq('qualified', true)
      .gte('qualified_at', cycle.starts_at)
      .lte('qualified_at', cycle.ends_at)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ achievements: achievements ?? [] })
  }

  // default: load all lists

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
  const authResult = await requireIncentivesAdmin()
  if (authResult instanceof NextResponse) return authResult

  const admin = createServiceClient()

  const body = await req.json()
  const { resource, ...rest } = body
  const orgId = authResult.orgId

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
  const authResult = await requireIncentivesAdmin()
  if (authResult instanceof NextResponse) return authResult

  const admin = createServiceClient()
  // org_id scopes every update query below to prevent cross-org modification
  const orgId = authResult.orgId

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
